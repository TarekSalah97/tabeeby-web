import type { Deps } from '../http/context.js';
import type { Queryable } from '../db/db.js';
import { isExclusionViolation } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import type { Slot } from '../domain/availability.js';
import { priceOf, type ClinicPrices, type VisitType } from '../domain/visitPricing.js';
import { normalizeEgyptMobile } from '../domain/phone.js';
import { addDays, isValidDate, todayIn, toZoned } from '../domain/time.js';
import { slotsForDoctors } from './availability.js';
import { queueBookedNotices, type BookingTarget } from './booking.js';
import { closeOnBooking } from './waitlist.js';
import { audit } from './audit.js';
import { DomainError, notFound } from '../http/errors.js';
import type { FieldErrors } from './accounts.js';
import type { Locale } from '../i18n/index.js';

/** How far ahead the clinic itself can book (further than patients, for follow-ups). */
export const CLINIC_BOOKING_DAYS = 90;
/** A walk-in can take the slot that is running right now, up to this many minutes after it started. */
const RUNNING_SLOT_GRACE_MINUTES = 60;

export interface ClinicForBooking extends ClinicPrices {
  id: string;
  name: string;
  address: string;
  phone: string | null;
}

export async function ownActiveClinics(db: Queryable, doctorId: string): Promise<ClinicForBooking[]> {
  const { rows } = await db.query<{ id: string; name: string; address: string; phone_e164: string | null; fee_egp: number; follow_up_fee_egp: number | null; follow_up_days: number }>(
    `select id, name, address, phone_e164, fee_egp, follow_up_fee_egp, follow_up_days from clinics
      where doctor_id = $1 and is_active order by created_at`,
    [doctorId],
  );
  return rows.map((c) => ({ id: c.id, name: c.name, address: c.address, phone: c.phone_e164, fee: c.fee_egp, followUpFee: c.follow_up_fee_egp, followUpDays: c.follow_up_days }));
}

/** The date range the clinic may book: today up to CLINIC_BOOKING_DAYS ahead. */
export function clampClinicDate(requested: string, today: string): string {
  if (!isValidDate(requested) || requested < today) return today;
  const last = addDays(today, CLINIC_BOOKING_DAYS);
  return requested > last ? last : requested;
}

/**
 * Free slots the clinic can fill on one day. Unlike online booking there is no minimum notice,
 * and a slot that already started (a patient walking in now) can still be taken.
 */
export async function clinicSlots(deps: Deps, db: Queryable, doctorId: string, clinicId: string, date: string): Promise<Slot[]> {
  const now = deps.now();
  const slots = await slotsForDoctors(
    db,
    { TIME_ZONE: deps.cfg.TIME_ZONE, BOOKING_MIN_LEAD_MINUTES: -RUNNING_SLOT_GRACE_MINUTES },
    [doctorId],
    { fromDate: date, days: 1, now, clinicId },
  );
  return (slots.get(doctorId) ?? []).filter((s) => s.endsAt.getTime() > now.getTime());
}

/** The appointment a follow-up is booked from: same patient (account or walk-in), same doctor. */
export interface FollowUpSource {
  id: string;
  clinicId: string;
  patientId: string | null;
  name: string;
  phone: string;
  startsAt: Date;
}

export async function followUpSource(db: Queryable, doctorId: string, appointmentId: string): Promise<FollowUpSource> {
  const { rows } = await db.query<{ id: string; clinic_id: string; patient_id: string | null; name: string; phone: string; starts_at: Date; status: string }>(
    `select a.id, a.clinic_id, a.patient_id, a.starts_at, a.status,
            coalesce(p.full_name, a.walk_in_name) as name, coalesce(p.phone_e164, a.walk_in_phone) as phone
       from appointments a left join users p on p.id = a.patient_id
      where a.id = $1 and a.doctor_id = $2`,
    [appointmentId, doctorId],
  );
  const a = rows[0];
  // Scoped to this doctor: anyone else's appointment id is simply "not found".
  if (!a || a.status === 'cancelled') throw notFound();
  return { id: a.id, clinicId: a.clinic_id, patientId: a.patient_id, name: a.name, phone: a.phone, startsAt: a.starts_at };
}

export interface ClinicBookingInput {
  clinicId: string;
  startsAt: Date;
  visitType: VisitType;
  reason: string;
  /** Set when booking a follow-up from an earlier appointment; name and phone then come from it. */
  fromAppointmentId: string | null;
  name: string;
  phone: string;
}

export type ClinicBookingResult = { id: string } | { errors: FieldErrors };

