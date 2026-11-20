import type { Queryable } from '../db/db.js';
import type { AppointmentStatus } from '../domain/appointmentStatus.js';
import { addDays, zonedToUtc } from '../domain/time.js';

export interface DoctorDayAppointment {
  id: string;
  starts_at: Date;
  ends_at: Date;
  status: AppointmentStatus;
  visit_type: 'new' | 'follow_up';
  reason: string | null;
  patient_name: string;
  patient_phone: string;
  patient_email: string | null;
  clinic_name: string;
}

export async function doctorDay(db: Queryable, doctorId: string, date: string, tz: string): Promise<DoctorDayAppointment[]> {
  const from = zonedToUtc(date, '00:00', tz);
  const to = zonedToUtc(addDays(date, 1), '00:00', tz);
  return (
    await db.query<DoctorDayAppointment>(
      `select a.id, a.starts_at, a.ends_at, a.status, a.visit_type, a.reason,
              p.full_name as patient_name, p.phone_e164 as patient_phone, p.email as patient_email, c.name as clinic_name
         from appointments a join users p on p.id = a.patient_id join clinics c on c.id = a.clinic_id
        where a.doctor_id = $1 and a.starts_at >= $2 and a.starts_at < $3
        order by a.starts_at, a.created_at`,
      [doctorId, from, to],
    )
  ).rows;
}

export async function upcomingWeekCount(db: Queryable, doctorId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from appointments
      where doctor_id = $1 and status = 'confirmed' and starts_at >= now() and starts_at < now() + interval '7 days'`,
    [doctorId],
  );
  return rows[0]?.n ?? 0;
}
