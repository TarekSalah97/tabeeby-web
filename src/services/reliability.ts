import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { Config } from '../config.js';
import type { SessionUser } from '../auth/sessions.js';
import { addDays, isValidDate, todayIn, zonedToUtc } from '../domain/time.js';
import { enqueueSms } from './outbox.js';
import { audit } from './audit.js';
import { translator, formatDateTime, type Locale } from '../i18n/index.js';
import { DomainError, notFound } from '../http/errors.js';

type StrikeCfg = Pick<Config, 'STRIKE_LIMIT' | 'STRIKE_WINDOW_DAYS'>;

// ---------------------------------------------------------------------------
// Doctor strikes
// ---------------------------------------------------------------------------

export async function addStrike(
  tx: Queryable,
  s: { doctorId: string; source: 'doctor_cancel' | 'day_cancel' | 'admin'; appointmentId?: string | null; day?: string | null; reason: string | null; createdBy: string },
): Promise<void> {
  await tx.query(
    `insert into doctor_strikes (doctor_id, source, appointment_id, day, reason, created_by) values ($1, $2, $3, $4::date, $5, $6)
     on conflict (doctor_id, day) where source = 'day_cancel' do nothing`,
    [s.doctorId, s.source, s.appointmentId ?? null, s.day ?? null, s.reason?.slice(0, 300) ?? null, s.createdBy],
  );
}

/** Active strikes per doctor inside the window. */
export async function activeStrikes(db: Queryable, cfg: StrikeCfg, doctorIds: string[]): Promise<Map<string, number>> {
  if (!doctorIds.length) return new Map();
  const { rows } = await db.query<{ doctor_id: string; n: number }>(
    `select doctor_id, count(*)::int as n from doctor_strikes
      where doctor_id = any($1::uuid[]) and status = 'active' and created_at > now() - make_interval(days => $2)
      group by doctor_id`,
    [doctorIds, cfg.STRIKE_WINDOW_DAYS],
  );
  return new Map(rows.map((r) => [r.doctor_id, r.n]));
}

/** Doctors whose online booking is paused because of too many strikes. */
export async function pausedDoctors(db: Queryable, cfg: StrikeCfg, doctorIds: string[]): Promise<Set<string>> {
  const counts = await activeStrikes(db, cfg, doctorIds);
  return new Set([...counts].filter(([, n]) => n >= cfg.STRIKE_LIMIT).map(([id]) => id));
}

export interface StrikeRow {
  id: string;
  doctor_id: string;
  doctor_name: string;
  source: 'doctor_cancel' | 'day_cancel' | 'admin';
  day: string | null;
  reason: string | null;
  status: 'active' | 'waived';
  created_at: Date;
  review_note: string | null;
  active_count: number;
}

export async function listStrikes(db: Queryable, cfg: StrikeCfg): Promise<StrikeRow[]> {
  return (
    await db.query<StrikeRow>(
      `select s.id, s.doctor_id, u.full_name as doctor_name, s.source, to_char(s.day, 'YYYY-MM-DD') as day, s.reason, s.status, s.created_at, s.review_note,
              (select count(*)::int from doctor_strikes x where x.doctor_id = s.doctor_id and x.status = 'active'
                  and x.created_at > now() - make_interval(days => $1)) as active_count
         from doctor_strikes s join users u on u.id = s.doctor_id
        order by (s.status = 'active') desc, s.created_at desc limit 300`,
      [cfg.STRIKE_WINDOW_DAYS],
    )
  ).rows;
}

export async function waiveStrike(deps: Deps, admin: SessionUser, strikeId: string, rawNote: string, ip: string): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  const note = rawNote.trim();
  if (note.length < 3) throw new DomainError('admin.noteRequired');
  await deps.db.transaction(async (tx) => {
    const r = await tx.query<{ doctor_id: string }>(
      `update doctor_strikes set status = 'waived', reviewed_at = now(), reviewed_by = $2, review_note = $3
        where id = $1 and status = 'active' returning doctor_id`,
      [strikeId, admin.id, note.slice(0, 300)],
    );
    if (!r.rows[0]) throw notFound();
    await audit(tx, { actorId: admin.id, action: 'strike.waive', entityType: 'doctor_strike', entityId: strikeId, metadata: { doctorId: r.rows[0].doctor_id, note }, ip });
  });
}

// ---------------------------------------------------------------------------
// Cancelling a whole clinic day
// ---------------------------------------------------------------------------

