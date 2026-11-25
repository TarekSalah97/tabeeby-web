import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import type { MessageKey } from '../i18n/index.js';
import { translator, formatTime, type Locale } from '../i18n/index.js';
import type { Frequency, MedicineForm, Timing } from '../domain/clinical.js';
import { addDays, todayIn, toZoned, weekdayOf } from '../domain/time.js';
import { MAX_DAYS, cleanTimes, dosesOn, dueBetween, durationDays, isOngoing, suggestedTimes, type ReminderSchedule } from '../domain/medReminders.js';
import { notFound } from '../http/errors.js';
import { audit } from './audit.js';
import { log, errorFields } from '../log.js';
import { validSubscription, type PushSender, type PushSubscriptionKeys } from './webPush.js';

/*
 * Medicine reminders for patients. Everything is scoped to the signed-in patient and to their own,
 * still-valid prescriptions. Notifications go to the phones / browsers they turned on.
 */

export interface RxItem {
  position: number;
  medicine: string;
  form: MedicineForm;
  dose: string;
  frequency: Frequency;
  timing: Timing | null;
  duration: string | null;
  instructions: string | null;
}

export interface MedicineReminder extends ReminderSchedule {
  id: string;
  prescriptionId: string;
  position: number;
  isActive: boolean;
  item: RxItem;
  doctorName: string;
}

export interface SetupItem extends RxItem {
  /** Times to show: the patient's own if a reminder exists, else the doctor-based suggestion. */
  times: string[] | null;
  days: number | null;
  weekday: number | null;
  reminder: MedicineReminder | null;
}

export interface RxForSetup {
  id: string;
  issuedAt: Date;
  doctorName: string;
  items: SetupItem[];
}

/** The patient's own active prescription, with each medicine's current or suggested schedule. */
export async function prescriptionForSetup(db: Queryable, patientId: string, rxId: string, tz: string, now: Date): Promise<RxForSetup> {
  const { rows } = await db.query<{ id: string; issued_at: Date; doctor_name: string }>(
    `select p.id, p.issued_at, u.full_name as doctor_name
       from prescriptions p join encounters e on e.id = p.encounter_id join patient_records r on r.id = e.record_id
       join users u on u.id = p.doctor_id
      where p.id = $1 and r.patient_user_id = $2 and p.status = 'active'`,
    [rxId, patientId],
  );
  const rx = rows[0];
  if (!rx) throw notFound();
  const items = await db.query<RxItem>(
    'select position, medicine, form, dose, frequency, timing, duration, instructions from prescription_items where prescription_id = $1 order by position',
    [rxId],
  );
  const existing = new Map((await listReminders(db, patientId, { prescriptionId: rxId })).map((r) => [r.position, r]));
  const today = todayIn(tz, now);
  return {
    id: rx.id,
    issuedAt: rx.issued_at,
    doctorName: rx.doctor_name,
    items: items.rows.map((it) => {
      const own = existing.get(it.position) ?? null;
      const ownDays = own?.endDate ? Math.round((Date.parse(own.endDate) - Date.parse(today)) / 86400000) + 1 : null;
      return {
        ...it,
        times: own ? [...own.times] : suggestedTimes(it.frequency, it.timing),
        days: own ? (own.endDate ? Math.max(1, ownDays ?? 1) : null) : isOngoing(it.duration) ? null : (durationDays(it.duration) ?? 7),
        weekday: own ? own.weekday : it.frequency === 'weekly' ? weekdayOf(today) : null,
        reminder: own && own.isActive ? own : null,
      };
    }),
  };
}

interface ReminderRow {
  id: string;
  prescription_id: string;
  position: number;
  times: string[];
  weekday: number | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  doctor_name: string;
  medicine: string;
  form: MedicineForm;
  dose: string;
  frequency: Frequency;
  timing: Timing | null;
  duration: string | null;
  instructions: string | null;
}

const REMINDER_SELECT = `
  select m.id, m.prescription_id, m.position, m.times, m.weekday, m.start_date::text as start_date, m.end_date::text as end_date, m.is_active,
         du.full_name as doctor_name, i.medicine, i.form, i.dose, i.frequency, i.timing, i.duration, i.instructions
    from medicine_reminders m
    join prescription_items i on i.prescription_id = m.prescription_id and i.position = m.position
    join prescriptions p on p.id = m.prescription_id and p.status = 'active'
    join users du on du.id = p.doctor_id`;

