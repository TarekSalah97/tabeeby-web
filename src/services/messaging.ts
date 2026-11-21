import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { hitRateLimit } from '../auth/rateLimit.js';
import { isOpenNow, type MessagingHours } from '../domain/messagingHours.js';
import { normalizeDigits } from '../domain/phone.js';
import { enqueueSms, enqueueEmail } from './outbox.js';
import { audit } from './audit.js';
import { translator, type Locale } from '../i18n/index.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';
import type { FieldErrors } from './accounts.js';

export const MAX_MESSAGE_LENGTH = 1000;
/** A patient can message a doctor they booked with (not cancelled) within this many days, or have an upcoming visit with. */
export const MESSAGE_ELIGIBLE_DAYS = 180;
const PATIENT_LIMIT = { limit: 20, window: 24 * 60 * 60 };
const DOCTOR_LIMIT = { limit: 300, window: 60 * 60 };

export interface DoctorMessaging extends MessagingHours {
  enabled: boolean;
}

const hoursOf = (r: { messaging_enabled: boolean; messaging_days: number[]; messaging_start: string; messaging_end: string }): DoctorMessaging => ({
  enabled: r.messaging_enabled,
  days: [...r.messaging_days].sort((a, b) => a - b),
  start: r.messaging_start,
  end: r.messaging_end,
});

const HOURS_COLUMNS = `d.messaging_enabled, d.messaging_days, to_char(d.messaging_start, 'HH24:MI') as messaging_start, to_char(d.messaging_end, 'HH24:MI') as messaging_end`;

