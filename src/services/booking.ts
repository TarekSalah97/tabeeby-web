import type { Deps } from '../http/context.js';
import type { Config } from '../config.js';
import type { PaymentMethod } from './payments.js';
import { visitForOnlineBooking, type ClinicPrices, type VisitType, type Visit } from '../domain/visitPricing.js';
import { bookableService } from './clinicServices.js';
import { smsEnabled } from '../config.js';
import type { Queryable } from '../db/db.js';
import { isExclusionViolation } from '../db/db.js';
import type { SessionUser } from '../auth/sessions.js';
import { hitRateLimit, LIMITS } from '../auth/rateLimit.js';
import { checkTransition, type AppointmentStatus } from '../domain/appointmentStatus.js';
import { toZoned } from '../domain/time.js';
import { slotsForDoctors } from './availability.js';
import { enqueueSms, enqueueEmail } from './outbox.js';
import { audit } from './audit.js';
import { closeOnBooking, notifyWaitlist } from './waitlist.js';
import { addStrike, pausedDoctors } from './reliability.js';
import { translator, formatDateTime, type Locale } from '../i18n/index.js';
import { DomainError, notFound, tooManyRequests } from '../http/errors.js';

export interface BookingRequest {
  clinicId: string;
  startsAt: Date;
  reason: string;
  /** One of the clinic's services, or empty for a consultation (new or follow-up, decided here). */
  serviceId?: string;
}

