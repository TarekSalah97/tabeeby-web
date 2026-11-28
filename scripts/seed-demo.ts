/**
 * Demo data for local development and the separate TEST website ONLY.
 * Refuses to run in production unless DEMO_MODE=true. Everything is fictional.
 *
 *   npm run seed:demo
 *
 * Creates 9 doctors (with clinics, hours, follow-up prices, messaging and patient files on),
 * 24 patients with accounts plus walk-in patients, and a year of varied visits: completed visits
 * with full notes, prescriptions, lab requests, payments and reviews; no-shows; cancellations;
 * upcoming bookings; and a few message threads. Safe to run again: history is only added once.
 */
import { loadConfig } from '../src/config.js';
import { createDb, type Queryable } from '../src/db/db.js';
import { hashPassword } from '../src/auth/password.js';
import { clearReferenceCache } from '../src/services/reference.js';
import { DEMO_PASSWORD } from '../src/demo.js';
import { refreshTodayQueue } from '../src/services/demoQueue.js';
import { addDays, todayIn, weekdayOf, zonedToUtc } from '../src/domain/time.js';
import { DbFileStorage, LocalFileStorage } from '../src/storage/files.js';
import { sectionOf, type Section } from '../src/services/orderResults.js';
import { labTest } from '../src/domain/clinical.js';
import { textPdf } from './demo-pdf.js';
import { SERVICE_SUGGESTIONS } from '../src/domain/serviceSuggestions.js';
import { DOCTORS, PATIENTS, TEMPLATES, REVIEW_COMMENTS, MESSAGES, FACILITIES, patientsFor, type DemoDoctor, type DemoFacility } from './demo-data.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production' && !cfg.DEMO_MODE) {
  console.error('Refusing to seed demo data in production (set DEMO_MODE=true only for a separate test website).');
  process.exit(1);
}
const TZ = cfg.TIME_ZONE;

/** Small deterministic random generator so the demo looks the same every time. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)), pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]! };
}

async function id(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query<{ id: number }>(sql, params);
  if (!rows[0]) throw new Error(`reference not found: ${JSON.stringify(params)}`);
  return rows[0].id;
}


/** An approved pharmacy / lab / scan centre with its branches and prices (added once, prices refreshed). */
async function upsertFacility(tx: Queryable, f: DemoFacility, hash: string): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at)
     values ('facility', $1, $2, $3, now())
     on conflict (phone_e164) do update set full_name = excluded.full_name returning id`,
    [`${f.name} (manager)`, f.phone, hash],
  );
  const id = rows[0]!.id;
  const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await tx.query(
    `insert into facilities (user_id, kind, slug, name, description, licence_number, phone_e164, whatsapp_e164, home_service, verification_status, verified_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'approved', now())
     on conflict (user_id) do update set name = excluded.name, description = excluded.description, home_service = excluded.home_service,
       phone_e164 = excluded.phone_e164, whatsapp_e164 = excluded.whatsapp_e164`,
    [id, f.kind, slug, f.name, `${f.description} (Demo — not a real place.)`, `DEMO-${f.phone.slice(-3)}`, f.phone, f.whatsapp ?? null, f.homeService],
  );
  const has = await tx.query('select 1 from facility_branches where facility_id = $1 limit 1', [id]);
  if (!has.rows.length) {
    for (const b of f.branches) {
      const districtId = await idOf(tx, 'select id from districts where slug = $1', [b.district]);
      await tx.query(
        `insert into facility_branches (facility_id, name, district_id, address, phone_e164, open_24h, open_days, opens, closes)
         values ($1, $2, $3, $4, $5, $6, $7::smallint[], $8::time, $9::time)`,
        [id, b.name, districtId, b.address, f.phone, !!b.open24h, b.days ?? [0, 1, 2, 3, 4, 5, 6], b.open24h ? '00:00' : b.opens, b.open24h ? '23:59' : b.closes],
      );
    }
  }
  for (const [code, price] of Object.entries(f.prices ?? {})) {
    await tx.query(
      `insert into facility_tests (facility_id, test_code, price_egp) values ($1, $2, $3)
       on conflict (facility_id, test_code) do update set price_egp = excluded.price_egp`,
      [id, code, price],
    );
  }
}

const idOf = id;
const slugOf = (name: string) => `dr-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;