export async function getMessagingSettings(db: Queryable, doctorId: string): Promise<DoctorMessaging> {
  const { rows } = await db.query<{ messaging_enabled: boolean; messaging_days: number[]; messaging_start: string; messaging_end: string }>(
    `select ${HOURS_COLUMNS} from doctors d where d.user_id = $1`,
    [doctorId],
  );
  if (!rows[0]) throw notFound();
  return hoursOf(rows[0]);
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveMessagingSettings(
  deps: Deps,
  doctorId: string,
  input: { enabled: boolean; days: string[]; start: string; end: string },
  ip: string,
): Promise<FieldErrors> {
  const errors: FieldErrors = {};
  const days = [...new Set(input.days.map((d) => Number(d)))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const start = normalizeDigits(input.start).trim();
  const end = normalizeDigits(input.end).trim();
  if (input.enabled && !days.length) errors['days'] = 'msgset.daysRequired';
  if (!TIME_RE.test(start)) errors['start'] = 'msgset.timeInvalid';
  if (!TIME_RE.test(end)) errors['end'] = 'msgset.timeInvalid';
  else if (TIME_RE.test(start) && end <= start) errors['end'] = 'msgset.endAfterStart';
  if (Object.keys(errors).length) return errors;
  await deps.db.transaction(async (tx) => {
    await tx.query(
      `update doctors set messaging_enabled = $2, messaging_days = $3::smallint[], messaging_start = $4::time, messaging_end = $5::time, updated_at = now() where user_id = $1`,
      [doctorId, input.enabled, days.length ? days : [0, 1, 2, 3, 4], start, end],
    );
    await audit(tx, { actorId: doctorId, action: 'messaging.settings', entityType: 'doctor', entityId: doctorId, metadata: { enabled: input.enabled }, ip });
  });
  return {};
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Message {
  id: string;
  sender: 'patient' | 'doctor';
  body: string;
  created_at: Date;
}

export interface ConversationSummary {
  id: string;
  other_name: string;
  other_slug: string | null;
  last_message_at: Date;
  last_sender: 'patient' | 'doctor' | null;
  preview: string;
  unread: boolean;
  blocked: boolean;
}

const preview = `(select left(m.body, 120) from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as preview`;

export async function listPatientConversations(db: Queryable, patientId: string): Promise<ConversationSummary[]> {
  return (
    await db.query<ConversationSummary>(
      `select c.id, u.full_name as other_name, d.slug as other_slug, c.last_message_at, c.last_sender, ${preview},
              (c.last_sender = 'doctor' and (c.patient_read_at is null or c.patient_read_at < c.last_message_at)) as unread,
              c.blocked_at is not null as blocked
         from conversations c join doctors d on d.user_id = c.doctor_id join users u on u.id = c.doctor_id
        where c.patient_id = $1 order by c.last_message_at desc limit 100`,
      [patientId],
    )
  ).rows;
}

export async function listDoctorConversations(db: Queryable, doctorId: string): Promise<ConversationSummary[]> {
  return (
    await db.query<ConversationSummary>(
      `select c.id, u.full_name as other_name, null as other_slug, c.last_message_at, c.last_sender, ${preview},
              (c.last_sender = 'patient' and (c.doctor_read_at is null or c.doctor_read_at < c.last_message_at)) as unread,
              c.blocked_at is not null as blocked
         from conversations c join users u on u.id = c.patient_id
        where c.doctor_id = $1 order by c.last_message_at desc limit 200`,
      [doctorId],
    )
  ).rows;
}

/** Conversations with something new for this person (for the badge in the menu). */
export async function unreadConversations(db: Queryable, user: Pick<SessionUser, 'id' | 'role'>): Promise<number> {
  if (user.role !== 'patient' && user.role !== 'doctor') return 0;
  const sql =
    user.role === 'patient'
      ? `select count(*)::int as n from conversations c where c.patient_id = $1 and c.last_sender = 'doctor'
           and (c.patient_read_at is null or c.patient_read_at < c.last_message_at)`
      : `select count(*)::int as n from conversations c where c.doctor_id = $1 and c.last_sender = 'patient'
           and (c.doctor_read_at is null or c.doctor_read_at < c.last_message_at)`;
  const { rows } = await db.query<{ n: number }>(sql, [user.id]);
  return rows[0]?.n ?? 0;
}

async function messagesOf(db: Queryable, conversationId: string): Promise<Message[]> {
  // The latest 200, oldest first.
  return (
    await db.query<Message>(
      `select * from (select id, sender, body, created_at from messages where conversation_id = $1 order by created_at desc limit 200) m order by created_at`,
      [conversationId],
    )
  ).rows;
}

export interface MessagingDoctor extends DoctorMessaging {
  id: string;
  name: string;
  slug: string;
  phone: string;
  locale: Locale;
}

async function doctorBySlug(db: Queryable, slug: string): Promise<MessagingDoctor> {
  const { rows } = await db.query<{ user_id: string; full_name: string; slug: string; phone_e164: string; preferred_locale: Locale; messaging_enabled: boolean; messaging_days: number[]; messaging_start: string; messaging_end: string }>(
    `select d.user_id, u.full_name, d.slug, u.phone_e164, u.preferred_locale, ${HOURS_COLUMNS}
       from doctors d join users u on u.id = d.user_id
      where d.slug = $1 and d.verification_status = 'approved' and u.status = 'active'`,
    [slug],
  );
  const r = rows[0];
  if (!r) throw notFound();
  return { id: r.user_id, name: r.full_name, slug: r.slug, phone: r.phone_e164, locale: r.preferred_locale, ...hoursOf(r) };
}

/** Patients may write only to doctors they actually booked with (not cancelled), recently or upcoming. */
export async function canPatientMessage(db: Queryable, patientId: string, doctorId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from appointments where patient_id = $1 and doctor_id = $2 and status <> 'cancelled'
        and starts_at > now() - make_interval(days => $3) limit 1`,
    [patientId, doctorId, MESSAGE_ELIGIBLE_DAYS],
  );
  return !!rows[0];
}

export interface PatientThread {
  doctor: MessagingDoctor;
  conversationId: string | null;
  messages: Message[];
  eligible: boolean;
  openNow: boolean;
  blocked: boolean;
}

/** The patient's side of a conversation; opening it marks the doctor's replies as read. */
export async function patientThread(deps: Deps, patient: SessionUser, slug: string): Promise<PatientThread> {
  const db = deps.db;
  const doctor = await doctorBySlug(db, slug);
  const conv = (
    await db.query<{ id: string; blocked_at: Date | null }>('select id, blocked_at from conversations where doctor_id = $1 and patient_id = $2', [doctor.id, patient.id])
  ).rows[0];
  // Without messaging on and without an earlier conversation there is nothing to show.
  if (!doctor.enabled && !conv) throw notFound();
  if (conv) await db.query('update conversations set patient_read_at = now() where id = $1', [conv.id]);
  return {
    doctor,
    conversationId: conv?.id ?? null,
    messages: conv ? await messagesOf(db, conv.id) : [],
    eligible: await canPatientMessage(db, patient.id, doctor.id),
    openNow: isOpenNow(doctor, deps.now(), deps.cfg.TIME_ZONE),
    blocked: !!conv?.blocked_at,
  };
}

export interface DoctorThread {
  id: string;
  patientName: string;
  patientPhone: string;
  blocked: boolean;
  messages: Message[];
}

export async function doctorThread(db: Queryable, doctorId: string, conversationId: string): Promise<DoctorThread> {
  const { rows } = await db.query<{ id: string; full_name: string; phone_e164: string; blocked_at: Date | null }>(
    `select c.id, u.full_name, u.phone_e164, c.blocked_at from conversations c join users u on u.id = c.patient_id
      where c.id = $1 and c.doctor_id = $2`,
    [conversationId, doctorId],
  );
  const c = rows[0];
  if (!c) throw notFound(); // also hides other doctors' conversations
  await db.query('update conversations set doctor_read_at = now() where id = $1', [c.id]);
  return { id: c.id, patientName: c.full_name, patientPhone: c.phone_e164, blocked: !!c.blocked_at, messages: await messagesOf(db, c.id) };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) throw new DomainError('msg.empty');
  if (body.length > MAX_MESSAGE_LENGTH) throw new DomainError('msg.tooLong');
  return body;
}

export async function sendFromPatient(deps: Deps, patient: SessionUser, slug: string, raw: string, _ip: string): Promise<void> {
  if (patient.role !== 'patient') throw notFound();
  const body = cleanBody(raw);
  const doctor = await doctorBySlug(deps.db, slug);
  if (!doctor.enabled) throw new DomainError('msg.notEnabled');
  if (!isOpenNow(doctor, deps.now(), deps.cfg.TIME_ZONE)) throw new DomainError('msg.closedNow');
  if (!(await canPatientMessage(deps.db, patient.id, doctor.id))) throw new DomainError('msg.notEligible');
  if (!(await hitRateLimit(deps.db, `msg:${patient.id}:${doctor.id}`, PATIENT_LIMIT.limit, PATIENT_LIMIT.window))) throw tooManyRequests();
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; blocked_at: Date | null; was_unread: boolean }>(
      `insert into conversations (doctor_id, patient_id) values ($1, $2)
       on conflict (doctor_id, patient_id) do update set doctor_id = excluded.doctor_id
       returning id, blocked_at,
         (last_sender = 'patient' and (doctor_read_at is null or doctor_read_at < last_message_at)) as was_unread`,
      [doctor.id, patient.id],
    );
    const conv = rows[0]!;
    if (conv.blocked_at) throw new DomainError('msg.blocked');
    await tx.query(`insert into messages (conversation_id, sender, body) values ($1, 'patient', $2)`, [conv.id, body]);
    await tx.query(`update conversations set last_message_at = now(), last_sender = 'patient', patient_read_at = now() where id = $1`, [conv.id]);
    // One alert per batch of unread messages, never the message itself (it is health data).
    if (!conv.was_unread) {
      const t = translator(doctor.locale);
      await enqueueSms(tx, doctor.phone, t('sms.newMessageDoctor', { link: `${deps.cfg.PUBLIC_ORIGIN}${doctor.locale === 'en' ? '/en' : ''}/dashboard/messages/${conv.id}` }));
    }
  });
}

export async function replyFromDoctor(deps: Deps, doctor: SessionUser, conversationId: string, raw: string, ip: string): Promise<void> {
  if (doctor.role !== 'doctor') throw notFound();
  const body = cleanBody(raw);
  if (!(await hitRateLimit(deps.db, `msg-dr:${doctor.id}`, DOCTOR_LIMIT.limit, DOCTOR_LIMIT.window))) throw tooManyRequests();
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; patient_phone: string; patient_locale: Locale; patient_name: string; email: string | null; was_unread: boolean }>(
      `select c.id, u.phone_e164 as patient_phone, u.preferred_locale as patient_locale, u.full_name as patient_name,
              case when u.email_verified_at is not null then u.email end as email,
              (c.last_sender = 'doctor' and (c.patient_read_at is null or c.patient_read_at < c.last_message_at)) as was_unread
         from conversations c join users u on u.id = c.patient_id
        where c.id = $1 and c.doctor_id = $2 for update of c`,
      [conversationId, doctor.id],
    );
    const c = rows[0];
    if (!c) throw notFound();
    await tx.query(`insert into messages (conversation_id, sender, body) values ($1, 'doctor', $2)`, [c.id, body]);
    await tx.query(`update conversations set last_message_at = now(), last_sender = 'doctor', doctor_read_at = now() where id = $1`, [c.id]);
    if (!c.was_unread) {
      const t = translator(c.patient_locale);
      const link = `${deps.cfg.PUBLIC_ORIGIN}${c.patient_locale === 'en' ? '/en' : ''}/messages`;
      await enqueueSms(tx, c.patient_phone, t('sms.newMessagePatient', { doctor: doctor.fullName, link }));
      if (c.email) {
        await enqueueEmail(tx, c.email, t('email.newMessageSubject', { doctor: doctor.fullName }), t('email.newMessageBody', { name: c.patient_name, doctor: doctor.fullName, link }));
      }
    }
    await audit(tx, { actorId: doctor.id, action: 'message.reply', entityType: 'conversation', entityId: c.id, ip });
  });
}

export async function setConversationBlocked(deps: Deps, doctor: SessionUser, conversationId: string, blocked: boolean, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const r = await tx.query(
      `update conversations set blocked_at = case when $3 then coalesce(blocked_at, now()) else null end where id = $1 and doctor_id = $2`,
      [conversationId, doctor.id, blocked],
    );
    if (r.rowCount === 0) throw notFound();
    await audit(tx, { actorId: doctor.id, action: blocked ? 'message.block' : 'message.unblock', entityType: 'conversation', entityId: conversationId, ip });
  });
}

/** For the doctor profile: show "Message" only when the signed-in patient could actually write. */
export async function messageButtonState(deps: Deps, patientId: string, doctorId: string): Promise<'hidden' | 'open' | 'closed'> {
  const { rows } = await deps.db.query<{ messaging_enabled: boolean; messaging_days: number[]; messaging_start: string; messaging_end: string }>(
    `select ${HOURS_COLUMNS} from doctors d where d.user_id = $1`,
    [doctorId],
  );
  const h = rows[0] ? hoursOf(rows[0]) : null;
  if (!h?.enabled || !(await canPatientMessage(deps.db, patientId, doctorId))) return 'hidden';
  return isOpenNow(h, deps.now(), deps.cfg.TIME_ZONE) ? 'open' : 'closed';
}
