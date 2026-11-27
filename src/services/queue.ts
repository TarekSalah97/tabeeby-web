import type { Deps } from '../http/context.js';
import type { AppointmentStatus } from '../domain/appointmentStatus.js';
import { addDays, todayIn, toZoned, zonedToUtc } from '../domain/time.js';
import { estimateQueue, type QueueEstimate, type QueueVisit } from '../domain/queueEstimate.js';
import { notFound } from '../http/errors.js';

/*
 * The patient's live place in the queue for a visit today.
 * Privacy: the patient sees only counts and times of other visits, never who they are.
 * Every query is scoped by the signed-in patient's id.
 */

export interface LiveVisit {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  doctorName: string;
  doctorSlug: string;
  clinicName: string;
  clinicPhone: string | null;
  clinicPhones: string[];
  /** Null when the visit is not today (tracking starts on the day). */
  estimate: QueueEstimate | null;
  isToday: boolean;
}

function dayBounds(deps: Deps, day: string): [Date, Date] {
  const tz = deps.cfg.TIME_ZONE;
  return [zonedToUtc(day, '00:00', tz), zonedToUtc(addDays(day, 1), '00:00', tz)];
}

interface OwnRow {
  id: string;
  starts_at: Date;
  status: AppointmentStatus;
  doctor_id: string;
  clinic_id: string;
  doctor_name: string;
  doctor_slug: string;
  clinic_name: string;
  clinic_phone: string | null;
  clinic_phones: string[];
}

const OWN_SELECT = `select a.id, a.starts_at, a.status, a.doctor_id, a.clinic_id, u.full_name as doctor_name, d.slug as doctor_slug,
        c.name as clinic_name, c.phone_e164 as clinic_phone, array_remove(array[c.phone_e164] || c.extra_phones, null) as clinic_phones
   from appointments a join doctors d on d.user_id = a.doctor_id join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id`;

async function withEstimate(deps: Deps, own: OwnRow): Promise<LiveVisit> {
  const tz = deps.cfg.TIME_ZONE;
  const now = deps.now();
  const today = todayIn(tz, now);
  const day = toZoned(own.starts_at, tz).date;
  const isToday = day === today;
  let estimate: QueueEstimate | null = null;
  if (isToday) {
    const [from, to] = dayBounds(deps, day);
    const { rows } = await deps.db.query<{
      id: string;
      starts_at: Date;
      ends_at: Date;
      status: AppointmentStatus;
      consult_started_at: Date | null;
      completed_at: Date | null;
    }>(
      `select id, starts_at, ends_at, status, consult_started_at, completed_at from appointments
        where doctor_id = $1 and clinic_id = $2 and starts_at >= $3 and starts_at < $4 and status <> 'cancelled'
        order by starts_at`,
      [own.doctor_id, own.clinic_id, from, to],
    );
    const visits: QueueVisit[] = rows.map((r) => ({
      id: r.id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      consultStartedAt: r.consult_started_at,
      completedAt: r.completed_at,
    }));
    estimate = estimateQueue(visits, own.id, now);
  }
  return {
    id: own.id,
    startsAt: own.starts_at,
    status: own.status,
    doctorName: own.doctor_name,
    doctorSlug: own.doctor_slug,
    clinicName: own.clinic_name,
    clinicPhone: own.clinic_phone,
    clinicPhones: own.clinic_phones,
    estimate,
    isToday,
  };
}

/** The patient's visits today that are still ahead of them (booked, arrived or inside). */
export async function todaysLiveVisits(deps: Deps, patientId: string): Promise<LiveVisit[]> {
  const [from, to] = dayBounds(deps, todayIn(deps.cfg.TIME_ZONE, deps.now()));
  const { rows } = await deps.db.query<OwnRow>(
    `${OWN_SELECT} where a.patient_id = $1 and a.starts_at >= $2 and a.starts_at < $3 and a.status in ('confirmed', 'arrived', 'in_consultation') order by a.starts_at`,
    [patientId, from, to],
  );
  return Promise.all(rows.map((r) => withEstimate(deps, r)));
}

/** One visit of this patient, with the live estimate when it is today. */
export async function liveVisit(deps: Deps, patientId: string, appointmentId: string): Promise<LiveVisit> {
  const { rows } = await deps.db.query<OwnRow>(`${OWN_SELECT} where a.id = $1 and a.patient_id = $2`, [appointmentId, patientId]);
  if (!rows[0]) throw notFound();
  return withEstimate(deps, rows[0]);
}