function toReminder(r: ReminderRow): MedicineReminder {
  return {
    id: r.id,
    prescriptionId: r.prescription_id,
    position: r.position,
    times: r.times,
    weekday: r.weekday,
    startDate: r.start_date,
    endDate: r.end_date,
    isActive: r.is_active,
    doctorName: r.doctor_name,
    item: { position: r.position, medicine: r.medicine, form: r.form, dose: r.dose, frequency: r.frequency, timing: r.timing, duration: r.duration, instructions: r.instructions },
  };
}

export async function listReminders(db: Queryable, patientId: string, o: { prescriptionId?: string; activeOn?: string } = {}): Promise<MedicineReminder[]> {
  const { rows } = await db.query<ReminderRow>(
    `${REMINDER_SELECT}
      where m.patient_id = $1 and ($2::uuid is null or m.prescription_id = $2)
        and ($3::date is null or (m.is_active and (m.end_date is null or m.end_date >= $3)))
      order by m.created_at, m.position`,
    [patientId, o.prescriptionId ?? null, o.activeOn ?? null],
  );
  return rows.map(toReminder);
}

export interface SetupInput {
  position: number;
  on: boolean;
  times: string[];
  /** null = until the patient stops it. */
  days: number | null;
  weekday: number | null;
}

/** Turns reminders on / off / changes them for the medicines of one prescription. */
export async function saveReminders(deps: Deps, patientId: string, rxId: string, input: SetupInput[], ip: string): Promise<MessageKey | null> {
  const tz = deps.cfg.TIME_ZONE;
  const now = deps.now();
  const rx = await prescriptionForSetup(deps.db, patientId, rxId, tz, now);
  const today = todayIn(tz, now);
  const plan: { item: SetupItem; times: string[]; endDate: string | null; weekday: number | null; on: boolean }[] = [];
  for (const it of rx.items) {
    const want = input.find((x) => x.position === it.position);
    if (!want) continue;
    if (!want.on) {
      plan.push({ item: it, times: [], endDate: null, weekday: null, on: false });
      continue;
    }
    if (suggestedTimes(it.frequency, it.timing) === null && it.frequency !== 'as_needed') return 'med.err.notScheduled';
    const times = cleanTimes(want.times);
    if (!times) return 'med.err.times';
    if (want.days !== null && (!Number.isInteger(want.days) || want.days < 1 || want.days > MAX_DAYS)) return 'med.err.days';
    const weekday = it.frequency === 'weekly' ? (want.weekday !== null && want.weekday >= 0 && want.weekday <= 6 ? want.weekday : weekdayOf(today)) : null;
    plan.push({ item: it, times, endDate: want.days === null ? null : addDays(today, want.days - 1), weekday, on: true });
  }
  if (!plan.some((p) => p.on) && !plan.some((p) => p.item.reminder)) return 'med.err.none';
  await deps.db.transaction(async (tx) => {
    for (const p of plan) {
      if (!p.on) {
        await tx.query(
          `update medicine_reminders set is_active = false, updated_at = now() where patient_id = $1 and prescription_id = $2 and position = $3`,
          [patientId, rxId, p.item.position],
        );
        continue;
      }
      await tx.query(
        `insert into medicine_reminders (patient_id, prescription_id, position, times, weekday, start_date, end_date)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (patient_id, prescription_id, position) do update
           set times = excluded.times, weekday = excluded.weekday, start_date = excluded.start_date, end_date = excluded.end_date,
               is_active = true, updated_at = now()`,
        [patientId, rxId, p.item.position, p.times, p.weekday, today, p.endDate],
      );
    }
    await audit(tx, { actorId: patientId, action: 'medicine_reminders.save', entityType: 'prescription', entityId: rxId, metadata: { on: plan.filter((p) => p.on).length }, ip });
  });
  return null;
}

export async function stopReminder(deps: Deps, patientId: string, id: string, ip: string): Promise<void> {
  const { rowCount } = await deps.db.query(`update medicine_reminders set is_active = false, updated_at = now() where id = $1 and patient_id = $2`, [id, patientId]);
  if (!rowCount) throw notFound();
  await audit(deps.db, { actorId: patientId, action: 'medicine_reminders.stop', entityType: 'medicine_reminder', entityId: id, ip });
}

// ---------------------------------------------------------------- today's doses

export interface Dose {
  reminderId: string;
  dueAt: Date;
  medicine: string;
  dose: string;
  form: MedicineForm;
  timing: Timing | null;
  takenAt: Date | null;
}

