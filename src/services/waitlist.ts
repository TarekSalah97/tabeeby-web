import type { Deps } from '../http/context.js';
import type { Queryable, Tx } from '../db/db.js';
import { isUniqueViolation } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { smsEnabled } from '../config.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { todayIn, isValidDate, toZoned } from '../domain/time.js';
import { slotsForDoctors } from './availability.js';
import { enqueueSms } from './outbox.js';
import { audit } from './audit.js';
import { translator, formatDate, type Locale } from '../i18n/index.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';

/** How many days a patient can be waiting for at the same time. */
export const MAX_ACTIVE_WAITLIST = 3;

/**
 * Days in the booking window when this clinic is open but every slot is taken.
 * (Days off and past slots are not "full": nothing would ever open up there.)
 */
export async function fullDays(deps: Deps, db: Queryable, doctorId: string, clinicId: string): Promise<string[]> {
  const now = deps.now();
  const opts = { days: deps.cfg.BOOKING_HORIZON_DAYS, now, clinicId };
  const [free, potential] = await Promise.all([
    slotsForDoctors(db, deps.cfg, [doctorId], opts),
    slotsForDoctors(db, deps.cfg, [doctorId], { ...opts, ignoreAppointments: true }),
  ]);
  const freeDates = new Set((free.get(doctorId) ?? []).map((s) => s.date));
  const openDates = [...new Set((potential.get(doctorId) ?? []).map((s) => s.date))];
  return openDates.filter((d) => !freeDates.has(d));
}

export async function joinWaitlist(deps: Deps, patient: SessionUser, clinicId: string, date: string, ip: string): Promise<void> {
  if (patient.role !== 'patient') throw new DomainError('booking.notPatient');
  if (smsEnabled(deps.cfg) && !patient.phoneVerified) throw new DomainError('booking.verifyPhoneFirst');
  if (!isValidDate(date)) throw new DomainError('waitlist.notAvailable');
  if (!(await hitRateLimit(deps.db, `waitlist:${patient.id}`, LIMITS.waitlistPerUser.limit, LIMITS.waitlistPerUser.window))) throw tooManyRequests();

  const { rows } = await deps.db.query<{ doctor_id: string }>(
    `select c.doctor_id from clinics c join doctors d on d.user_id = c.doctor_id join users u on u.id = d.user_id
      where c.id = $1 and c.is_active and d.verification_status = 'approved' and u.status = 'active'`,
    [clinicId],
  );
  const doctorId = rows[0]?.doctor_id;
  if (!doctorId) throw new DomainError('booking.doctorUnavailable');

  try {
    await deps.db.transaction(async (tx) => {
      // Serialise this patient's waitlist changes so the limit cannot be raced.
      await tx.query('select 1 from users where id = $1 for update', [patient.id]);
      const today = todayIn(deps.cfg.TIME_ZONE, deps.now());
      const active = await tx.query<{ n: number }>(
        `select count(*)::int as n from waitlist_entries where patient_id = $1 and status in ('waiting', 'notified') and wanted_date >= $2`,
        [patient.id, today],
      );
      if ((active.rows[0]?.n ?? 0) >= MAX_ACTIVE_WAITLIST) throw new DomainError('waitlist.tooMany');
      const full = await fullDays(deps, tx, doctorId, clinicId);
      if (!full.includes(date)) {
        const free = await slotsForDoctors(tx, deps.cfg, [doctorId], { fromDate: date, days: 1, now: deps.now(), clinicId });
        throw new DomainError((free.get(doctorId) ?? []).length ? 'waitlist.hasSlots' : 'waitlist.notAvailable');
      }
      const ins = await tx.query<{ id: string }>(
        `insert into waitlist_entries (patient_id, doctor_id, clinic_id, wanted_date) values ($1, $2, $3, $4) returning id`,
        [patient.id, doctorId, clinicId, date],
      );
      await audit(tx, { actorId: patient.id, action: 'waitlist.join', entityType: 'waitlist_entry', entityId: ins.rows[0]!.id, ip });
    });
  } catch (e) {
    if (isUniqueViolation(e, 'waitlist_one_active_idx')) throw new DomainError('waitlist.already');
    throw e;
  }
}

