import type { Queryable } from '../db/db.js';
import { labTest } from '../domain/clinical.js';
import { toZoned, weekdayOf } from '../domain/time.js';
import { PERIOD_DAYS, type Period } from './insights.js';
import { sectionOf } from './orderResults.js';

/**
 * Numbers for a lab, scan centre or pharmacy owner: how many requests came through Tabeeby, how
 * fast they were handled, which tests or medicines are asked for most, and which doctors' orders
 * bring the most patients (referrals). Only requests sent to this place are counted.
 */
export interface ReferringDoctor {
  doctor_id: string;
  name: string;
  slug: string;
  specialty_en: string | null;
  specialty_ar: string | null;
  requests: number;
  patients: number;
}

export interface FacilityInsights {
  period: Period;
  requests: number;
  patients: number;
  completed: number;
  open: number;
  cancelled: number;
  homeOrDelivery: number;
  /** Average hours from request to result/answer; null when nothing was completed. */
  avgHours: number | null;
  /** Estimated value of completed requests at this place's own prices (EGP). */
  revenue: number;
  weekdays: number[];
  topDoctors: ReferringDoctor[];
  /** Most requested tests (labs/scans) or medicines (pharmacies). */
  topItems: { label_en: string; label_ar: string; count: number }[];
}

const since = (period: Period, now: Date) => {
  const days = PERIOD_DAYS[period];
  return days === null ? new Date(0) : new Date(now.getTime() - days * 86400_000);
};

function weekdaysOf(dates: Date[], tz: string): number[] {
  const w = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dates) w[weekdayOf(toZoned(d, tz).date)]!++;
  return w;
}

const DOCTOR_COLUMNS = `lo_doctor as doctor_id, du.full_name as name, d.slug, s.name_en as specialty_en, s.name_ar as specialty_ar`;