/** How many bookings a day-cancel would cancel (shown before the doctor confirms). */
export async function bookingsOnDay(db: Queryable, doctorId: string, date: string, tz: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from appointments where doctor_id = $1 and status = 'confirmed' and starts_at >= $2 and starts_at < $3`,
    [doctorId, zonedToUtc(date, '00:00', tz), zonedToUtc(addDays(date, 1), '00:00', tz)],
  );
  return rows[0]?.n ?? 0;
}

/**
 * The doctor cannot work a day (emergency): every confirmed booking that day is cancelled and the
 * patient told, the rest of the day is blocked so nobody books it, and — if patients had booked
 * online — the doctor gets one strike for the day.
 */
export async function cancelDay(deps: Deps, doctor: SessionUser, date: string, rawReason: string, ip: string): Promise<number> {
  if (doctor.role !== 'doctor') throw notFound();
  const tz = deps.cfg.TIME_ZONE;
  const today = todayIn(tz, deps.now());
  if (!isValidDate(date) || date < today || date > addDays(today, 90)) throw new DomainError('dayoff.dateInvalid');
  const reason = rawReason.trim();
  if (reason.length < 3) throw new DomainError('dayoff.reasonRequired');
  const dayStart = zonedToUtc(date, '00:00', tz);
  const dayEnd = zonedToUtc(addDays(date, 1), '00:00', tz);
  return deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; starts_at: Date; booked_by: string; phone: string; locale: Locale }>(
      `update appointments a set status = 'cancelled', cancelled_by = 'doctor', cancelled_at = now(), updated_at = now()
        from appointments a2 left join users p on p.id = a2.patient_id
        where a.id = a2.id and a.doctor_id = $1 and a.status = 'confirmed' and a.starts_at >= $2 and a.starts_at < $3
        returning a.id, a.starts_at, a.booked_by, coalesce(p.phone_e164, a.walk_in_phone) as phone, coalesce(p.preferred_locale, 'ar') as locale`,
      [doctor.id, dayStart, dayEnd],
    );
    const slug = (await tx.query<{ slug: string }>('select slug from doctors where user_id = $1', [doctor.id])).rows[0]!.slug;
    for (const a of rows) {
      const t = translator(a.locale);
      await enqueueSms(tx, a.phone, t('sms.cancelledByDoctor', {
        doctor: doctor.fullName,
        when: formatDateTime(a.starts_at, a.locale, tz),
        link: `${deps.cfg.PUBLIC_ORIGIN}${a.locale === 'en' ? '/en' : ''}/doctors/${slug}`,
      }));
    }
    // Block what is left of the day so nobody books it.
    const from = new Date(Math.max(dayStart.getTime(), deps.now().getTime()));
    if (from < dayEnd) {
      await tx.query('insert into schedule_blocks (doctor_id, starts_at, ends_at, note) values ($1, $2, $3, $4)', [doctor.id, from, dayEnd, reason.slice(0, 200)]);
    }
    if (rows.some((a) => a.booked_by === 'patient')) {
      await addStrike(tx, { doctorId: doctor.id, source: 'day_cancel', day: date, reason, createdBy: doctor.id });
    }
    await audit(tx, { actorId: doctor.id, action: 'schedule.cancel_day', entityType: 'doctor', entityId: doctor.id, metadata: { date, cancelled: rows.length, reason }, ip });
    return rows.length;
  });
}

// ---------------------------------------------------------------------------
// Patient-reported visit problems
// ---------------------------------------------------------------------------

export const ISSUE_CATEGORIES = ['doctor_absent', 'long_wait', 'overcharged', 'wrong_no_show', 'behaviour', 'other'] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];
/** Problems can be reported up to this long after the visit time. */
export const ISSUE_WINDOW_DAYS = 3;

export interface IssueTarget {
  id: string;
  starts_at: Date;
  status: string;
  doctor_id: string;
  doctor_name: string;
  clinic_name: string;
  open_issue: boolean;
}

/** The patient's own visit that can still get a report: it happened (or was cancelled by the doctor) in the last few days. */
export async function issueTarget(deps: Deps, patientId: string, appointmentId: string): Promise<IssueTarget> {
  const { rows } = await deps.db.query<IssueTarget & { cancelled_by: string | null }>(
    `select a.id, a.starts_at, a.status, a.cancelled_by, a.doctor_id, u.full_name as doctor_name, c.name as clinic_name,
            exists (select 1 from visit_issues i where i.appointment_id = a.id and i.status = 'open') as open_issue
       from appointments a join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id
      where a.id = $1 and a.patient_id = $2`,
    [appointmentId, patientId],
  );
  const a = rows[0];
  if (!a) throw notFound();
  if (!canReport(a, deps.now())) throw new DomainError('issue.windowClosed');
  return a;
}

export function canReport(a: { starts_at: Date; status: string; cancelled_by?: string | null }, now: Date): boolean {
  const eligible = a.status === 'completed' || a.status === 'no_show' || a.status === 'arrived' || a.status === 'in_consultation' || (a.status === 'cancelled' && a.cancelled_by === 'doctor');
  const t = a.starts_at.getTime();
  return eligible && t <= now.getTime() + 24 * 3600_000 && now.getTime() - t <= ISSUE_WINDOW_DAYS * 86400_000;
}

export async function reportIssue(deps: Deps, patient: SessionUser, appointmentId: string, input: { category: string; description: string }, ip: string): Promise<void> {
  if (patient.role !== 'patient') throw notFound();
  const target = await issueTarget(deps, patient.id, appointmentId);
  if (!(ISSUE_CATEGORIES as readonly string[]).includes(input.category)) throw new DomainError('issue.categoryRequired');
  const description = input.description.trim();
  if (description.length < 10) throw new DomainError('issue.describe');
  if (description.length > 1000) throw new DomainError('issue.tooLong');
  try {
    await deps.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into visit_issues (appointment_id, patient_id, doctor_id, category, description) values ($1, $2, $3, $4, $5) returning id`,
        [target.id, patient.id, target.doctor_id, input.category, description],
      );
      await audit(tx, { actorId: patient.id, action: 'issue.report', entityType: 'visit_issue', entityId: rows[0]!.id, metadata: { category: input.category }, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e, 'visit_issues_one_open_idx')) throw new DomainError('issue.alreadyOpen');
    throw e;
  }
}