export async function leaveWaitlist(deps: Deps, patient: SessionUser, entryId: string, ip: string): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const { rowCount } = await tx.query(
      `update waitlist_entries set status = 'left', updated_at = now() where id = $1 and patient_id = $2 and status in ('waiting', 'notified')`,
      [entryId, patient.id],
    );
    if (!rowCount) throw notFound();
    await audit(tx, { actorId: patient.id, action: 'waitlist.leave', entityType: 'waitlist_entry', entityId: entryId, ip });
  });
}

export interface PatientWaitlistEntry {
  id: string;
  wanted_date: string;
  status: 'waiting' | 'notified';
  clinic_id: string;
  clinic_name: string;
  doctor_name: string;
  doctor_slug: string;
}

export async function listPatientWaitlist(deps: Deps, patientId: string): Promise<PatientWaitlistEntry[]> {
  const today = todayIn(deps.cfg.TIME_ZONE, deps.now());
  return (
    await deps.db.query<PatientWaitlistEntry>(
      `select w.id, to_char(w.wanted_date, 'YYYY-MM-DD') as wanted_date, w.status, w.clinic_id, c.name as clinic_name,
              u.full_name as doctor_name, d.slug as doctor_slug
         from waitlist_entries w join clinics c on c.id = w.clinic_id
         join doctors d on d.user_id = w.doctor_id join users u on u.id = w.doctor_id
        where w.patient_id = $1 and w.status in ('waiting', 'notified') and w.wanted_date >= $2
        order by w.wanted_date, w.created_at`,
      [patientId, today],
    )
  ).rows;
}

/** Days this patient is already waiting for at a clinic (to show "You're on the waitlist"). */
export async function waitingDates(deps: Deps, patientId: string, clinicId: string): Promise<string[]> {
  const today = todayIn(deps.cfg.TIME_ZONE, deps.now());
  const { rows } = await deps.db.query<{ d: string }>(
    `select to_char(wanted_date, 'YYYY-MM-DD') as d from waitlist_entries
      where patient_id = $1 and clinic_id = $2 and status in ('waiting', 'notified') and wanted_date >= $3`,
    [patientId, clinicId, today],
  );
  return rows.map((r) => r.d);
}

/**
 * Called in the same transaction that cancels an appointment: everyone waiting for that clinic
 * and day is told a place opened. Runs only for future appointments (a past slot cannot be rebooked).
 */
export async function notifyWaitlist(deps: Deps, tx: Tx, appt: { clinic_id: string; starts_at: Date; doctor_name: string; doctor_slug: string }): Promise<number> {
  if (appt.starts_at.getTime() <= deps.now().getTime()) return 0;
  const date = toZoned(appt.starts_at, deps.cfg.TIME_ZONE).date;
  const { rows } = await tx.query<{ id: string; phone_e164: string; preferred_locale: Locale }>(
    `update waitlist_entries w set status = 'notified', notified_at = now(), updated_at = now()
       from users p
      where p.id = w.patient_id and w.clinic_id = $1 and w.wanted_date = $2 and w.status in ('waiting', 'notified')
      returning w.id, p.phone_e164, p.preferred_locale`,
    [appt.clinic_id, date],
  );
  for (const r of rows) {
    const t = translator(r.preferred_locale);
    await enqueueSms(
      tx,
      r.phone_e164,
      t('sms.waitlistOpened', {
        doctor: appt.doctor_name,
        date: formatDate(appt.starts_at, r.preferred_locale, deps.cfg.TIME_ZONE),
        link: `${deps.cfg.PUBLIC_ORIGIN}${r.preferred_locale === 'en' ? '/en' : ''}/doctors/${appt.doctor_slug}?clinic=${appt.clinic_id}&date=${date}`,
      }),
    );
  }
  return rows.length;
}

/** Booking a place closes the patient's waitlist entry for that clinic and day. */
export async function closeOnBooking(tx: Tx, tz: string, patientId: string, clinicId: string, startsAt: Date): Promise<void> {
  await tx.query(
    `update waitlist_entries set status = 'booked', updated_at = now()
      where patient_id = $1 and clinic_id = $2 and wanted_date = $3 and status in ('waiting', 'notified')`,
    [patientId, clinicId, toZoned(startsAt, tz).date],
  );
}

/** Entries for days that have passed are marked expired (housekeeping; reads already ignore them). */
export async function expireOldEntries(db: Queryable, tz: string, now: Date): Promise<void> {
  await db.query(`update waitlist_entries set status = 'expired', updated_at = now() where status in ('waiting', 'notified') and wanted_date < $1`, [todayIn(tz, now)]);
}