export async function dosesForDay(db: Queryable, patientId: string, date: string, tz: string): Promise<Dose[]> {
  const reminders = await listReminders(db, patientId, { activeOn: date });
  const doses = reminders.flatMap((r) =>
    dosesOn(r, date, tz).map((dueAt) => ({ reminderId: r.id, dueAt, medicine: r.item.medicine, dose: r.item.dose, form: r.item.form, timing: r.item.timing, takenAt: null as Date | null })),
  );
  if (doses.length) {
    const { rows } = await db.query<{ reminder_id: string; due_at: Date; taken_at: Date }>(
      `select reminder_id, due_at, taken_at from medicine_doses where reminder_id = any($1::uuid[]) and taken_at is not null and due_at between $2 and $3`,
      [reminders.map((r) => r.id), doses[0]!.dueAt, doses.reduce((a, d) => (d.dueAt > a ? d.dueAt : a), doses[0]!.dueAt)],
    );
    for (const d of doses) d.takenAt = rows.find((r) => r.reminder_id === d.reminderId && r.due_at.getTime() === d.dueAt.getTime())?.taken_at ?? null;
  }
  return doses.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.medicine.localeCompare(b.medicine));
}

/** Ticks (or unticks) one dose. Only real doses of the patient's own reminders, up to 2 hours early. */
export async function markDose(deps: Deps, patientId: string, reminderId: string, dueIso: string, taken: boolean): Promise<MessageKey | null> {
  const due = new Date(dueIso);
  if (Number.isNaN(due.getTime())) return 'med.err.dose';
  const tz = deps.cfg.TIME_ZONE;
  const r = (await listReminders(deps.db, patientId)).find((x) => x.id === reminderId);
  if (!r) throw notFound();
  if (!dosesOn(r, toZoned(due, tz).date, tz).some((d) => d.getTime() === due.getTime())) return 'med.err.dose';
  if (taken && due.getTime() > deps.now().getTime() + 2 * 3600_000) return 'med.err.tooEarly';
  await deps.db.query(
    `insert into medicine_doses (reminder_id, due_at, taken_at) values ($1, $2, $3)
     on conflict (reminder_id, due_at) do update set taken_at = excluded.taken_at`,
    [reminderId, due, taken ? deps.now() : null],
  );
  return null;
}

// ---------------------------------------------------------------- phones (push subscriptions)

