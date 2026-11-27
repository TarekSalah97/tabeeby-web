import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { addDays, todayIn, zonedToUtc } from '../domain/time.js';
import { log, errorFields } from '../log.js';

/*
 * Demo site only: keeps Dr. Ahmed Hassan's "today" looking like a real clinic, with patient
 * Yasmin Farouk (01000000201) waiting in line, so the live waiting-time tracker can be shown any day.
 */

export const QUEUE_REASON = 'Demo live queue';
export const UPCOMING_REASON = 'Demo follow-up — Yasmin';
/** A past queue visit that a demo doctor worked on: kept, no longer part of the queue. */
const KEPT_REASON = 'Check-up';
const DEMO_DOCTOR_PHONE = '+201000000101';
/** Patients 01000000201 … 208; index 0 is Yasmin. */
const QUEUE_PATIENT_PHONES = Array.from({ length: 8 }, (_, i) => `+2010000002${String(i + 1).padStart(2, '0')}`);
/** Few enough to leave room under the per-patient limit on upcoming visits, so booking still works in a demo. */
const UPCOMING_DAYS = 2;
const HALF_HOUR = 30 * 60_000;

/**
 * Days the owner asked to show as empty in Dr. Ahmed's demo schedule: bookings that existed before
 * `before` are removed, and Yasmin's automatic booking skips the day. Bookings made later (for example
 * live in a demo) stay.
 */
export const EMPTY_DEMO_DAYS: readonly { date: string; before: Date }[] = [
  { date: '2026-11-28', before: new Date('2026-11-27T11:30:00Z') },
];

/**
 * Rebuilds today's queue around `now`: two visits done, one with the doctor, then two waiting
 * (patient index 7, then Yasmin, 3rd in line) and one more booked.
 */
export async function refreshTodayQueue(
  tx: Queryable,
  doctor: { userId: string; clinicId: string },
  patientIds: string[],
  nowDate: Date,
  tz: string,
): Promise<number> {
  const now = nowDate.getTime();
  const day = todayIn(tz, nowDate);
  const lo = zonedToUtc(day, '03:00', tz).getTime();
  const hi = zonedToUtc(day, '19:00', tz).getTime();
  const anchor = Math.floor(Math.min(hi, Math.max(lo, now)) / HALF_HOUR) * HALF_HOUR;
  const at = (min: number) => new Date(anchor + min * 60_000);
  const ago = (min: number) => new Date(now - min * 60_000);
  // [patient index, slot offset (min), status, consult started, completed]
  const plan: [number, number, string, Date | null, Date | null][] = [
    [4, -60, 'completed', ago(60), ago(35)],
    [5, -30, 'completed', ago(35), ago(12)],
    [6, 0, 'in_consultation', ago(12), null],
    [7, 30, 'arrived', null, null],
    [0, 60, 'arrived', null, null],
    [1, 90, 'confirmed', null, null],
  ];
  await tx.query('savepoint demo_queue');
  try {
    // Visits a demo doctor already worked on (a visit record, payment, review…) are kept as ordinary
    // history; only untouched queue bookings are replaced.
    await tx.query(
      `update appointments a set reason = $3 where a.doctor_id = $1 and a.reason = $2 and (
         exists (select 1 from encounters e where e.appointment_id = a.id) or exists (select 1 from payments p where p.appointment_id = a.id)
         or exists (select 1 from reviews r where r.appointment_id = a.id) or exists (select 1 from doctor_strikes s where s.appointment_id = a.id)
         or exists (select 1 from visit_issues v where v.appointment_id = a.id))`,
      [doctor.userId, QUEUE_REASON, KEPT_REASON],
    );
    await tx.query('delete from appointments where doctor_id = $1 and reason = $2', [doctor.userId, QUEUE_REASON]);
    // Make room: nothing else of this doctor's may overlap the demo queue today.
    await tx.query(
      `update appointments set status = 'cancelled', cancelled_by = 'doctor', cancelled_at = now()
        where doctor_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2`,
      [doctor.userId, at(-60), at(120)],
    );
    for (const [i, offset, status, started, done] of plan) {
      const start = at(offset);
      await tx.query(
        `insert into appointments (doctor_id, clinic_id, patient_id, booked_by, starts_at, ends_at, visit_type, reason, fee_egp, status,
                                   arrived_at, consult_started_at, completed_at)
         values ($1, $2, $3, 'patient', $4, $5, 'new', $6, 500, $7, $8, $9, $10)`,
        [doctor.userId, doctor.clinicId, patientIds[i], start, new Date(start.getTime() + HALF_HOUR), QUEUE_REASON, status,
          status === 'confirmed' ? null : ago(70), started, done],
      );
    }
    await tx.query('release savepoint demo_queue');
    return plan.length;
  } catch (err) {
    // The demo queue is a nice-to-have: never let it stop the demo.
    await tx.query('rollback to savepoint demo_queue');
    log.warn('demo queue skipped', errorFields(err));
    return 0;
  }
}