/** Latest report per appointment for the patient's list ("Reported" / "Resolved: …"). */
export async function patientIssues(db: Queryable, patientId: string): Promise<Map<string, { status: 'open' | 'resolved'; note: string | null }>> {
  const { rows } = await db.query<{ appointment_id: string; status: 'open' | 'resolved'; resolution_note: string | null }>(
    `select distinct on (appointment_id) appointment_id, status, resolution_note from visit_issues where patient_id = $1 order by appointment_id, created_at desc`,
    [patientId],
  );
  return new Map(rows.map((r) => [r.appointment_id, { status: r.status, note: r.resolution_note }]));
}

export interface AdminIssue {
  id: string;
  appointment_id: string;
  category: IssueCategory;
  description: string;
  status: 'open' | 'resolved';
  resolution_note: string | null;
  created_at: Date;
  patient_name: string;
  patient_phone: string;
  doctor_id: string;
  doctor_name: string;
  visit_at: Date;
  visit_status: string;
  no_show_waived: boolean;
}

export async function listIssues(db: Queryable): Promise<{ open: AdminIssue[]; recent: AdminIssue[] }> {
  const base = `select i.id, i.appointment_id, i.category, i.description, i.status, i.resolution_note, i.created_at,
                       p.full_name as patient_name, p.phone_e164 as patient_phone, i.doctor_id, du.full_name as doctor_name,
                       a.starts_at as visit_at, a.status as visit_status, a.no_show_waived
                  from visit_issues i join users p on p.id = i.patient_id join users du on du.id = i.doctor_id
                  join appointments a on a.id = i.appointment_id`;
  const [open, recent] = await Promise.all([
    db.query<AdminIssue>(`${base} where i.status = 'open' order by i.created_at limit 200`),
    db.query<AdminIssue>(`${base} where i.status = 'resolved' order by i.resolved_at desc limit 30`),
  ]);
  return { open: open.rows, recent: recent.rows };
}

/**
 * The admin closes a report with a note the patient can read, and may: waive a no-show that was
 * recorded by mistake (it stops counting against the patient) and/or add a strike to the doctor.
 */
export async function resolveIssue(
  deps: Deps,
  admin: SessionUser,
  issueId: string,
  input: { note: string; waiveNoShow: boolean; strikeDoctor: boolean },
  ip: string,
): Promise<void> {
  if (admin.role !== 'admin') throw notFound();
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('admin.noteRequired');
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ appointment_id: string; doctor_id: string; category: string }>(
      `update visit_issues set status = 'resolved', resolution_note = $3, resolved_by = $2, resolved_at = now()
        where id = $1 and status = 'open' returning appointment_id, doctor_id, category`,
      [issueId, admin.id, note.slice(0, 500)],
    );
    const i = rows[0];
    if (!i) throw notFound();
    if (input.waiveNoShow) {
      await tx.query(`update appointments set no_show_waived = true, updated_at = now() where id = $1 and status = 'no_show'`, [i.appointment_id]);
    }
    if (input.strikeDoctor) {
      await addStrike(tx, { doctorId: i.doctor_id, source: 'admin', appointmentId: i.appointment_id, reason: `${i.category}: ${note}`, createdBy: admin.id });
    }
    await audit(tx, {
      actorId: admin.id, action: 'issue.resolve', entityType: 'visit_issue', entityId: issueId,
      metadata: { waiveNoShow: input.waiveNoShow, strikeDoctor: input.strikeDoctor }, ip,
    });
  });
}
