import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, firstSlotStart, type Harness } from '../helpers.js';
import { todayIn, addDays } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const TZ = 'Africa/Cairo';
const today = () => todayIn(TZ, new Date());

async function doctorClient(opts: Parameters<typeof createApprovedDoctor>[1] = {}) {
  const d = await createApprovedDoctor(h.db, opts);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  return { d, c };
}

async function patientClient() {
  const p = await createPatient(h.db);
  const c = new Client(h.baseUrl);
  await login(c, p.phone, p.password);
  return { p, c };
}

/** Free times offered on the clinic booking page. */
const slotValues = (body: string) => [...body.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]!);

async function pastAppointment(doctor: { id: string; clinicId: string }, patientId: string, daysAgo: number, status: string, fee = 400) {
  const start = new Date(Date.now() - daysAgo * 86400_000 - 3600_000);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, status)
     values ($1, $2, $3, $4, $5, 'new', $6, $7)`,
    [doctor.id, doctor.clinicId, patientId, start, new Date(start.getTime() + 1800_000), fee, status],
  );
}

test('clinic settings: follow-up price must not exceed the fee, and shows on the profile', async () => {
  const { d, c } = await doctorClient();
  await c.get('/en/dashboard/clinics');
  const district = (await h.db.query<{ district_id: number }>('select district_id from clinics where id = $1', [d.clinicId])).rows[0]!.district_id;
  const form = { name: 'Test Clinic', district: String(district), address: 'Test street 1', fee: '400', phone: '', active: 'yes' };
  const bad = await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, followUpFee: '500', followUpDays: '14' });
  assert.equal(bad.status, 422);
  assert.match(bad.body, /cannot be more than the consultation fee/);
  const badDays = await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, followUpFee: '200', followUpDays: '0' });
  assert.match(badDays.body, /between 1 and 90/);
  const good = await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, followUpFee: '٢٠٠', followUpDays: '10' });
  assert.equal(good.status, 303);
  const row = (await h.db.query<{ follow_up_fee_egp: number; follow_up_days: number }>('select follow_up_fee_egp, follow_up_days from clinics where id = $1', [d.clinicId])).rows[0]!;
  assert.deepEqual(row, { follow_up_fee_egp: 200, follow_up_days: 10 }, 'Arabic digits are accepted');
  const profile = await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`);
  assert.match(profile.body, /Follow-up within 10 days/);
  // Empty = same price as a new visit.
  await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, followUpFee: '', followUpDays: '' });
  const reset = (await h.db.query<{ follow_up_fee_egp: number | null; follow_up_days: number }>('select follow_up_fee_egp, follow_up_days from clinics where id = $1', [d.clinicId])).rows[0]!;
  assert.deepEqual(reset, { follow_up_fee_egp: null, follow_up_days: 14 });
});

test('online booking: the server decides new vs follow-up price; the patient cannot choose it', async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update clinics set follow_up_fee_egp = 150, follow_up_days = 14 where id = $1', [d.clinicId]);
  const { p, c } = await patientClient();

  // No earlier visit: full price, even if the form claims a follow-up.
  let slot = await firstSlotStart(c, d.slug);
  const confirm = await c.get(`/en/book?clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(confirm.body, /Consultation fee/);
  assert.ok(!confirm.body.includes('name="visitType"'), 'no visit-type choice for patients');
  await c.post('/en/book', { clinic: slot.clinic, start: slot.start, visitType: 'follow_up', reason: '' });
  let a = (await h.db.query<{ visit_type: string; fee_egp: number }>('select visit_type, fee_egp from appointments where patient_id = $1 order by created_at desc limit 1', [p.id])).rows[0]!;
  assert.deepEqual(a, { visit_type: 'new', fee_egp: 400 });

  // A finished visit 5 days ago: follow-up price, explained on the confirm page.
  await pastAppointment(d, p.id, 5, 'completed');
  slot = await firstSlotStart(c, d.slug, 6);
  const fu = await c.get(`/en/book?clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(fu.body, /Follow-up fee/);
  assert.match(fu.body, /last 14 days/);
  await c.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' });
  a = (await h.db.query<{ visit_type: string; fee_egp: number }>('select visit_type, fee_egp from appointments where patient_id = $1 order by created_at desc limit 1', [p.id])).rows[0]!;
  assert.deepEqual(a, { visit_type: 'follow_up', fee_egp: 150 });

  // A finished visit long ago, at another patient: no discount for this one.
  const other = await patientClient();
  await pastAppointment(d, other.p.id, 40, 'completed');
  const s3 = await firstSlotStart(other.c, d.slug, 8);
  assert.match((await other.c.get(`/en/book?clinic=${s3.clinic}&start=${encodeURIComponent(s3.start)}`)).body, /Consultation fee/);
});