async function upsertDoctor(tx: Queryable, d: DemoDoctor, hash: string, insurerId: number): Promise<{ userId: string; clinicId: string }> {
  const specialtyId = await id(tx, 'select id from specialties where slug = $1', [d.specialty]);
  const kind = d.specialty === 'dentistry' ? 'dental' : 'medical';
  const { rows } = await tx.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, email, password_hash, phone_verified_at, email_verified_at)
     values ('doctor', $1, $2, $3, $4, now(), now())
     on conflict (phone_e164) do update set full_name = excluded.full_name returning id`,
    [`Dr. ${d.name}`, d.phone, `${d.name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, hash],
  );
  const userId = rows[0]!.id;
  await tx.query(
    `insert into doctors (user_id, slug, kind, title_en, title_ar, bio, specialty_id, graduation_year, languages, verification_status, verified_at,
                          records_enabled, messaging_enabled, messaging_days, messaging_start, messaging_end)
     values ($1, $2, $3, $4, $5, $6, $7, $8, '{ar,en}', 'approved', now(), true, true, '{0,1,2,3,4,6}', '09:00', '21:00')
     on conflict (user_id) do update set records_enabled = true, messaging_enabled = true`,
    [userId, slugOf(d.name), kind, d.titleEn, d.titleAr, 'Demo profile for testing. Not a real doctor.', specialtyId, d.gradYear],
  );
  for (const s of d.subs) {
    await tx.query(
      `insert into doctor_subspecialties (doctor_id, subspecialty_id) select $1, id from subspecialties where slug = $2 and specialty_id = $3 on conflict do nothing`,
      [userId, s, specialtyId],
    );
  }
  await tx.query('insert into doctor_insurers (doctor_id, insurer_id) values ($1, $2) on conflict do nothing', [userId, insurerId]);
  const existing = await tx.query<{ id: string }>('select id from clinics where doctor_id = $1 order by created_at limit 1', [userId]);
  if (existing.rows[0]) return { userId, clinicId: existing.rows[0].id };
  const districtId = await id(tx, 'select id from districts where slug = $1', [d.district]);
  const clinic = await tx.query<{ id: string }>(
    `insert into clinics (doctor_id, name, district_id, address, phone_e164, fee_egp, follow_up_fee_egp, follow_up_days)
     values ($1, $2, $3, $4, $5, $6, $7, 14) returning id`,
    [userId, d.clinic, districtId, `${10 + DOCTORS.indexOf(d) * 7} Demo Street`, `+2034${String(2000000 + DOCTORS.indexOf(d))}`, d.fee, d.followUpFee],
  );
  for (const day of d.days) {
    await tx.query(`insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, $3, $4, 30)`, [clinic.rows[0]!.id, day, d.from, d.to]);
  }
  for (const [title, workplace, start, end] of d.positions) {
    await tx.query('insert into doctor_positions (doctor_id, title, workplace, start_month, end_month) values ($1, $2, $3, $4, $5)', [userId, title, workplace, start, end]);
  }
  return { userId, clinicId: clinic.rows[0]!.id };
}

/** Free slot on one of the doctor's working days, `daysAgo` days back (negative = future). */
function slotNear(d: DemoDoctor, daysAgo: number, used: Set<string>, r: ReturnType<typeof rng>): Date {
  const today = todayIn(TZ, new Date());
  for (let shift = 0; shift < 14; shift++) {
    const date = addDays(today, -daysAgo + (daysAgo >= 0 ? -shift : shift));
    if (!d.days.includes(weekdayOf(date))) continue;
    const [fh, fm] = d.from.split(':').map(Number) as [number, number];
    const [th] = d.to.split(':').map(Number) as [number];
    const slots = (th - fh) * 2;
    for (let tries = 0; tries < slots; tries++) {
      const k = r.int(0, slots - 1);
      const mins = fh * 60 + fm + k * 30;
      const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      const key = `${date} ${time}`;
      if (used.has(key)) continue;
      used.add(key);
      return zonedToUtc(date, time, TZ);
    }
  }
  throw new Error('no free slot');
}


