/**
 * Conflict tests: many people (or one impatient person) doing the same thing at the same moment.
 * Each scenario fires requests simultaneously, then checks the database for the right outcome and
 * that nobody got a server error. Run against a LOCAL copy loaded with scripts/load/bulk.sql:
 *
 *   DATABASE_URL=postgres://…/loadtest npx tsx scripts/load/conflicts.ts
 */
import { createDb } from '../../src/db/db.js';
import { Visitor, together, countBy, loadDoctorPhone, loadPatientPhone, type Res } from './lib.js';

const url = process.env['DATABASE_URL'];
if (!url || /neon\.tech|render\.com/.test(url)) {
  console.error('Set DATABASE_URL to the LOCAL load-test database.');
  process.exit(1);
}
const db = createDb({ DATABASE_URL: url, DATABASE_SSL: 'disable', DATABASE_POOL_SIZE: 3, DATABASE_SSL_CA_FILE: undefined });
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T & Record<string, unknown>>(sql, params)).rows[0]!;

// Start each run with clean rate limits (they would otherwise carry over from the previous run).
await db.query('delete from rate_limits');

interface Outcome { name: string; pass: boolean; detail: string }
const results: Outcome[] = [];
let serverErrors = 0;
const summarise = (rs: Res[]) =>
  JSON.stringify(countBy(rs, (r) => (r.status >= 500 ? `${r.status}!` : `${r.status} ${(r.location ?? '').replace(/^.*\?/, '?').slice(0, 40)}`)));
const note = (rs: Res[]) => {
  serverErrors += rs.filter((r) => r.status >= 500).length;
  return summarise(rs);
};
async function scenario(name: string, fn: () => Promise<{ pass: boolean; detail: string }>) {
  try {
    const r = await fn();
    results.push({ name, ...r });
  } catch (e) {
    results.push({ name, pass: false, detail: `crashed: ${(e as Error).message}` });
  }
  const last = results[results.length - 1]!;
  console.log(`${last.pass ? 'PASS' : 'FAIL'}  ${name}\n      ${last.detail}`);
}

/** A free bookable slot for a load doctor, taken from their public page. */
async function freeSlot(doctorN: number, skip = 0): Promise<{ clinic: string; start: string; doctorId: string }> {
  const v = new Visitor();
  const page = await v.get(`/en/doctors/load-doctor-${doctorN}`);
  const clinicId = /clinic=([0-9a-f-]{36})/.exec(page.body)?.[1];
  let slots: RegExpMatchArray[] = [];
  for (let d = 1; d <= 6 && slots.length <= skip; d++) {
    const date = new Date(Date.now() + d * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const day = await v.get(`/en/doctors/load-doctor-${doctorN}?clinic=${clinicId}&date=${date}`);
    slots = [...day.body.matchAll(/book\?doctor=[^&"]+&(?:amp;)?clinic=([0-9a-f-]{36})&(?:amp;)?start=([^"&]+)/g)];
  }
  if (slots.length <= skip) throw new Error(`no free slot on load-doctor-${doctorN}`);
  const [, clinic, start] = slots[skip]!;
  const doc = await one<{ id: string }>(`select user_id as id from doctors where slug = $1`, [`load-doctor-${doctorN}`]);
  return { clinic: clinic!, start: decodeURIComponent(start!), doctorId: doc.id };
}

async function patients(from: number, n: number): Promise<Visitor[]> {
  // Clear any pending future visits so the active-visit limit doesn't hide the slot race.
  const phones = Array.from({ length: n }, (_, i) => `+2012${String(from + i).padStart(8, '0')}`);
  await db.query(
    `update appointments set status = 'cancelled', cancelled_by = 'admin' where status in ('confirmed','arrived') and starts_at > now()
       and patient_id in (select id from users where phone_e164 = any($1))`, [phones]);
  return Promise.all(Array.from({ length: n }, (_, i) => new Visitor().login(loadPatientPhone(from + i))));
}

await scenario('40 patients book the same slot at the same moment → exactly one gets it', async () => {
  const slot = await freeSlot(11);
  const ps = await patients(1001, 40);
  await Promise.all(ps.map((p) => p.get(`/en/book?clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`)));
  const rs = await together(40, (i) => ps[i]!.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '', pay: 'cash' }));
  const n = await one<{ n: number }>(`select count(*)::int n from appointments where doctor_id = $1 and starts_at = $2 and status <> 'cancelled'`, [slot.doctorId, slot.start]);
  const won = rs.filter((r) => /ok=booked/.test(r.location ?? '')).length;
  return { pass: n.n === 1 && won === 1 && rs.every((r) => r.status < 500), detail: `booked rows=${n.n}, winners=${won}; responses ${note(rs)}` };
});