export interface BookingTarget {
  clinicId: string;
  clinicName: string;
  clinicAddress: string;
  fee: number;
  followUpFee: number | null;
  followUpDays: number;
  clinicPhone: string | null;
  doctorId: string;
  doctorName: string;
  doctorSlug: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Re-derives the slot from the doctor's real schedule. The client only says
 * "this clinic, this start time"; it can never choose an arbitrary time or length.
 */
export async function resolveSlot(deps: Deps, db: Queryable, clinicId: string, startsAt: Date): Promise<BookingTarget> {
  const { rows } = await db.query<{
    clinic_id: string; name: string; address: string; fee_egp: number; follow_up_fee_egp: number | null; follow_up_days: number;
    phone_e164: string | null; doctor_id: string; full_name: string; slug: string;
  }>(
    `select c.id as clinic_id, c.name, c.address, c.fee_egp, c.follow_up_fee_egp, c.follow_up_days, c.phone_e164,
            d.user_id as doctor_id, u.full_name, d.slug
       from clinics c join doctors d on d.user_id = c.doctor_id join users u on u.id = d.user_id
      where c.id = $1 and c.is_active and d.verification_status = 'approved' and u.status = 'active'`,
    [clinicId],
  );
  const c = rows[0];
  if (!c) throw new DomainError('booking.doctorUnavailable');
  if ((await pausedDoctors(db, deps.cfg, [c.doctor_id])).size) throw new DomainError('booking.doctorPaused');
  if (Number.isNaN(startsAt.getTime())) throw new DomainError('booking.slotUnavailable');
  const date = toZoned(startsAt, deps.cfg.TIME_ZONE).date;
  const slots = await slotsForDoctors(db, deps.cfg, [c.doctor_id], { fromDate: date, days: 1, now: deps.now(), clinicId });
  const slot = slots.get(c.doctor_id)?.find((s) => s.startsAt.getTime() === startsAt.getTime());
  if (!slot) throw new DomainError('booking.slotUnavailable');
  const horizon = deps.now().getTime() + deps.cfg.BOOKING_HORIZON_DAYS * 86400_000;
  if (slot.startsAt.getTime() > horizon) throw new DomainError('booking.slotUnavailable');
  return {
    clinicId: c.clinic_id,
    clinicName: c.name,
    clinicAddress: c.address,
    fee: c.fee_egp,
    followUpFee: c.follow_up_fee_egp,
    followUpDays: c.follow_up_days,
    clinicPhone: c.phone_e164,
    doctorId: c.doctor_id,
    doctorName: c.full_name,
    doctorSlug: c.slug,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
  };
}

/** When the patient last finished a visit with this doctor (any clinic), for follow-up pricing. */
export async function lastCompletedVisit(db: Queryable, patientId: string, doctorId: string): Promise<Date | null> {
  const { rows } = await db.query<{ at: Date | null }>(
    `select max(starts_at) as at from appointments where patient_id = $1 and doctor_id = $2 and status = 'completed'`,
    [patientId, doctorId],
  );
  return rows[0]?.at ?? null;
}

/** No-shows that count towards pausing online booking (inside the window and after any admin reset). */
export async function countedNoShows(db: Queryable, cfg: Pick<Config, 'NO_SHOW_WINDOW_DAYS'>, patientId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from appointments a join users u on u.id = a.patient_id
      where a.patient_id = $1 and a.status = 'no_show' and not a.no_show_waived
        and a.starts_at > now() - make_interval(days => $2)
        and (u.no_show_cleared_at is null or a.starts_at > u.no_show_cleared_at)`,
    [patientId, cfg.NO_SHOW_WINDOW_DAYS],
  );
  return rows[0]?.n ?? 0;
}

export const pricesOf = (t: BookingTarget): ClinicPrices => ({ fee: t.fee, followUpFee: t.followUpFee, followUpDays: t.followUpDays });

/**
 * What the patient will be charged for this slot, shown before they confirm. A chosen service is
 * priced from the doctor's own list for that clinic; an unknown or hidden service is refused.
 */
export async function quote(db: Queryable, patientId: string | null, target: BookingTarget, serviceId?: string): Promise<Visit> {
  if (serviceId) {
    const svc = await bookableService(db, target.clinicId, serviceId);
    if (!svc) throw new DomainError('svc.err.unavailable');
    return { type: 'service', fee: svc.price_egp, serviceId: svc.id, serviceName: svc.name };
  }
  const last = patientId ? await lastCompletedVisit(db, patientId, target.doctorId) : null;
  return visitForOnlineBooking(pricesOf(target), last, target.startsAt);
}

export interface BookedNotice {
  phone: string;
  locale: Locale;
  name: string;
  /** Only a confirmed email is used. */
  email: string | null;
}

/** Confirmation by SMS (and email when confirmed), queued in the same transaction as the booking. */
export async function queueBookedNotices(deps: Deps, tx: Queryable, to: BookedNotice, target: BookingTarget): Promise<void> {
  const t = translator(to.locale);
  const link = `${deps.cfg.PUBLIC_ORIGIN}${to.locale === 'en' ? '/en' : ''}/appointments`;
  const when = formatDateTime(target.startsAt, to.locale, deps.cfg.TIME_ZONE);
  await enqueueSms(tx, to.phone, t('sms.booked', { doctor: target.doctorName, when, clinic: target.clinicName, link }));
  if (to.email) {
    await enqueueEmail(
      tx,
      to.email,
      t('email.bookedSubject', { doctor: target.doctorName }),
      t('email.bookedBody', { name: to.name, doctor: target.doctorName, when, clinic: target.clinicName, address: target.clinicAddress, link }),
    );
  }
}

export async function book(deps: Deps, patient: SessionUser, req: BookingRequest, ip: string): Promise<string> {
  if (patient.role !== 'patient') throw new DomainError('booking.notPatient');
  if (smsEnabled(deps.cfg) && !patient.phoneVerified) throw new DomainError('booking.verifyPhoneFirst');
  if (!(await hitRateLimit(deps.db, `book:${patient.id}`, LIMITS.bookingPerUser.limit, LIMITS.bookingPerUser.window))) throw tooManyRequests();
  const reason = req.reason.trim().slice(0, 200);

  try {
    return await deps.db.transaction(async (tx) => {
      // Serialise this patient's bookings so the active-appointments limit cannot be raced.
      await tx.query('select 1 from users where id = $1 for update', [patient.id]);
      if ((await countedNoShows(tx, deps.cfg, patient.id)) >= deps.cfg.NO_SHOW_LIMIT) throw new DomainError('booking.pausedNoShows');
      const active = await tx.query<{ n: number }>(
        `select count(*)::int as n from appointments where patient_id = $1 and status in ('confirmed', 'arrived') and starts_at > now()`,
        [patient.id],
      );
      if ((active.rows[0]?.n ?? 0) >= deps.cfg.MAX_ACTIVE_APPOINTMENTS_PER_PATIENT) throw new DomainError('booking.tooManyActive');

      const target = await resolveSlot(deps, tx, req.clinicId, req.startsAt);
      const visit = await quote(tx, patient.id, target, req.serviceId);
      const { rows } = await tx.query<{ id: string }>(
        `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, reason, fee_egp, service_id, service_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [target.doctorId, target.clinicId, patient.id, target.startsAt, target.endsAt, visit.type, reason || null, visit.fee, visit.serviceId ?? null, visit.serviceName ?? null],
      );
      const id = rows[0]!.id;
      await closeOnBooking(tx, deps.cfg.TIME_ZONE, patient.id, target.clinicId, target.startsAt);
      // Patients with a confirmed email also get the confirmation by email (works without SMS).
      const mail = await tx.query<{ email: string }>('select email from users where id = $1 and email is not null and email_verified_at is not null', [patient.id]);
      await queueBookedNotices(deps, tx, { phone: patient.phone, locale: patient.locale, name: patient.fullName, email: mail.rows[0]?.email ?? null }, target);
      await audit(tx, { actorId: patient.id, action: 'appointment.book', entityType: 'appointment', entityId: id, metadata: { visit: visit.type }, ip });
      return id;
    });
  } catch (e) {
    // The exclusion constraint is the final word on double booking.
    if (isExclusionViolation(e, 'appointments_no_overlap')) throw new DomainError('booking.slotTaken');
    throw e;
  }
}