// Realistic reasons for a heart clinic; also how a restart finds (and replaces) these bookings.
const SCHEDULE_REASONS = ['Chest pain on effort', 'Palpitations', 'Blood pressure check', 'ECG review', 'Shortness of breath', 'Echo results', 'Check-up before surgery'];
const SCHEDULE_WALK_INS: [string, string][] = [
  ['Mahmoud Ibrahim', '+201112345601'], ['Fatma Ali', '+201112345602'], ['Hossam Farouk', '+201112345603'],
  ['Rania Sobhy', '+201112345604'], ['Ehab Mansour', '+201112345605'], ['Dina Lotfy', '+201112345606'],
];
const SCHEDULE_FROM = '10:00';
const SCHEDULE_TO = '22:00';

/**
 * A busy but not full diary for the first demo doctor (Dr. Ahmed Hassan): the clinic opens every day
 * 10:00–22:00, and about half of the remaining times today, tomorrow and the day after are booked
 * (account patients and walk-ins, new visits and follow-ups). The other half stays free so the
 * doctor and patients can still book. Rebuilt on every start, so the days follow the real date.
 */
/** A demo secretary for the first doctor (Dr. Ahmed Hassan), allowed schedule and patient files. */
async function ensureDemoSecretary(tx: Queryable, doctorId: string, hash: string): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at, preferred_locale)
     values ('assistant', 'Mona Secretary', '+201000000501', $1, now(), 'ar')
     on conflict (phone_e164) do update set password_hash = excluded.password_hash returning id`,
    [hash],
  );
  await tx.query(
    `insert into doctor_assistants (user_id, doctor_id, access, joined_at) values ($1, $2, 'files', now())
     on conflict (user_id, doctor_id) do update set joined_at = coalesce(doctor_assistants.joined_at, now())`,
    [rows[0]!.id, doctorId],
  );
}

async function refreshComingDays(tx: Queryable, doctor: { userId: string; clinicId: string }, patientIds: string[]): Promise<number> {
  await tx.query('savepoint demo_days');
  try {
    await tx.query('delete from schedule_rules where clinic_id = $1', [doctor.clinicId]);
    for (let day = 0; day < 7; day++) {
      await tx.query(`insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, $3, $4, 30)`,
        [doctor.clinicId, day, SCHEDULE_FROM, SCHEDULE_TO]);
    }
    await tx.query(`delete from appointments where doctor_id = $1 and reason = any($2::text[]) and status = 'confirmed' and arrived_at is null`,
      [doctor.userId, SCHEDULE_REASONS]);
    const half = 30 * 60_000;
    const earliest = Date.now() + half; // today: only times that have not started yet
    const today = todayIn(TZ, new Date());
    let booked = 0;
    let who = 0;
    for (let offset = 0; offset < 3; offset++) {
      const date = addDays(today, offset);
      const from = zonedToUtc(date, SCHEDULE_FROM, TZ).getTime();
      const to = zonedToUtc(date, SCHEDULE_TO, TZ).getTime();
      for (let t = from, k = 0; t + half <= to; t += half, k++) {
        // Book 3 of every 5 times (shifted per day) and leave the rest free.
        if (t < earliest || [1, 4].includes((k + offset * 2) % 5)) continue;
        const start = new Date(t);
        const end = new Date(t + half);
        const clash = await tx.query(
          `select 1 from appointments where doctor_id = $1 and status <> 'cancelled' and starts_at < $3 and ends_at > $2 limit 1`,
          [doctor.userId, start, end],
        );
        if (clash.rows.length) continue;
        const walkIn = who % 4 === 3 ? SCHEDULE_WALK_INS[(who >> 2) % SCHEDULE_WALK_INS.length]! : null;
        // Patients 0–7 are in today's live queue; use the rest for the diary.
        const patientId = walkIn ? null : patientIds[8 + (who % (patientIds.length - 8))]!;
        const followUp = who % 3 === 1;
        await tx.query(
          `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, reason, fee_egp)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [doctor.userId, doctor.clinicId, patientId, walkIn?.[0] ?? null, walkIn?.[1] ?? null, walkIn ? 'doctor' : 'patient',
            start, end, followUp ? 'follow_up' : 'new', SCHEDULE_REASONS[who % SCHEDULE_REASONS.length]!, followUp ? 250 : 500],
        );
        who++;
        booked++;
      }
    }
    await tx.query('release savepoint demo_days');
    return booked;
  } catch (err) {
    await tx.query('rollback to savepoint demo_days');
    console.warn('Demo diary skipped:', err instanceof Error ? err.message : err);
    return 0;
  }
}