export async function bookByClinic(deps: Deps, doctor: SessionUser, input: ClinicBookingInput, ip: string): Promise<ClinicBookingResult> {
  if (doctor.role !== 'doctor') throw notFound();
  const reason = input.reason.trim().slice(0, 200);
  const errors: FieldErrors = {};
  let walkIn: { name: string; phone: string } | null = null;
  if (!input.fromAppointmentId) {
    const name = input.name.trim().replace(/\s+/g, ' ');
    const phone = normalizeEgyptMobile(input.phone);
    if (name.length < 2 || name.length > 120) errors['name'] = 'name.invalid';
    if (!phone) errors['phone'] = 'phone.invalid';
    if (Object.keys(errors).length) return { errors };
    walkIn = { name, phone: phone! };
  }

  try {
    return await deps.db.transaction(async (tx) => {
      const approved = await tx.query("select 1 from doctors where user_id = $1 and verification_status = 'approved'", [doctor.id]);
      if (!approved.rows[0]) throw new DomainError('cbook.notApproved');
      const source = input.fromAppointmentId ? await followUpSource(tx, doctor.id, input.fromAppointmentId) : null;
      const clinic = (await ownActiveClinics(tx, doctor.id)).find((c) => c.id === input.clinicId);
      if (!clinic) throw notFound();
      if (Number.isNaN(input.startsAt.getTime())) throw new DomainError('booking.slotUnavailable');
      const today = todayIn(deps.cfg.TIME_ZONE, deps.now());
      const date = toZoned(input.startsAt, deps.cfg.TIME_ZONE).date;
      if (clampClinicDate(date, today) !== date) throw new DomainError('booking.slotUnavailable');
      // Re-derived from the real schedule: the form only says "this clinic, this start time".
      const slot = (await clinicSlots(deps, tx, doctor.id, clinic.id, date)).find((s) => s.startsAt.getTime() === input.startsAt.getTime());
      if (!slot) throw new DomainError('booking.slotUnavailable');
      const visitType: VisitType = source ? 'follow_up' : input.visitType;
      const fee = priceOf(clinic, visitType);
      const patientId = source?.patientId ?? null;
      const walkInName = patientId ? null : (source?.name ?? walkIn!.name);
      const walkInPhone = patientId ? null : (source?.phone ?? walkIn!.phone);

      const { rows } = await tx.query<{ id: string }>(
        `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, reason, fee_egp)
         values ($1, $2, $3, $4, $5, 'doctor', $6, $7, $8, $9, $10) returning id`,
        [doctor.id, clinic.id, patientId, walkInName, walkInPhone, slot.startsAt, slot.endsAt, visitType, reason || null, fee],
      );
      const id = rows[0]!.id;

      const target: BookingTarget = {
        clinicId: clinic.id, clinicName: clinic.name, clinicAddress: clinic.address, clinicPhone: clinic.phone,
        fee: clinic.fee, followUpFee: clinic.followUpFee, followUpDays: clinic.followUpDays,
        doctorId: doctor.id, doctorName: doctor.fullName, doctorSlug: '', startsAt: slot.startsAt, endsAt: slot.endsAt,
      };
      if (patientId) {
        const p = await tx.query<{ phone_e164: string; preferred_locale: Locale; full_name: string; email: string | null }>(
          `select phone_e164, preferred_locale, full_name, case when email_verified_at is not null then email end as email from users where id = $1`,
          [patientId],
        );
        const u = p.rows[0]!;
        await closeOnBooking(tx, deps.cfg.TIME_ZONE, patientId, clinic.id, slot.startsAt);
        await queueBookedNotices(deps, tx, { phone: u.phone_e164, locale: u.preferred_locale, name: u.full_name, email: u.email }, target);
      } else {
        // A walk-in has no account: an SMS confirmation only (sent once an SMS provider is connected).
        await queueBookedNotices(deps, tx, { phone: walkInPhone!, locale: 'ar', name: walkInName!, email: null }, target);
      }
      await audit(tx, {
        actorId: doctor.id,
        action: 'appointment.book_by_clinic',
        entityType: 'appointment',
        entityId: id,
        metadata: { visit: visitType, followUpOf: source?.id ?? null, account: !!patientId },
        ip,
      });
      return { id };
    });
  } catch (e) {
    if (isExclusionViolation(e, 'appointments_no_overlap')) throw new DomainError('booking.slotTaken');
    throw e;
  }
}

/** No-show counts for the people on a doctor's list: accounts across all doctors, walk-ins by phone at this doctor. */
export async function noShowCounts(
  db: Queryable,
  windowDays: number,
  doctorId: string,
  people: { patientId: string | null; phone: string }[],
): Promise<Map<string, number>> {
  const ids = [...new Set(people.map((p) => p.patientId).filter((x): x is string => !!x))];
  const phones = [...new Set(people.filter((p) => !p.patientId).map((p) => p.phone))];
  const out = new Map<string, number>();
  if (!ids.length && !phones.length) return out;
  const { rows } = await db.query<{ key: string; n: number }>(
    `select a.patient_id::text as key, count(*)::int as n from appointments a join users u on u.id = a.patient_id
      where a.patient_id = any($1::uuid[]) and a.status = 'no_show' and not a.no_show_waived and a.starts_at > now() - make_interval(days => $2)
        and (u.no_show_cleared_at is null or a.starts_at > u.no_show_cleared_at)
      group by a.patient_id
     union all
     select a.walk_in_phone, count(*)::int from appointments a
      where a.doctor_id = $3 and a.walk_in_phone = any($4::text[]) and a.status = 'no_show' and not a.no_show_waived and a.starts_at > now() - make_interval(days => $2)
      group by a.walk_in_phone`,
    [ids, windowDays, doctorId, phones],
  );
  for (const r of rows) out.set(r.key, r.n);
  return out;
}