export interface PatientAppointment {
  id: string;
  starts_at: Date;
  status: AppointmentStatus;
  visit_type: 'new' | 'follow_up' | 'service';
  service_name: string | null;
  fee_egp: number;
  clinic_id: string;
  clinic_name: string;
  clinic_address: string;
  clinic_phone: string | null;
  district_en: string;
  district_ar: string;
  doctor_name: string;
  doctor_slug: string;
  /** The patient's own rating of this visit, if they left one. */
  my_rating: number | null;
  /** Recorded payment for this visit, if any. */
  paid_amount: number | null;
  paid_method: PaymentMethod | null;
  cancelled_by: 'patient' | 'doctor' | 'admin' | null;
}

export async function listPatientAppointments(db: Queryable, patientId: string): Promise<PatientAppointment[]> {
  return (
    await db.query<PatientAppointment>(
      `select a.id, a.starts_at, a.status, a.visit_type, a.service_name, a.fee_egp, a.clinic_id, c.name as clinic_name, c.address as clinic_address,
              c.phone_e164 as clinic_phone, dist.name_en as district_en, dist.name_ar as district_ar,
              u.full_name as doctor_name, d.slug as doctor_slug, r.rating as my_rating,
              pay.amount_egp as paid_amount, pay.method as paid_method, a.cancelled_by
         from appointments a join clinics c on c.id = a.clinic_id join districts dist on dist.id = c.district_id
         join doctors d on d.user_id = a.doctor_id join users u on u.id = a.doctor_id
         left join reviews r on r.appointment_id = a.id
         left join payments pay on pay.appointment_id = a.id and pay.status = 'paid'
        where a.patient_id = $1 order by a.starts_at desc limit 100`,
      [patientId],
    )
  ).rows;
}