/**
 * Fictional results in the demo patients' health records: for the first six demo patients, every
 * lab part goes to Alpha Labs and every imaging part to Delta Scan Center. Most are released with a
 * one-page PDF; the newest of each kind stays "in progress" so both states can be seen.
 * Only parts that were never sent are touched, so running this again changes nothing.
 */
async function seedDemoResults(tx: Queryable, patientPhones: string[]): Promise<number> {
  const storage = cfg.STORAGE_DRIVER === 'db' ? new DbFileStorage(tx) : new LocalFileStorage(cfg.UPLOAD_DIR);
  const centre = async (phone: string) => (await tx.query<{ user_id: string; name: string }>(
    'select f.user_id, f.name from facilities f join users u on u.id = f.user_id where u.phone_e164 = $1', [phone])).rows[0];
  const lab = await centre('+201000000311');
  const scan = await centre('+201000000321');
  if (!lab || !scan) return 0;
  const { rows } = await tx.query<{ lab_order_id: string; patient_id: string; patient_name: string; doctor_name: string; issued_at: Date; test_code: string | null; test_name: string | null }>(
    `select l.id as lab_order_id, u.id as patient_id, u.full_name as patient_name, du.full_name as doctor_name, l.issued_at, i.test_code, i.test_name
       from lab_orders l join encounters e on e.id = l.encounter_id join patient_records r on r.id = e.record_id
       join users u on u.id = r.patient_user_id join users du on du.id = l.doctor_id join lab_order_items i on i.lab_order_id = l.id
      where u.phone_e164 = any(string_to_array($1, ',')) and l.status = 'active'
        and not exists (select 1 from order_requests q where q.lab_order_id = l.id)
      order by l.issued_at, i.position`,
    [patientPhones.join(',')],
  );
  const parts = new Map<string, { orderId: string; section: Section; patientId: string; patientName: string; doctorName: string; issuedAt: Date; tests: string[] }>();
  for (const r of rows) {
    const section = sectionOf(r);
    const key = `${r.lab_order_id}:${section}`;
    const name = r.test_code ? (labTest(r.test_code)?.en ?? r.test_code) : (r.test_name ?? '');
    const part = parts.get(key) ?? { orderId: r.lab_order_id, section, patientId: r.patient_id, patientName: r.patient_name, doctorName: r.doctor_name, issuedAt: r.issued_at, tests: [] };
    part.tests.push(name);
    parts.set(key, part);
  }
  const newest = new Map<string, number>();
  for (const p of parts.values()) newest.set(`${p.patientId}:${p.section}`, Math.max(newest.get(`${p.patientId}:${p.section}`) ?? 0, p.issuedAt.getTime()));
  const firstPatientId = (await tx.query<{ id: string }>('select id from users where phone_e164 = $1', [patientPhones[0]])).rows[0]?.id;
  let n = 0;
  for (const p of parts.values()) {
    const c = p.section === 'imaging' ? scan : lab;
    const isNewest = p.issuedAt.getTime() === newest.get(`${p.patientId}:${p.section}`);
    // The first demo patient keeps their newest orders unsent, to try "Send to a lab" themselves.
    if (isNewest && p.patientId === firstPatientId) continue;
    const inProgress = isNewest && p.issuedAt.getTime() > Date.now() - 45 * 86400_000;
    const sentAt = new Date(p.issuedAt.getTime() + 86400_000);
    const readyAt = new Date(sentAt.getTime() + 2 * 86400_000);
    const req = await tx.query<{ id: string }>(
      `insert into order_requests (lab_order_id, section, patient_id, facility_id, status, facility_note, created_at, updated_at, received_at, ready_at)
       values ($1, $2, $3, $4, $5, $6, $7, $7, $7, $8) returning id`,
      [p.orderId, p.section, p.patientId, c.user_id, inProgress ? 'received' : 'ready',
        inProgress ? null : 'Please review these results with your doctor.', sentAt, inProgress ? null : readyAt],
    );
    if (!inProgress) {
      const pdf = textPdf([
        `${c.name} - DEMO RESULT (fictional, not a real report)`, '',
        `Patient: ${p.patientName}`, `Requested by: ${p.doctorName}`, `Date: ${readyAt.toISOString().slice(0, 10)}`, '',
        ...p.tests.map((t) => `- ${t}: ${p.section === 'imaging' ? 'No significant abnormality seen (demo)' : 'Within the reference range (demo)'}`),
        '', 'This file was generated for the Tabeeby demo site.',
      ]);
      const key = await storage.put(pdf, 'pdf');
      await tx.query('insert into order_results (request_id, storage_key, mime, size_bytes, uploaded_by, created_at) values ($1, $2, $3, $4, $5, $6)',
        [req.rows[0]!.id, key, 'application/pdf', pdf.length, c.user_id, readyAt]);
    }
    n++;
  }
  return n;
}