await scenario('one patient taps Book 15 times on 15 different slots → never more than the 5-visit limit', async () => {
  const [p] = await patients(1101, 1);
  const slots = await Promise.all(Array.from({ length: 15 }, (_, i) => freeSlot(20 + i)));
  for (const s of slots) await p!.get(`/en/book?clinic=${s.clinic}&start=${encodeURIComponent(s.start)}`);
  const rs = await together(15, (i) => p!.post('/en/book', { clinic: slots[i]!.clinic, start: slots[i]!.start, reason: '', pay: 'cash' }));
  const n = await one<{ n: number }>(
    `select count(*)::int n from appointments a join users u on u.id = a.patient_id where u.phone_e164 = $1 and a.status in ('confirmed','arrived') and a.starts_at > now()`,
    ['+201200001101']);
  return { pass: n.n <= 5 && rs.every((r) => r.status < 500), detail: `active visits=${n.n} (limit 5); responses ${note(rs)}` };
});

// Each clinic scenario gets its own load doctor, with visits placed relative to now.
const pat = await one<{ id: string }>(`select id from users where phone_e164 = '+201200001201'`);
async function clinicOf(n: number) {
  const d = await one<{ id: string; clinic: string }>(`select d.user_id id, c.id clinic from doctors d join clinics c on c.doctor_id = d.user_id where d.slug = $1`, [`load-doctor-${n}`]);
  // Clear this doctor's visits around now so test visits never overlap them.
  // Cancelled visits don't block a time, and nothing has to be deleted (payments can't be).
  await db.query(
    `update appointments set status = 'cancelled', cancelled_by = 'admin' where doctor_id = $1 and status <> 'cancelled'
       and starts_at between now() - interval '1 day' and now() + interval '1 day'`, [d.id]);
  const v = await new Visitor().login(loadDoctorPhone(n));
  return { ...d, v };
}
async function visitAt(d: { id: string; clinic: string }, status: string, minutesFromNow: number): Promise<string> {
  const r = await one<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, booked_by, starts_at, ends_at, visit_type, fee_egp, status, completed_at)
     values ($1, $2, $3, 'patient', now() + make_interval(mins => $4), now() + make_interval(mins => $4 + 30), 'new', 300, $5, case when $5 = 'completed' then now() end)
     returning id`, [d.id, d.clinic, pat.id, minutesFromNow, status]);
  return r.id;
}

await scenario('the doctor and the secretary both press "Paid" 10 times → one payment', async () => {
  const d = await clinicOf(5);
  const id = await visitAt(d, 'completed', -40);
  await d.v.get('/en/dashboard');
  const rs = await together(10, () => d.v.post(`/en/dashboard/appointments/${id}/pay`, { method: 'cash', amount: '' }));
  const n = await one<{ n: number }>(`select count(*)::int n from payments where appointment_id = $1 and status = 'paid'`, [id]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `payments=${n.n}; responses ${note(rs)}` };
});

await scenario('doctor presses "Arrived" while the secretary presses "Didn\'t come" → one clear final status', async () => {
  const d = await clinicOf(7);
  const id = await visitAt(d, 'confirmed', -10);
  await d.v.get('/en/dashboard');
  const rs = await together(10, (i) => d.v.post(`/en/dashboard/appointments/${id}/status`, { to: i % 2 ? 'arrived' : 'no_show' }));
  const a = await one<{ status: string }>(`select status from appointments where id = $1`, [id]);
  const won = rs.filter((r) => r.status === 303 && !/error=/.test(r.location ?? '')).length;
  return { pass: ['arrived', 'no_show'].includes(a.status) && won === 1 && rs.every((r) => r.status < 500), detail: `final=${a.status}, accepted presses=${won}; responses ${note(rs)}` };
});

await scenario('"Save patient file" double-clicked 6 times → one file', async () => {
  const d = await clinicOf(8);
  const id = await visitAt(d, 'in_consultation', -10);
  await db.query(`delete from patient_records where doctor_id = $1 and patient_user_id = $2`, [d.id, pat.id]);
  await d.v.get(`/en/dashboard/appointments/${id}/file`);
  const rs = await together(6, () => d.v.post('/en/dashboard/patients', { fullName: 'Load Patient 1201', consent: 'yes', appointment: id }));
  const n = await one<{ n: number }>(`select count(*)::int n from patient_records where doctor_id = $1 and patient_user_id = $2`, [d.id, pat.id]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `files=${n.n}; responses ${note(rs)}` };
});

await scenario('"Save visit" double-clicked 6 times for the same booked visit → one visit note', async () => {
  const d = await clinicOf(9);
  const appt = await visitAt(d, 'in_consultation', -10);
  await db.query(`insert into patient_records (doctor_id, patient_user_id, full_name, consent_at) values ($1, $2, 'Load Patient 1201', now()) on conflict do nothing`, [d.id, pat.id]);
  const rec = (await one<{ id: string }>(`select id from patient_records where doctor_id = $1 and patient_user_id = $2`, [d.id, pat.id])).id;
  await d.v.get(`/en/dashboard/patients/${rec}/visits/new?appointment=${appt}`);
  const rs = await together(6, () => d.v.post(`/en/dashboard/patients/${rec}/visits`, { appointment: appt, complaint: 'Cough', diagnosis: 'URTI' }));
  const n = await one<{ n: number }>(`select count(*)::int n from encounters where appointment_id = $1`, [appt]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `visit notes=${n.n}; responses ${note(rs)}` };
});

await scenario('a patient submits the same review 6 times → one review', async () => {
  const d = await clinicOf(10);
  const id = await visitAt(d, 'completed', -60);
  const p = await new Visitor().login(loadPatientPhone(1201));
  await p.get('/en/appointments');
  const rs = await together(6, () => p.post(`/en/appointments/${id}/review`, { rating: '5', comment: 'Great' }));
  const n = await one<{ n: number }>(`select count(*)::int n from reviews where appointment_id = $1`, [id]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `reviews=${n.n}; responses ${note(rs)}` };
});

await scenario('10 sign-ups with the same new phone number at once → one account', async () => {
  const phone = '01599' + String(Date.now()).slice(-6);
  const vs = Array.from({ length: 10 }, () => new Visitor());
  await Promise.all(vs.map((v) => v.get('/en/signup')));
  const rs = await together(10, (i) => vs[i]!.post('/en/signup', { fullName: 'Race Person', phone, password: 'race-password-2026', consent: 'yes' }));
  const n = await one<{ n: number }>(`select count(*)::int n from users where phone_e164 = $1`, ['+20' + phone.slice(1)]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `accounts=${n.n}; responses ${note(rs)}` };
});

await scenario('the doctor adds the same working hours from two tabs at once → no overlap saved', async () => {
  const d = await new Visitor().login(loadDoctorPhone(6));
  const c = await one<{ id: string }>(`select c.id from clinics c join doctors d on d.user_id = c.doctor_id where d.slug = 'load-doctor-6'`);
  await db.query(`delete from schedule_rules where clinic_id = $1 and weekday = 5`, [c.id]);
  await d.get('/en/dashboard/hours');
  const rs = await together(8, () => d.post('/en/dashboard/hours/rules', { clinic: c.id, slot: '20', days: ['5'], start_5: '10:00', end_5: '14:00' }));
  const n = await one<{ n: number }>(`select count(*)::int n from schedule_rules where clinic_id = $1 and weekday = 5`, [c.id]);
  return { pass: n.n === 1 && rs.every((r) => r.status < 500), detail: `Friday rules=${n.n}; responses ${note(rs)}` };
});

await scenario('30 wrong-password attempts on one account at once → blocked, no crash', async () => {
  const vs = Array.from({ length: 30 }, () => new Visitor());
  await Promise.all(vs.map((v) => v.get('/en/login')));
  const rs = await together(30, (i) => vs[i]!.post('/en/login', { phone: loadPatientPhone(1301), password: 'wrong-password-123' }));
  const ok = rs.filter((r) => r.status === 303 && !/login/.test(r.location ?? '')).length;
  const limited = rs.filter((r) => r.status === 429 || /too.?many|محاولات/i.test(r.body)).length;
  return { pass: ok === 0 && rs.every((r) => r.status < 500), detail: `signed in=${ok}, told "too many attempts"=${limited}; responses ${note(rs)}` };
});

await scenario('patient and clinic cancel the same visit at the same moment → cancelled once, no error', async () => {
  const p = await new Visitor().login(loadPatientPhone(1201));
  const d = await clinicOf(12);
  // Starts in 2½ hours (cancellable), within the 2-hour early-arrival window? No — so use 1h50m: the
  // patient may cancel only if CANCEL_CUTOFF_HOURS allows; the secretary may mark arrival.
  const id = await visitAt(d, 'confirmed', 150);
  await p.get('/en/appointments');
  await d.v.get('/en/dashboard');
  const rs = await together(2, (i) => (i === 0 ? p.post(`/en/appointments/${id}/cancel`, {}) : d.v.post(`/en/dashboard/appointments/${id}/status`, { to: 'cancelled' })));
  const a = await one<{ status: string; cancelled_by: string }>(`select status, cancelled_by from appointments where id = $1`, [id]);
  return { pass: a.status === 'cancelled' && rs.every((x) => x.status < 500), detail: `final=${a.status} by ${a.cancelled_by}; responses ${note(rs)}` };
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed; server errors seen: ${serverErrors}`);
process.exit(failed.length ? 1 : 0);
