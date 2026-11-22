import type { Queryable } from '../db/db.js';

/*
 * Insights for one doctor: who their patients are (sex, age) and how their clinic is used
 * (visit types, attendance, busiest days, top services). Only counts — never names — and every
 * query is scoped to the signed-in doctor.
 *
 * Sex and age come from the doctor's patient files (seen in the period); visits come from bookings.
 */

export type Period = '30d' | '90d' | '12m' | 'all';
export const PERIODS: readonly Period[] = ['30d', '90d', '12m', 'all'];
export const isPeriod = (s: string): s is Period => (PERIODS as readonly string[]).includes(s);

const PERIOD_DAYS: Record<Period, number | null> = { '30d': 30, '90d': 90, '12m': 365, all: null };

export type AgeBand = '0-12' | '13-17' | '18-29' | '30-44' | '45-64' | '65+' | 'unknown';
export const AGE_BANDS: readonly AgeBand[] = ['0-12', '13-17', '18-29', '30-44', '45-64', '65+', 'unknown'];

export interface Insights {
  period: Period;
  patientsSeen: number;
  newFiles: number;
  sex: { female: number; male: number; unknown: number };
  ages: Record<AgeBand, number>;
  visits: { total: number; new: number; followUp: number; service: number };
  attendance: { completed: number; noShow: number; cancelled: number };
  weekdays: number[]; // 0 = Sunday … 6 = Saturday, past visits that took place or were due
  topServices: { name: string; name_ar: string | null; count: number }[];
}

export async function doctorInsights(db: Queryable, doctorId: string, period: Period, now: Date, timeZone: string): Promise<Insights> {
  const days = PERIOD_DAYS[period];
  const since = days === null ? new Date(0) : new Date(now.getTime() - days * 86400_000);

  // Patients seen in the period: files with a visit in the period (or created in it).
  const seen = `select r.id, r.sex, r.date_of_birth from patient_records r
                 where r.doctor_id = $1
                   and (r.created_at >= $2 or exists (select 1 from encounters e where e.record_id = r.id and e.doctor_id = $1 and e.visit_at >= $2))`;

  const [sexRows, ageRows, files, visitRows, statusRows, weekdayRows, services] = await Promise.all([
    db.query<{ sex: string | null; n: number }>(`select sex, count(*)::int as n from (${seen}) p group by sex`, [doctorId, since]),
    db.query<{ band: AgeBand; n: number }>(
      `select case
                when date_of_birth is null then 'unknown'
                when age($3::date, date_of_birth) < interval '13 years' then '0-12'
                when age($3::date, date_of_birth) < interval '18 years' then '13-17'
                when age($3::date, date_of_birth) < interval '30 years' then '18-29'
                when age($3::date, date_of_birth) < interval '45 years' then '30-44'
                when age($3::date, date_of_birth) < interval '65 years' then '45-64'
                else '65+' end as band,
              count(*)::int as n
         from (${seen}) p group by 1`,
      [doctorId, since, now.toISOString().slice(0, 10)],
    ),
    db.query<{ n: number }>('select count(*)::int as n from patient_records where doctor_id = $1 and created_at >= $2', [doctorId, since]),
    db.query<{ visit_type: string; n: number }>(
      `select visit_type, count(*)::int as n from appointments
        where doctor_id = $1 and starts_at >= $2 and starts_at <= $3 and status in ('confirmed', 'arrived', 'in_consultation', 'completed')
        group by visit_type`,
      [doctorId, since, now],
    ),
    db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from appointments
        where doctor_id = $1 and starts_at >= $2 and starts_at <= $3 and status in ('completed', 'no_show', 'cancelled')
        group by status`,
      [doctorId, since, now],
    ),
    db.query<{ wd: number; n: number }>(
      `select extract(dow from starts_at at time zone $4)::int as wd, count(*)::int as n from appointments
        where doctor_id = $1 and starts_at >= $2 and starts_at <= $3 and status in ('confirmed', 'arrived', 'in_consultation', 'completed', 'no_show')
        group by 1`,
      [doctorId, since, now, timeZone],
    ),
    db.query<{ name: string; name_ar: string | null; count: number }>(
      `select service_name as name, max(service_name_ar) as name_ar, count(*)::int as count from appointments
        where doctor_id = $1 and starts_at >= $2 and starts_at <= $3 and visit_type = 'service' and status <> 'cancelled'
        group by service_name order by count desc, service_name limit 5`,
      [doctorId, since, now],
    ),
  ]);

  const sex = { female: 0, male: 0, unknown: 0 };
  for (const r of sexRows.rows) {
    if (r.sex === 'female') sex.female += r.n;
    else if (r.sex === 'male') sex.male += r.n;
    else sex.unknown += r.n;
  }
  const ages = Object.fromEntries(AGE_BANDS.map((b) => [b, 0])) as Record<AgeBand, number>;
  for (const r of ageRows.rows) ages[r.band] += r.n;
  const visits = { total: 0, new: 0, followUp: 0, service: 0 };
  for (const r of visitRows.rows) {
    visits.total += r.n;
    if (r.visit_type === 'new') visits.new += r.n;
    else if (r.visit_type === 'follow_up') visits.followUp += r.n;
    else visits.service += r.n;
  }
  const attendance = { completed: 0, noShow: 0, cancelled: 0 };
  for (const r of statusRows.rows) {
    if (r.status === 'completed') attendance.completed = r.n;
    else if (r.status === 'no_show') attendance.noShow = r.n;
    else attendance.cancelled = r.n;
  }
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const r of weekdayRows.rows) weekdays[r.wd] = r.n;

  return {
    period,
    patientsSeen: sex.female + sex.male + sex.unknown,
    newFiles: files.rows[0]?.n ?? 0,
    sex,
    ages,
    visits,
    attendance,
    weekdays,
    topServices: services.rows,
  };
}

/** Whole-number percentage of a part (0 when there is nothing). */
export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