export async function saveSubscription(deps: Deps, userId: string, sub: PushSubscriptionKeys): Promise<boolean> {
  if (!validSubscription(sub)) return false;
  // The same browser may have been used by someone else before: it now belongs to this user.
  await deps.db.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)
     on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failure_count = 0`,
    [userId, sub.endpoint, sub.p256dh, sub.auth],
  );
  // Keep it bounded per person (old phones fall off).
  await deps.db.query(
    `delete from push_subscriptions where user_id = $1 and id not in (select id from push_subscriptions where user_id = $1 order by created_at desc limit 10)`,
    [userId],
  );
  return true;
}

export async function removeSubscription(db: Queryable, userId: string, endpoint: string): Promise<void> {
  await db.query('delete from push_subscriptions where user_id = $1 and endpoint = $2', [userId, endpoint]);
}

export async function countSubscriptions(db: Queryable, userId: string): Promise<number> {
  return (await db.query<{ n: number }>('select count(*)::int as n from push_subscriptions where user_id = $1', [userId])).rows[0]?.n ?? 0;
}

export async function setShowNames(db: Queryable, userId: string, show: boolean): Promise<void> {
  await db.query('update users set reminder_show_names = $2 where id = $1', [userId, show]);
}

async function pushToUser(db: Queryable, push: PushSender, userId: string, payload: object, ttl: number): Promise<number> {
  const { rows } = await db.query<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    'select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1',
    [userId],
  );
  let delivered = 0;
  for (const s of rows) {
    const outcome = await push.send(s, JSON.stringify(payload), ttl);
    if (outcome === 'ok') {
      delivered++;
      await db.query('update push_subscriptions set last_success_at = now(), failure_count = 0 where id = $1', [s.id]);
    } else if (outcome === 'gone') {
      await db.query('delete from push_subscriptions where id = $1', [s.id]);
    } else {
      await db.query('update push_subscriptions set failure_count = failure_count + 1 where id = $1', [s.id]);
      await db.query('delete from push_subscriptions where id = $1 and failure_count >= 20', [s.id]);
    }
  }
  return delivered;
}

export async function sendTestNotification(deps: Deps, userId: string, locale: Locale): Promise<number> {
  if (!deps.push) return 0;
  const t = translator(locale);
  return pushToUser(deps.db, deps.push, userId, { title: t('med.push.testTitle'), body: t('med.push.testBody'), url: locale === 'en' ? '/en/medicines' : '/medicines', tag: 'test' }, 300);
}

// ---------------------------------------------------------------- the worker

/** Missed by more than this (e.g. the server was asleep), a dose is not notified late. */
const CATCH_UP_MS = 15 * 60_000;

/**
 * Notifies doses that fell due since the last run. Claiming each dose with an insert makes it
 * exactly-once even with several workers; a dose already ticked as taken is skipped.
 */
export async function sendDueReminders(deps: Deps): Promise<number> {
  if (!deps.push) return 0;
  const tz = deps.cfg.TIME_ZONE;
  const now = deps.now();
  const from = new Date(now.getTime() - CATCH_UP_MS);
  const today = todayIn(tz, now);
  const { rows } = await deps.db.query<ReminderRow & { patient_id: string; locale: Locale; show_names: boolean }>(
    `${REMINDER_SELECT.replace('select m.id,', 'select m.patient_id, u.preferred_locale as locale, u.reminder_show_names as show_names, m.id,')}
       join users u on u.id = m.patient_id and u.status = 'active'
      where m.is_active and m.start_date <= $1::date + 1 and (m.end_date is null or m.end_date >= $1::date - 1)
        and exists (select 1 from push_subscriptions s where s.user_id = m.patient_id)`,
    [today],
  );
  const groups = new Map<string, { patientId: string; locale: Locale; showNames: boolean; dueAt: Date; items: string[] }>();
  for (const r of rows) {
    for (const dueAt of dueBetween(toReminder(r), from, now, tz)) {
      const claimed = await deps.db.query(
        `insert into medicine_doses (reminder_id, due_at, notified_at) values ($1, $2, $3) on conflict do nothing returning reminder_id`,
        [r.id, dueAt, now],
      );
      if (!claimed.rows.length) continue;
      const key = `${r.patient_id}|${dueAt.toISOString()}`;
      const g = groups.get(key) ?? { patientId: r.patient_id, locale: r.locale, showNames: r.show_names, dueAt, items: [] };
      g.items.push(`${r.medicine} — ${r.dose}`);
      groups.set(key, g);
    }
  }
  let sent = 0;
  for (const g of groups.values()) {
    const t = translator(g.locale);
    const time = formatTime(g.dueAt, g.locale, tz);
    const body = g.showNames ? g.items.join('\n') : t(g.items.length === 1 ? 'med.push.bodyOne' : 'med.push.bodyMany', { n: g.items.length, time });
    try {
      sent += await pushToUser(deps.db, deps.push, g.patientId, {
        title: t('med.push.title'),
        body,
        url: g.locale === 'en' ? '/en/medicines' : '/medicines',
        tag: `dose-${g.dueAt.toISOString()}`,
      }, 3600);
    } catch (err) {
      log.error('medicine reminder push failed', errorFields(err));
    }
  }
  return sent;
}

// ---------------------------------------------------------------- calendar file

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds lines at 75 bytes as the calendar format requires (without splitting a character). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * A calendar file with one repeating event per dose time, each with an alarm. Times are "floating"
 * (the phone's own clock), which is what a patient in Egypt expects.
 */
export function reminderCalendar(reminders: MedicineReminder[], t: (k: MessageKey, v?: Record<string, string | number>) => string, stamp: Date): string {
  const dt = (date: string, time: string) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tabeeby//Medicine reminders//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEscape(t('med.calendarName'))}`];
  const now = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const r of reminders) {
    for (const time of r.times) {
      let start = r.startDate;
      if (r.weekday !== null) while (weekdayOf(start) !== r.weekday) start = addDays(start, 1);
      const rule = [`FREQ=${r.weekday === null ? 'DAILY' : 'WEEKLY'}`, ...(r.weekday === null ? [] : [`BYDAY=${DAY[r.weekday]}`]), ...(r.endDate ? [`UNTIL=${dt(r.endDate, '23:59')}`] : [])].join(';');
      const summary = `${r.item.medicine} — ${r.item.dose}`;
      const desc = [t('med.calendarFrom', { doctor: r.doctorName }), r.item.instructions ?? ''].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${r.id}-${time.replace(':', '')}@tabeeby`,
        `DTSTAMP:${now}`,
        `DTSTART:${dt(start, time)}`,
        'DURATION:PT10M',
        `RRULE:${rule}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(desc)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(summary)}`,
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