const db = createDb(cfg);
try {
  const hash = await hashPassword(DEMO_PASSWORD);
  const summary = await db.transaction(async (tx) => {
    await tx.query(`insert into insurers (slug, name_en, name_ar) values
      ('demo-insurer-a', 'Demo Insurer A', 'تأمين تجريبي أ'), ('demo-insurer-b', 'Demo Insurer B', 'تأمين تجريبي ب')
      on conflict (slug) do nothing`);
    const insurerA = await id(tx, 'select id from insurers where slug = $1', ['demo-insurer-a']);

    const doctors = [];
    for (const d of DOCTORS) doctors.push({ d, ...(await upsertDoctor(tx, d, hash, insurerA)) });

    for (const f of FACILITIES) await upsertFacility(tx, f, hash);

    // A few services per demo doctor (names from the specialty suggestions), so booking a service can be tried.
    for (const { d, userId, clinicId } of doctors) {
      const picks = (SERVICE_SUGGESTIONS[d.specialty] ?? []).slice(0, 3);
      for (const [i, [en, ar]] of picks.entries()) {
        await tx.query(
          `insert into clinic_services (clinic_id, doctor_id, name, name_ar, price_egp) values ($1, $2, $3, $4, $5)
           on conflict (clinic_id, lower(btrim(name))) do update set name_ar = coalesce(clinic_services.name_ar, excluded.name_ar)`,
          [clinicId, userId, en, ar, Math.round((d.fee * (1.2 + i * 0.6)) / 50) * 50],
        );
      }
    }

    const patientIds: string[] = [];
    for (const p of PATIENTS) {
      const { rows } = await tx.query<{ id: string }>(
        `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at, has_password)
         values ('patient', $1, $2, $3, now(), true)
         on conflict (phone_e164) do update set full_name = excluded.full_name returning id`,
        [p.name, p.phone, hash],
      );
      patientIds.push(rows[0]!.id);
    }

    // History is added once; running the script again only refreshes accounts (and today's demo queue).
    const already = await tx.query('select 1 from patient_records where doctor_id = $1 limit 1', [doctors[0]!.userId]);
    if (already.rows.length) {
      const q = await refreshTodayQueue(tx, doctors[0]!, patientIds, new Date(), TZ);
      const days = await refreshComingDays(tx, doctors[0]!, patientIds);
      await ensureDemoSecretary(tx, doctors[0]!.userId, await hashPassword(DEMO_PASSWORD));
      const res = await seedDemoResults(tx, PATIENTS.slice(0, 6).map((p) => p.phone));
      return `Accounts refreshed; visit history already present; ${q} visits in today's demo queue; ${days} booked visits today to the day after tomorrow; ${res} new demo results.`;
    }

    let visits = 0;
    for (const [di, { d, userId, clinicId }] of doctors.entries()) {
      const r = rng(1000 + di);
      const templates = TEMPLATES[d.notes];
      const used = new Set<string>();
      const firstVisits = templates.filter((t) => !t.followUp);
      const followUps = templates.filter((t) => t.followUp);

      // Account patients for this kind of doctor, plus two walk-ins the clinic added.
      const pool = patientsFor(d);
      const chosen = pool.sort(() => r.next() - 0.5).slice(0, Math.min(8, pool.length));
      const people: { patientId: string | null; idx: number | null; name: string; phone: string }[] = chosen.map((i) => ({
        patientId: patientIds[i]!, idx: i, name: PATIENTS[i]!.name, phone: PATIENTS[i]!.phone,
      }));
      people.push(
        { patientId: null, idx: null, name: r.pick(['Samir Abdelaziz', 'Hanan Mahmoud', 'Bassem Ali', 'Eman Saad']), phone: `+20112000${String(di).padStart(2, '0')}01` },
        { patientId: null, idx: null, name: r.pick(['Reda Fouad', 'Shaimaa Osman', 'Magdy Lotfy', 'Asmaa Hamed']), phone: `+20112000${String(di).padStart(2, '0')}02` },
      );

      for (const person of people) {
        const p = person.idx === null ? null : PATIENTS[person.idx]!;
        const rec = await tx.query<{ id: string }>(
          `insert into patient_records (doctor_id, patient_user_id, full_name, phone_e164, date_of_birth, sex, occupation, marital_status, habits,
                                        allergies, chronic_conditions, past_history, current_medications, family_history, consent_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now() - interval '1 year') returning id`,
          [userId, person.patientId, person.name, person.phone, p?.dob ?? `19${r.int(55, 99)}-0${r.int(1, 9)}-1${r.int(0, 9)}`,
            p?.sex ?? r.pick(['male', 'female']), p?.occupation ?? null, p?.marital ?? null, p?.habits ?? [],
            p?.allergies ?? 'None known', p?.chronic ?? null, p?.past ?? null, p?.meds ?? null, p?.family ?? null],
        );
        const recordId = rec.rows[0]!.id;

        // 1–4 past visits over the last year, oldest first, then sometimes an upcoming one.
        const count = r.int(1, 4);
        const ages = Array.from({ length: count }, () => r.int(3, 360)).sort((a, b) => b - a);
        let completedHere = 0;
        for (const [vi, daysAgo] of ages.entries()) {
          const start = slotNear(d, daysAgo, used, r);
          const roll = r.next();
          // Everyone has at least one completed visit, so every file has notes to read.
          const status = vi === count - 1 && completedHere === 0 ? 'completed' : roll < 0.1 ? 'no_show' : roll < 0.17 ? 'cancelled' : 'completed';
          const followUp = vi > 0 && status === 'completed' && followUps.length > 0 && r.next() < 0.5;
          const t = followUp ? r.pick(followUps) : r.pick(firstVisits);
          const visitType = vi > 0 && ages[vi - 1]! - daysAgo <= 14 ? 'follow_up' : 'new';
          const fee = visitType === 'follow_up' ? d.followUpFee : d.fee;
          const appt = await tx.query<{ id: string }>(
            `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, reason, fee_egp,
                                       status, cancelled_by, cancelled_at, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $7::timestamptz - interval '3 days') returning id`,
            [userId, clinicId, person.patientId, person.patientId ? null : person.name, person.patientId ? null : person.phone,
              person.patientId ? (r.next() < 0.8 ? 'patient' : 'patient') : 'doctor', start, new Date(start.getTime() + 25 * 60_000), visitType, t.complaint.slice(0, 200), fee,
              status, status === 'cancelled' ? (r.next() < 0.6 ? 'patient' : 'doctor') : null, status === 'cancelled' ? new Date(start.getTime() - 86400_000) : null],
          );
          const apptId = appt.rows[0]!.id;
          if (status !== 'completed') continue;
          visits++;
          completedHere++;
          const enc = await tx.query<{ id: string }>(
            `insert into encounters (record_id, doctor_id, appointment_id, clinic_id, visit_at, chief_complaint, history, examination, diagnosis, plan)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
            [recordId, userId, apptId, clinicId, start, t.complaint, t.history, t.exam, t.diagnosis, t.plan],
          );
          const encId = enc.rows[0]!.id;
          if (t.meds.length) {
            const rx = await tx.query<{ id: string }>(`insert into prescriptions (encounter_id, doctor_id, issued_at) values ($1, $2, $3) returning id`, [encId, userId, start]);
            for (const [pi, med] of t.meds.entries()) {
              await tx.query(
                `insert into prescription_items (prescription_id, position, medicine, form, dose, frequency, timing, duration) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [rx.rows[0]!.id, pi + 1, med.medicine, med.form, med.dose, med.frequency, med.timing ?? null, med.duration ?? null],
              );
            }
          }
          if (t.labs.length) {
            const lab = await tx.query<{ id: string }>(`insert into lab_orders (encounter_id, doctor_id, issued_at) values ($1, $2, $3) returning id`, [encId, userId, start]);
            for (const [li, code] of t.labs.entries()) {
              await tx.query(`insert into lab_order_items (lab_order_id, position, test_code) values ($1, $2, $3)`, [lab.rows[0]!.id, li + 1, code]);
            }
          }
          // Most visits were paid at the clinic; a few are still unpaid.
          if (r.next() < 0.85) {
            await tx.query(
              `insert into payments (appointment_id, doctor_id, amount_egp, method, recorded_by, paid_at) values ($1, $2, $3, $4, $2, $5)`,
              [apptId, userId, fee, r.pick(['cash', 'cash', 'cash', 'card', 'instapay', 'wallet', 'insurance']), new Date(start.getTime() + 30 * 60_000)],
            );
          }
          if (person.patientId && r.next() < 0.45) {
            await tx.query(
              `insert into reviews (appointment_id, doctor_id, patient_id, rating, comment, created_at) values ($1, $2, $3, $4, $5, $6)`,
              [apptId, userId, person.patientId, r.pick([5, 5, 5, 4, 4, 3]), r.pick(REVIEW_COMMENTS) || null, new Date(start.getTime() + 86400_000)],
            );
          }
        }
        // About a third have an upcoming visit in the next two weeks.
        if (r.next() < 0.35) {
          const start = slotNear(d, -r.int(1, 14), used, r);
          await tx.query(
            `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, reason, fee_egp)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'follow_up', 'Follow-up', $9)`,
            [userId, clinicId, person.patientId, person.patientId ? null : person.name, person.patientId ? null : person.phone,
              person.patientId ? 'patient' : 'doctor', start, new Date(start.getTime() + 25 * 60_000), d.followUpFee],
          );
        }
      }

      // A couple of message threads with account patients.
      for (const [mi, person] of people.filter((x) => x.patientId).slice(0, 2).entries()) {
        const [q, a] = MESSAGES[(di + mi) % MESSAGES.length]!;
        const conv = await tx.query<{ id: string }>(
          `insert into conversations (doctor_id, patient_id, last_message_at, last_sender, patient_read_at) values ($1, $2, now() - interval '1 day', 'doctor', null)
           on conflict (doctor_id, patient_id) do nothing returning id`,
          [userId, person.patientId],
        );
        if (!conv.rows[0]) continue;
        await tx.query(`insert into messages (conversation_id, sender, body, created_at) values ($1, 'patient', $2, now() - interval '2 days'), ($1, 'doctor', $3, now() - interval '1 day')`, [conv.rows[0].id, q, a]);
      }
    }
    const q = await refreshTodayQueue(tx, doctors[0]!, patientIds, new Date(), TZ);
    const days = await refreshComingDays(tx, doctors[0]!, patientIds);
    await ensureDemoSecretary(tx, doctors[0]!.userId, hash);
    await seedDemoResults(tx, PATIENTS.slice(0, 6).map((p) => p.phone));
    return `Added ${visits} completed visits with notes across ${DOCTORS.length} doctors; ${q} visits in today's demo queue; ${days} booked visits today to the day after tomorrow.`;
  });
  clearReferenceCache();
  console.log(summary);
  console.log(`Demo logins (password ${DEMO_PASSWORD}): patients 01000000201..224, doctors 01000000101..109, pharmacies/labs/scan centres 01000000301..323, secretary 01000000501`);
} finally {
  await db.end();
}