test('phone / walk-in booking: clinic-only entry, shows on the day, runs through the visit, then a follow-up', async () => {
  const { d, c } = await doctorClient();
  await h.db.query('update clinics set follow_up_fee_egp = 200 where id = $1', [d.clinicId]);
  const day = addDays(today(), 1);
  const page = await c.get(`/en/dashboard/book?date=${day}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Add a booking/);
  const slots = slotValues(page.body);
  assert.ok(slots.length > 5);

  // Validation: name, mobile, and a time are required.
  const noTime = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, name: 'Amr', phone: '01012345678', visitType: 'new' });
  assert.equal(noTime.status, 422);
  assert.match(noTime.body, /Pick a time/);
  const badPhone = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, start: slots[0]!, name: 'Amr', phone: '123', visitType: 'new' });
  assert.equal(badPhone.status, 422);
  assert.match(badPhone.body, /valid Egyptian mobile/);

  const ok = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, start: slots[0]!, name: 'Amr Walk-in', phone: '0101 234 5678', visitType: 'new', reason: 'Back pain' });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, `/en/dashboard?date=${day}&ok=clinicBooked`);
  const row = (await h.db.query<{ id: string; patient_id: string | null; walk_in_name: string; walk_in_phone: string; booked_by: string; fee_egp: number; visit_type: string }>(
    'select id, patient_id, walk_in_name, walk_in_phone, booked_by, fee_egp, visit_type from appointments where doctor_id = $1', [d.id],
  )).rows[0]!;
  assert.equal(row.patient_id, null);
  assert.equal(row.walk_in_phone, '+201012345678');
  assert.equal(row.booked_by, 'doctor');
  assert.deepEqual([row.visit_type, row.fee_egp], ['new', 400]);

  const dayView = await c.get(ok.location!);
  assert.match(dayView.body, /Amr Walk-in/);
  assert.match(dayView.body, /Booked by clinic/);
  assert.match(dayView.body, /Booking added to your schedule/);

  // The same time cannot be booked twice, and patients see it as taken too.
  const again = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, start: slots[0]!, name: 'Someone Else', phone: '01098765432', visitType: 'new' });
  assert.equal(again.status, 409);
  assert.ok(!slotValues((await c.get(`/en/dashboard/book?date=${day}`)).body).includes(slots[0]!));

  // Run the visit: arrived → in consultation → completed (walk-ins have no account).
  await h.db.query(`update appointments set starts_at = now() - interval '20 minutes', ends_at = now() + interval '10 minutes' where id = $1`, [row.id]);
  for (const to of ['arrived', 'in_consultation', 'completed']) {
    const res = await c.post(`/en/dashboard/appointments/${row.id}/status`, { to, date: today() });
    assert.ok(!res.location!.includes('error'), `${to}: ${res.location}`);
  }
  const done = await c.get('/en/dashboard');
  assert.match(done.body, /Book follow-up/);
  assert.match(done.body, /Collected/);

  // Follow-up from the finished visit: same person, follow-up price, the doctor picks the day.
  const fuPage = await c.get(`/en/dashboard/book?from=${row.id}&date=${addDays(today(), 7)}`);
  assert.match(fuPage.body, /Follow-up for Amr Walk-in/);
  assert.ok(!fuPage.body.includes('name="phone"'), 'name and phone come from the earlier visit');
  const fuSlot = slotValues(fuPage.body)[2]!;
  const fu = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: addDays(today(), 7), from: row.id, start: fuSlot, visitType: 'new' });
  assert.equal(fu.status, 303);
  const fuRow = (await h.db.query<{ walk_in_name: string; visit_type: string; fee_egp: number }>(
    `select walk_in_name, visit_type, fee_egp from appointments where doctor_id = $1 and starts_at = $2`, [d.id, new Date(fuSlot)],
  )).rows[0]!;
  assert.deepEqual(fuRow, { walk_in_name: 'Amr Walk-in', visit_type: 'follow_up', fee_egp: 200 });

  // Recorded in the audit log.
  const log = await h.db.query<{ n: number }>(`select count(*)::int as n from audit_log where action = 'appointment.book_by_clinic' and actor_user_id = $1`, [d.id]);
  assert.equal(log.rows[0]!.n, 2);
});

test('a follow-up for a patient with an account shows in their appointments and confirms by text', async () => {
  const { d, c } = await doctorClient();
  const { p, c: pc } = await patientClient();
  await pastAppointment(d, p.id, 0, 'completed');
  const source = (await h.db.query<{ id: string }>('select id from appointments where patient_id = $1', [p.id])).rows[0]!.id;
  const date = addDays(today(), 10);
  const start = slotValues((await c.get(`/en/dashboard/book?from=${source}&date=${date}`)).body)[0]!;
  assert.equal((await c.post('/en/dashboard/book', { clinic: d.clinicId, date, from: source, start })).status, 303);
  const mine = await pc.get('/en/appointments');
  assert.match(mine.body, /Follow-up/);
  const sms = await h.db.query<{ n: number }>('select count(*)::int as n from notification_outbox where to_phone = $1', [p.phone]);
  assert.ok(sms.rows[0]!.n >= 1);
});

test('clinic booking is scoped to the doctor and their own clinics', async () => {
  const { d: d1 } = await doctorClient();
  const { c: c2 } = await doctorClient();
  const { p } = await patientClient();
  await pastAppointment(d1, p.id, 1, 'completed');
  const foreign = (await h.db.query<{ id: string }>('select id from appointments where doctor_id = $1', [d1.id])).rows[0]!.id;
  assert.equal((await c2.get(`/en/dashboard/book?from=${foreign}`)).status, 404, "another doctor's visit is not found");
  await c2.get('/en/dashboard');
  const r = await c2.post('/en/dashboard/book', { clinic: d1.clinicId, date: today(), start: new Date().toISOString(), name: 'X Y', phone: '01012345678' });
  assert.equal(r.status, 404, "another doctor's clinic is not found");
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  assert.equal((await pc.get('/en/dashboard/book')).status, 403);
  // A made-up time is refused even for the right clinic.
  const { d: d3, c: c3 } = await doctorClient();
  await c3.get('/en/dashboard/book');
  const odd = new Date(Date.now() + 2 * 86400_000);
  odd.setUTCMinutes(7, 0, 0);
  const res = await c3.post('/en/dashboard/book', { clinic: d3.clinicId, date: addDays(today(), 2), start: odd.toISOString(), name: 'Odd Time', phone: '01012345678' });
  assert.equal(res.status, 409);
  // Dates far ahead are brought back to the allowed range.
  assert.match((await c3.get(`/en/dashboard/book?date=${addDays(today(), 400)}`)).body, new RegExp(`value="${addDays(today(), 90)}"`));
});

test('no-show protection: 3 no-shows pause online booking; the clinic can still book; an admin can lift it', async () => {
  const { d, c } = await doctorClient();
  const { p, c: pc } = await patientClient();
  for (const n of [10, 20, 30]) await pastAppointment(d, p.id, n, 'no_show');

  const slot = await firstSlotStart(pc, d.slug);
  const res = await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' });
  assert.equal(res.status, 409);
  assert.match(res.body, /Online booking is paused/);

  // The doctor sees the history next to the name and can still book them by phone (as a follow-up from a visit).
  await pastAppointment(d, p.id, 0, 'completed');
  const day = (await c.get('/en/dashboard')).body;
  assert.match(day, /3 no-show\(s\)/);
  const src = (await h.db.query<{ id: string }>(`select id from appointments where patient_id = $1 and status = 'completed'`, [p.id])).rows[0]!.id;
  const date = addDays(today(), 3);
  const start = slotValues((await c.get(`/en/dashboard/book?from=${src}&date=${date}`)).body)[0]!;
  assert.equal((await c.post('/en/dashboard/book', { clinic: d.clinicId, date, from: src, start })).status, 303);

  // Admin lifts the pause; older no-shows stop counting.
  const admin = await createAdmin(h.db);
  const ac = new Client(h.baseUrl);
  await login(ac, admin.phone, admin.password);
  const found = await ac.get(`/en/admin/accounts?q=0${p.phone.slice(3)}`);
  assert.match(found.body, /online booking is paused/);
  assert.match((await ac.post(`/en/admin/accounts/${p.id}/clear-no-shows`, {})).location!, /ok=noShowsCleared/);
  const slot2 = await firstSlotStart(pc, d.slug);
  const ok = await pc.post('/en/book', { clinic: slot2.clinic, start: slot2.start, reason: '' });
  assert.equal(ok.status, 303);
  assert.equal((await ac.post(`/en/admin/accounts/${d.id}/clear-no-shows`, {})).status, 404, 'only patients');
});

test('a walk-in booking can open a patient file when records are on', async () => {
  const { d, c } = await doctorClient();
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const date = addDays(today(), 1);
  const start = slotValues((await c.get(`/en/dashboard/book?date=${date}`)).body)[0]!;
  await c.post('/en/dashboard/book', { clinic: d.clinicId, date, start, name: 'Mona File', phone: '01112345678', visitType: 'new' });
  const id = (await h.db.query<{ id: string }>('select id from appointments where doctor_id = $1', [d.id])).rows[0]!.id;
  const file = await c.get(`/en/dashboard/appointments/${id}/file`);
  assert.ok(file.status === 200 || file.status === 303, `status ${file.status}`);
  if (file.status === 200) assert.match(file.body, /Mona File/);
});