export async function labInsights(db: Queryable, facilityId: string, period: Period, now: Date, tz: string): Promise<FacilityInsights> {
  const from = since(period, now);
  const [reqs, doctors, items, prices] = await Promise.all([
    db.query<{ id: string; status: string; patient_id: string; home_visit: boolean; created_at: Date; ready_at: Date | null; lab_order_id: string; section: string }>(
      `select id, status, patient_id, home_visit, created_at, ready_at, lab_order_id, section from order_requests
        where facility_id = $1 and created_at >= $2`,
      [facilityId, from],
    ),
    db.query<ReferringDoctor>(
      `select ${DOCTOR_COLUMNS}, count(*)::int as requests, count(distinct q.patient_id)::int as patients
         from (select q.*, lo.doctor_id as lo_doctor from order_requests q join lab_orders lo on lo.id = q.lab_order_id
                where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled') q
         join users du on du.id = q.lo_doctor join doctors d on d.user_id = q.lo_doctor left join specialties s on s.id = d.specialty_id
        group by lo_doctor, du.full_name, d.slug, s.name_en, s.name_ar
        order by requests desc, patients desc, du.full_name limit 10`,
      [facilityId, from],
    ),
    db.query<{ section: string; test_code: string | null; test_name: string | null; status: string }>(
      `select q.section, i.test_code, i.test_name, q.status from order_requests q join lab_order_items i on i.lab_order_id = q.lab_order_id
        where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled'`,
      [facilityId, from],
    ),
    db.query<{ test_code: string; price_egp: number }>('select test_code, price_egp from facility_tests where facility_id = $1', [facilityId]),
  ]);
  const price = new Map(prices.rows.map((p) => [p.test_code, p.price_egp]));
  const counts = new Map<string, { label_en: string; label_ar: string; count: number }>();
  let revenue = 0;
  for (const it of items.rows) {
    // Only the tests of the part (lab or scans) that was sent here.
    if (sectionOf(it) !== it.section) continue;
    const test = it.test_code ? labTest(it.test_code) : undefined;
    const key = it.test_code ?? `name:${(it.test_name ?? '').toLowerCase()}`;
    const row = counts.get(key) ?? { label_en: test?.en ?? it.test_name ?? '', label_ar: test?.ar ?? it.test_name ?? '', count: 0 };
    row.count++;
    counts.set(key, row);
    if (it.status === 'ready' && it.test_code) revenue += price.get(it.test_code) ?? 0;
  }
  const rows = reqs.rows;
  const done = rows.filter((r) => r.status === 'ready' && r.ready_at);
  return {
    period,
    requests: rows.filter((r) => r.status !== 'cancelled').length,
    patients: new Set(rows.filter((r) => r.status !== 'cancelled').map((r) => r.patient_id)).size,
    completed: done.length,
    open: rows.filter((r) => r.status === 'sent' || r.status === 'received').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
    homeOrDelivery: rows.filter((r) => r.home_visit && r.status !== 'cancelled').length,
    avgHours: done.length ? Math.round(done.reduce((s, r) => s + (r.ready_at!.getTime() - r.created_at.getTime()), 0) / done.length / 3600_000) : null,
    revenue,
    weekdays: weekdaysOf(rows.filter((r) => r.status !== 'cancelled').map((r) => r.created_at), tz),
    topDoctors: doctors.rows,
    topItems: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

export async function pharmacyInsights(db: Queryable, facilityId: string, period: Period, now: Date, tz: string): Promise<FacilityInsights> {
  const from = since(period, now);
  const [reqs, doctors, meds] = await Promise.all([
    db.query<{ status: string; patient_id: string; delivery: boolean; created_at: Date; replied_at: Date | null; total_egp: number | null }>(
      `select status, patient_id, delivery, created_at, replied_at, total_egp from pharmacy_requests
        where facility_id = $1 and created_at >= $2 and status <> 'cancelled'`,
      [facilityId, from],
    ),
    db.query<ReferringDoctor>(
      `select ${DOCTOR_COLUMNS}, count(*)::int as requests, count(distinct q.patient_id)::int as patients
         from (select q.*, p.doctor_id as lo_doctor from pharmacy_requests q join prescriptions p on p.id = q.prescription_id
                where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled') q
         join users du on du.id = q.lo_doctor join doctors d on d.user_id = q.lo_doctor left join specialties s on s.id = d.specialty_id
        group by lo_doctor, du.full_name, d.slug, s.name_en, s.name_ar
        order by requests desc, patients desc, du.full_name limit 10`,
      [facilityId, from],
    ),
    db.query<{ medicine: string; n: number }>(
      `select i.medicine, count(*)::int as n from pharmacy_requests q join prescription_items i on i.prescription_id = q.prescription_id
        where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled'
        group by i.medicine order by n desc, i.medicine limit 10`,
      [facilityId, from],
    ),
  ]);
  const rows = reqs.rows;
  const answered = rows.filter((r) => r.replied_at);
  const done = rows.filter((r) => r.status === 'completed');
  return {
    period,
    requests: rows.length,
    patients: new Set(rows.map((r) => r.patient_id)).size,
    completed: done.length,
    open: rows.filter((r) => ['sent', 'ready', 'out_for_delivery', 'partly_available'].includes(r.status)).length,
    cancelled: rows.filter((r) => r.status === 'unavailable').length,
    homeOrDelivery: rows.filter((r) => r.delivery).length,
    // For pharmacies: average time to answer the patient.
    avgHours: answered.length ? Math.round((answered.reduce((s, r) => s + (r.replied_at!.getTime() - r.created_at.getTime()), 0) / answered.length / 3600_000) * 10) / 10 : null,
    revenue: done.reduce((s, r) => s + (r.total_egp ?? 0), 0),
    weekdays: weekdaysOf(rows.map((r) => r.created_at), tz),
    topDoctors: doctors.rows,
    topItems: meds.rows.map((m) => ({ label_en: m.medicine, label_ar: m.medicine, count: m.n })),
  };
}