/** A booking for Yasmin on each of the coming days (first free half hour from 12:00 in clinic hours). */
async function ensureUpcoming(tx: Queryable, doctor: { userId: string; clinicId: string }, yasminId: string, nowDate: Date, tz: string, maxActive: number): Promise<number> {
  const today = todayIn(tz, nowDate);
  // Bookings beyond the window (from an earlier version that booked two weeks ahead) are removed.
  await tx.query('delete from appointments where patient_id = $1 and reason = $2 and starts_at >= $3',
    [yasminId, UPCOMING_REASON, zonedToUtc(addDays(today, UPCOMING_DAYS + 1), '00:00', tz)]);
  let added = 0;
  for (let offset = 1; offset <= UPCOMING_DAYS; offset++) {
    // Always leave at least two free places under the limit for a live booking in a demo.
    const active = await tx.query<{ n: number }>(
      `select count(*)::int as n from appointments where patient_id = $1 and status in ('confirmed', 'arrived', 'in_consultation') and starts_at > now()`,
      [yasminId],
    );
    if ((active.rows[0]?.n ?? 0) >= maxActive - 2) break;
    const date = addDays(today, offset);
    if (EMPTY_DEMO_DAYS.some((d) => d.date === date)) continue;
    const [from, to] = [zonedToUtc(date, '00:00', tz), zonedToUtc(addDays(date, 1), '00:00', tz)];
    const has = await tx.query(
      `select 1 from appointments where doctor_id = $1 and patient_id = $2 and status <> 'cancelled' and starts_at >= $3 and starts_at < $4 limit 1`,
      [doctor.userId, yasminId, from, to],
    );
    if (has.rows.length) continue;
    for (let t = zonedToUtc(date, '12:00', tz).getTime(); t + HALF_HOUR <= zonedToUtc(date, '22:00', tz).getTime(); t += HALF_HOUR) {
      const start = new Date(t);
      const end = new Date(t + HALF_HOUR);
      const clash = await tx.query(
        `select 1 from appointments where doctor_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2 limit 1`,
        [doctor.userId, start, end],
      );
      if (clash.rows.length) continue;
      await tx.query(
        `insert into appointments (doctor_id, clinic_id, patient_id, booked_by, starts_at, ends_at, visit_type, reason, fee_egp)
         values ($1, $2, $3, 'patient', $4, $5, 'follow_up', $6, 250)`,
        [doctor.userId, doctor.clinicId, yasminId, start, end, UPCOMING_REASON],
      );
      added++;
      break;
    }
  }
  return added;
}

/** Empties the owner's chosen days (only bookings from before the request, with nothing attached). */
async function clearEmptyDays(tx: Queryable, doctorId: string, tz: string): Promise<void> {
  for (const d of EMPTY_DEMO_DAYS) {
    await tx.query(
      `delete from appointments a
        where a.doctor_id = $1 and a.starts_at >= $2 and a.starts_at < $3 and a.created_at < $4
          and not exists (select 1 from encounters e where e.appointment_id = a.id)
          and not exists (select 1 from payments p where p.appointment_id = a.id)
          and not exists (select 1 from reviews r where r.appointment_id = a.id)
          and not exists (select 1 from doctor_strikes s where s.appointment_id = a.id)
          and not exists (select 1 from visit_issues v where v.appointment_id = a.id)`,
      [doctorId, zonedToUtc(d.date, '00:00', tz), zonedToUtc(addDays(d.date, 1), '00:00', tz), d.before],
    );
  }
}

/**
 * Runs from the background worker on the demo site: if Yasmin has no visit waiting today (a new
 * day, or her visit was just finished in a demo), today's queue is rebuilt; her next two days are
 * kept booked, leaving room under the upcoming-visit limit for a live booking. Does nothing outside demo mode.
 */
export async function keepDemoQueue(deps: Deps): Promise<'off' | 'missing' | 'ok' | 'rebuilt'> {
  if (!deps.cfg.DEMO_MODE) return 'off';
  const tz = deps.cfg.TIME_ZONE;
  const now = deps.now();
  const doc = (await deps.db.query<{ user_id: string; clinic_id: string }>(
    `select d.user_id, c.id as clinic_id from doctors d join users u on u.id = d.user_id
       join clinics c on c.doctor_id = d.user_id and c.is_active
      where u.phone_e164 = $1 order by c.created_at limit 1`,
    [DEMO_DOCTOR_PHONE],
  )).rows[0];
  const people = (await deps.db.query<{ id: string; phone_e164: string }>(
    `select id, phone_e164 from users where phone_e164 = any($1::text[]) and status = 'active'`,
    [QUEUE_PATIENT_PHONES],
  )).rows;
  const patientIds = QUEUE_PATIENT_PHONES.map((p) => people.find((u) => u.phone_e164 === p)?.id);
  if (!doc || patientIds.some((id) => !id)) return 'missing';
  const doctor = { userId: doc.user_id, clinicId: doc.clinic_id };
  const yasmin = patientIds[0]!;
  const today = todayIn(tz, now);
  const [dayStart, dayEnd] = [zonedToUtc(today, '00:00', tz), zonedToUtc(addDays(today, 1), '00:00', tz)];
  const waiting = await deps.db.query(
    `select 1 from appointments where doctor_id = $1 and patient_id = $2 and reason = $5 and status in ('confirmed', 'arrived', 'in_consultation')
        and starts_at >= $3 and starts_at < $4 limit 1`,
    [doctor.userId, yasmin, dayStart, dayEnd, QUEUE_REASON],
  );
  let rebuilt = false;
  await deps.db.transaction(async (tx) => {
    if (!waiting.rows.length) {
      // Her plain booking for today (made on an earlier day) gives way to her place in the queue.
      await tx.query('delete from appointments where doctor_id = $1 and patient_id = $2 and reason = $3 and starts_at >= $4 and starts_at < $5',
        [doctor.userId, yasmin, UPCOMING_REASON, dayStart, dayEnd]);
      rebuilt = (await refreshTodayQueue(tx, doctor, patientIds as string[], now, tz)) > 0;
    }
    await clearEmptyDays(tx, doctor.userId, tz);
    await ensureUpcoming(tx, doctor, yasmin, now, tz, deps.cfg.MAX_ACTIVE_APPOINTMENTS_PER_PATIENT);
  });
  return rebuilt ? 'rebuilt' : 'ok';
}
