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
  topItems: Item[];
  /** Requests by hour of the day (0–23, local time): when to have more staff. */
  hours: number[];
  /** Which specialties send patients here. */
  specialties: Item[];
  /** Patients who came back with more than one request. */
  repeatPatients: number;

  // ---- labs and scan centres
  /** Tests patients asked for that are not on this place's price list (missed income). */
  notOffered?: Item[];
  /** Requests still without results after 48 hours. */
  overdue?: number;
  /** Scan centres: requests and average hours to report, per kind of scan. */
  modalities?: { key: Modality; count: number; avgHours: number | null }[];

  // ---- pharmacies
  /** Medicines in prescriptions answered "not available" or "partly available": what to stock. */
  stockGaps?: Item[];
  /** How the pharmacy answered. */
  answers?: { ready: number; partly: number; unavailable: number };
  /** Average total of answered prescriptions (EGP). */
  avgOrder?: number | null;
}

export interface Item {
  label_en: string;
  label_ar: string;
  count: number;
}

export type Modality = 'xray' | 'ultrasound' | 'ct' | 'mri' | 'echo' | 'other';
export const MODALITIES: readonly Modality[] = ['xray', 'ultrasound', 'ct', 'mri', 'echo', 'other'];

/** Kind of scan for a built-in test code (typed names count as "other"). */
export function modalityOf(code: string | null): Modality {
  if (!code) return 'other';
  if (code.startsWith('xray_')) return 'xray';
  if (code.startsWith('us_')) return 'ultrasound';
  if (code === 'ct' || code === 'cbct') return 'ct';
  if (code === 'mri') return 'mri';
  if (code === 'echo') return 'echo';
  return 'other';
}

const OVERDUE_HOURS = 48;

function hoursOf(dates: Date[], tz: string): number[] {
  const h = new Array<number>(24).fill(0);
  for (const d of dates) h[Number(toZoned(d, tz).time.slice(0, 2))]!++;
  return h;
}

function repeatCount(patientIds: string[]): number {
  const seen = new Map<string, number>();
  for (const id of patientIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}

const SPECIALTY_SQL = (source: string) => `
  select coalesce(s.name_en, '') as label_en, coalesce(s.name_ar, '') as label_ar, count(*)::int as count
    from (${source}) q join doctors d on d.user_id = q.lo_doctor left join specialties s on s.id = d.specialty_id
   group by s.name_en, s.name_ar order by count desc limit 8`;

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

export async function labInsights(db: Queryable, facilityId: string, period: Period, now: Date, tz: string, isScanCentre = false): Promise<FacilityInsights> {
  const from = since(period, now);
  const [reqs, doctors, items, prices, extras, specialties] = await Promise.all([
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
    db.query<{ section: string; test_code: string | null; test_name: string | null; status: string; lab_order_id: string }>(
      `select q.section, i.test_code, i.test_name, q.status, q.lab_order_id from order_requests q join lab_order_items i on i.lab_order_id = q.lab_order_id
        where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled'`,
      [facilityId, from],
    ),
    db.query<{ test_code: string; price_egp: number }>('select test_code, price_egp from facility_tests where facility_id = $1', [facilityId]),
    db.query<{ name: string }>('select lower(name) as name from facility_extra_tests where facility_id = $1', [facilityId]),
    db.query<Item>(
      SPECIALTY_SQL(`select lo.doctor_id as lo_doctor from order_requests q join lab_orders lo on lo.id = q.lab_order_id
                      where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled'`),
      [facilityId, from],
    ),
  ]);
  const price = new Map(prices.rows.map((p) => [p.test_code, p.price_egp]));
  const ownNames = new Set(extras.rows.map((x) => x.name));
  const missing = new Map<string, Item>();
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
    // Asked for here but not on the price list (built-in or the place's own tests).
    const offered = it.test_code ? price.has(it.test_code) : ownNames.has((it.test_name ?? '').toLowerCase());
    if (!offered) {
      const m = missing.get(key) ?? { label_en: row.label_en, label_ar: row.label_ar, count: 0 };
      m.count++;
      missing.set(key, m);
    }
  }
  const scans = new Map<Modality, { count: number; hours: number[] }>();
  if (isScanCentre) {
    const byReq = new Map<string, Modality>();
    for (const it of items.rows) if (sectionOf(it) === it.section) byReq.set(it.lab_order_id, byReq.get(it.lab_order_id) ?? modalityOf(it.test_code));
    for (const r of reqs.rows) {
      if (r.status === 'cancelled') continue;
      const m = byReq.get(r.lab_order_id) ?? 'other';
      const e = scans.get(m) ?? { count: 0, hours: [] };
      e.count++;
      if (r.status === 'ready' && r.ready_at) e.hours.push((r.ready_at.getTime() - r.created_at.getTime()) / 3600_000);
      scans.set(m, e);
    }
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
    hours: hoursOf(rows.filter((r) => r.status !== 'cancelled').map((r) => r.created_at), tz),
    specialties: specialties.rows.filter((x) => x.label_en || x.label_ar),
    repeatPatients: repeatCount(rows.filter((r) => r.status !== 'cancelled').map((r) => r.patient_id)),
    notOffered: [...missing.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    overdue: rows.filter((r) => (r.status === 'sent' || r.status === 'received') && now.getTime() - r.created_at.getTime() > OVERDUE_HOURS * 3600_000).length,
    ...(isScanCentre
      ? {
          modalities: MODALITIES.filter((m) => scans.has(m)).map((m) => {
            const e = scans.get(m)!;
            return { key: m, count: e.count, avgHours: e.hours.length ? Math.round(e.hours.reduce((a, b) => a + b, 0) / e.hours.length) : null };
          }),
        }
      : {}),
  };
}

export async function pharmacyInsights(db: Queryable, facilityId: string, period: Period, now: Date, tz: string): Promise<FacilityInsights> {
  const from = since(period, now);
  const [reqs, doctors, meds, gaps, specialties] = await Promise.all([
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
    db.query<{ medicine: string; n: number }>(
      `select i.medicine, count(*)::int as n from pharmacy_requests q join prescription_items i on i.prescription_id = q.prescription_id
        where q.facility_id = $1 and q.created_at >= $2 and q.status in ('unavailable', 'partly_available')
        group by i.medicine order by n desc, i.medicine limit 10`,
      [facilityId, from],
    ),
    db.query<Item>(
      SPECIALTY_SQL(`select p.doctor_id as lo_doctor from pharmacy_requests q join prescriptions p on p.id = q.prescription_id
                      where q.facility_id = $1 and q.created_at >= $2 and q.status <> 'cancelled'`),
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
    hours: hoursOf(rows.map((r) => r.created_at), tz),
    specialties: specialties.rows.filter((x) => x.label_en || x.label_ar),
    repeatPatients: repeatCount(rows.map((r) => r.patient_id)),
    stockGaps: gaps.rows.map((m) => ({ label_en: m.medicine, label_ar: m.medicine, count: m.n })),
    answers: {
      // "ready" and "out for delivery" both mean the whole prescription was available.
      ready: rows.filter((r) => r.replied_at && ['ready', 'out_for_delivery', 'completed'].includes(r.status)).length,
      partly: rows.filter((r) => r.status === 'partly_available').length,
      unavailable: rows.filter((r) => r.status === 'unavailable').length,
    },
    avgOrder: (() => {
      const priced = rows.filter((r) => r.total_egp !== null && r.total_egp > 0);
      return priced.length ? Math.round(priced.reduce((a, r) => a + r.total_egp!, 0) / priced.length) : null;
    })(),
  };
}
