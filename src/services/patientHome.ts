import type { Queryable } from '../db/db.js';

export interface RecentDoctor {
  doctor_slug: string;
  doctor_name: string;
  specialty_id: number;
  clinic_id: string;
  last_visit: Date;
}

/** Doctors this patient has booked before, most recent first, for one-tap "Book again". */
export async function recentDoctors(db: Queryable, patientId: string, limit = 4): Promise<RecentDoctor[]> {
  return (
    await db.query<RecentDoctor>(
      `select distinct on (a.doctor_id) d.slug as doctor_slug, u.full_name as doctor_name, d.specialty_id, a.clinic_id, a.starts_at as last_visit
         from appointments a join doctors d on d.user_id = a.doctor_id join users u on u.id = a.doctor_id
         join clinics c on c.id = a.clinic_id
        where a.patient_id = $1 and d.verification_status = 'approved' and u.status = 'active' and c.is_active
        order by a.doctor_id, a.starts_at desc`,
      [patientId],
    )
  ).rows
    .sort((a, b) => b.last_visit.getTime() - a.last_visit.getTime())
    .slice(0, limit);
}

export interface NextVisit {
  id: string;
  starts_at: Date;
  doctor_name: string;
  clinic_name: string;
}

export async function nextVisit(db: Queryable, patientId: string): Promise<NextVisit | null> {
  const { rows } = await db.query<NextVisit>(
    `select a.id, a.starts_at, u.full_name as doctor_name, c.name as clinic_name
       from appointments a join users u on u.id = a.doctor_id join clinics c on c.id = a.clinic_id
      where a.patient_id = $1 and a.status in ('confirmed', 'arrived') and a.starts_at > now()
      order by a.starts_at limit 1`,
    [patientId],
  );
  return rows[0] ?? null;
}