/** Status change by patient (cancel only) or doctor (running the clinic). */
export async function changeStatus(
  deps: Deps,
  actor: SessionUser,
  appointmentId: string,
  to: AppointmentStatus,
  ip: string,
  /** Doctor cancelling: the patient asked (no strike) or the clinic cannot make it (a strike if the patient booked online). */
  cancelKind: 'patient_request' | 'clinic' = 'clinic',
): Promise<void> {
  const scope = actor.role === 'patient' ? 'a.patient_id' : actor.role === 'doctor' ? 'a.doctor_id' : null;
  if (!scope) throw notFound();
  await deps.db.transaction(async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      clinic_id: string;
      status: AppointmentStatus;
      starts_at: Date;
      patient_phone: string | null;
      patient_locale: Locale;
      booked_by: 'patient' | 'doctor';
      doctor_name: string;
      doctor_slug: string;
    }>(
      `select a.id, a.clinic_id, a.status, a.starts_at, coalesce(p.phone_e164, a.walk_in_phone) as patient_phone,
              coalesce(p.preferred_locale, 'ar') as patient_locale, a.booked_by, du.full_name as doctor_name, d.slug as doctor_slug
         from appointments a left join users p on p.id = a.patient_id
         join doctors d on d.user_id = a.doctor_id join users du on du.id = a.doctor_id
        where a.id = $1 and ${scope} = $2 for update of a`,
      [appointmentId, actor.id],
    );
    const appt = rows[0];
    if (!appt) throw notFound(); // also hides other people's appointments
    const actorKind = actor.role === 'patient' ? 'patient' : 'doctor';
    const patientAsked = actorKind === 'doctor' && to === 'cancelled' && cancelKind === 'patient_request';
    const problem = checkTransition({
      from: appt.status,
      to,
      actor: actorKind,
      startsAt: appt.starts_at,
      now: deps.now(),
      cancelCutoffHours: deps.cfg.CANCEL_CUTOFF_HOURS,
    });
    if (problem) throw new DomainError(problem);
    await tx.query(
      `update appointments set status = $2, updated_at = now(),
              arrived_at = case when $2 = 'arrived' then $4::timestamptz else arrived_at end,
              consult_started_at = case when $2 = 'in_consultation' then $4::timestamptz else consult_started_at end,
              completed_at = case when $2 = 'completed' then $4::timestamptz else completed_at end,
              cancelled_by = case when $2 = 'cancelled' then $3 else cancelled_by end,
              cancelled_at = case when $2 = 'cancelled' then now() else cancelled_at end
        where id = $1`,
      [appt.id, to, patientAsked ? 'patient' : actorKind, deps.now()],
    );
    // A doctor cancelling a visit the patient booked online is a strike (the patient can report it if it was unfair).
    if (to === 'cancelled' && actorKind === 'doctor' && !patientAsked && appt.booked_by === 'patient') {
      await addStrike(tx, { doctorId: actor.id, source: 'doctor_cancel', appointmentId: appt.id, reason: null, createdBy: actor.id });
    }
    // A freed place goes to the people waiting for that day (patient or doctor cancellation alike).
    if (to === 'cancelled') await notifyWaitlist(deps, tx, appt);
    if (to === 'cancelled' && actorKind === 'doctor' && !patientAsked && appt.patient_phone) {
      const t = translator(appt.patient_locale);
      await enqueueSms(
        tx,
        appt.patient_phone,
        t('sms.cancelledByDoctor', {
          doctor: appt.doctor_name,
          when: formatDateTime(appt.starts_at, appt.patient_locale, deps.cfg.TIME_ZONE),
          link: `${deps.cfg.PUBLIC_ORIGIN}${appt.patient_locale === 'en' ? '/en' : ''}/doctors/${appt.doctor_slug}`,
        }),
      );
    }
    await audit(tx, { actorId: actor.id, action: `appointment.${to}`, entityType: 'appointment', entityId: appt.id, metadata: { from: appt.status, ...(patientAsked ? { patientAsked } : {}) }, ip });
  });
}
