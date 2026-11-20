import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, lastOtp, firstSlotStart, testPhone, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

test('patient signs up, verifies phone by SMS code, books, sees and cancels the appointment', async () => {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Flow Cardio' });
  const c = new Client(h.baseUrl);
  const phone = testPhone();

  await c.get('/en/signup');
  const signup = await c.post('/en/signup', { fullName: 'Layla Patient', phone: '0' + phone.slice(3), password: 'green-tea-garden', consent: 'yes' });
  assert.equal(signup.status, 303);
  assert.match(signup.location!, /^\/en\/verify-phone/);

  await c.get('/en/verify-phone');
  const wrong = await c.post('/en/verify-phone', { code: '000000' });
  assert.equal(wrong.status, 422);
  const ok = await c.post('/en/verify-phone', { code: await lastOtp(h, phone) });
  assert.equal(ok.status, 303);

  // Search finds the doctor by condition keyword mapped to cardiology.
  const search = await c.get('/en/search?q=palpitations');
  assert.match(search.body, /Dr\. Flow Cardio/);

  const slot = await firstSlotStart(c, doctor.slug);
  const confirm = await c.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.equal(confirm.status, 200);
  assert.match(confirm.body, /Confirm your booking/);

  const booked = await c.post('/en/book', { clinic: slot.clinic, start: slot.start, visitType: 'new', reason: 'Chest flutter' });
  assert.equal(booked.status, 303);
  assert.equal(booked.location, '/en/appointments?ok=booked');

  const list = await c.get('/en/appointments?ok=booked');
  assert.match(list.body, /You’re booked/);
  assert.match(list.body, /Dr\. Flow Cardio/);

  const { rows } = await h.db.query<{ id: string; reason: string; fee_egp: number }>('select id, reason, fee_egp from appointments where doctor_id = $1', [doctor.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.reason, 'Chest flutter');
  assert.equal(rows[0]!.fee_egp, 400, 'fee copied from the clinic, not trusted from the client');

  // Confirmation SMS queued in the same transaction.
  await lastOtp(h, phone).catch(() => undefined);
  assert.ok(h.sms.sent.some((m) => m.to === phone && m.body.includes('booked with Dr. Flow Cardio')));

  // The same slot is no longer offered.
  const again = await c.get(`/en/doctors/${doctor.slug}`);
  assert.ok(!again.body.includes(encodeURIComponent(slot.start)));

  const cancel = await c.post(`/en/appointments/${rows[0]!.id}/cancel`, {});
  assert.equal(cancel.location, '/en/appointments?ok=cancelled');
  const after = await h.db.query<{ status: string; cancelled_by: string }>('select status, cancelled_by from appointments where id = $1', [rows[0]!.id]);
  assert.deepEqual(after.rows[0], { status: 'cancelled', cancelled_by: 'patient' });
});

test('booking a time that is not a real slot is refused', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db);
  const c = new Client(h.baseUrl);
  await login(c, patient.phone, patient.password);
  await c.get('/en/appointments');
  const odd = new Date(Date.now() + 26 * 3600_000);
  odd.setUTCMinutes(7, 0, 0); // never on a 30-minute boundary
  const res = await c.post('/en/book', { clinic: doctor.clinicId, start: odd.toISOString(), visitType: 'new' });
  assert.equal(res.status, 303);
  assert.match(res.location!, /error=booking\.slotUnavailable/);
  const { rows } = await h.db.query('select 1 from appointments where doctor_id = $1', [doctor.id]);
  assert.equal(rows.length, 0);
});

test('unverified patients are sent to verify before booking', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db, false);
  const c = new Client(h.baseUrl);
  const res = await login(c, patient.phone, patient.password);
  assert.match(res.location!, /verify-phone/);
  const slot = await firstSlotStart(c, doctor.slug);
  const book = await c.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.equal(book.status, 303);
  assert.match(book.location!, /^\/en\/verify-phone\?next=/);
});

test('anonymous visitors see a sign-in page that brings them back afterwards', async () => {
  const c = new Client(h.baseUrl);
  const res = await c.get('/en/appointments');
  assert.equal(res.status, 200);
  assert.match(res.body, /href="\/en\/login\?next=%2Fappointments"/);
  assert.match(res.body, /href="\/en\/signup\?next=%2Fappointments"/);
});

test('wrong password and unknown phone give the same answer', async () => {
  const patient = await createPatient(h.db);
  const a = await login(new Client(h.baseUrl), patient.phone, 'not-the-password');
  const b = await login(new Client(h.baseUrl), testPhone(), 'not-the-password');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.match(a.body, /mobile number or password is not correct/);
  assert.match(b.body, /mobile number or password is not correct/);
});

test('Arabic is the default and English lives under /en', async () => {
  const c = new Client(h.baseUrl);
  const ar = await c.get('/');
  assert.match(ar.body, /<html lang="ar" dir="rtl">/);
  const en = await c.get('/en');
  assert.match(en.body, /<html lang="en" dir="ltr">/);
});

test('reminders are queued once, 24h and 2h before, and not for cancelled visits', async () => {
  const { queueReminders } = await import('../../src/jobs/worker.js');
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Reminder' });
  const patient = await createPatient(h.db);
  const insert = async (hoursAhead: number, status = 'confirmed') => {
    const start = new Date(Date.now() + hoursAhead * 3600_000);
    start.setUTCSeconds(0, 0);
    await h.db.query(
      `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, status, created_at)
       values ($1, $2, $3, $4, $5, 'new', 400, $6, now() - interval '3 days')`,
      [doctor.id, doctor.clinicId, patient.id, start, new Date(start.getTime() + 30 * 60000), status],
    );
  };
  await insert(20); // inside 24h window
  await insert(1.5); // inside 2h window (also inside 24h)
  await insert(5, 'cancelled');
  await insert(60); // too far ahead
  const before = (await h.db.query<{ n: number }>('select count(*)::int as n from notification_outbox where to_phone = $1', [patient.phone])).rows[0]!.n;
  await queueReminders(h.deps);
  await queueReminders(h.deps); // second run must not duplicate
  const rows = (await h.db.query<{ body: string }>('select body from notification_outbox where to_phone = $1 order by id', [patient.phone])).rows.slice(before);
  // 20h → 24h reminder; 1.5h → 24h reminder + 2h reminder.
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.body.includes('Dr. Reminder')).length, 3);
});

test('demo mode: banner, hidden from search engines, code shown on the verify page', async () => {
  h.deps.cfg.DEMO_MODE = true;
  try {
    const c = new Client(h.baseUrl);
    const home = await c.get('/en');
    assert.match(home.body, /Demo site — all doctors are fictional/);
    assert.match(home.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.equal((await c.get('/robots.txt')).body, 'User-agent: *\nDisallow: /\n');
    assert.match((await c.get('/en/login')).body, /Demo accounts/);
    const phone = testPhone();
    await c.get('/en/signup');
    await c.post('/en/signup', { fullName: 'Demo Tester', phone: '0' + phone.slice(3), password: 'green-tea-garden', consent: 'yes' });
    const page = await c.get('/en/verify-phone');
    const shown = /your code is (\d{6})/.exec(page.body)?.[1];
    assert.ok(shown);
    assert.equal((await c.post('/en/verify-phone', { code: shown! })).status, 303);
  } finally {
    h.deps.cfg.DEMO_MODE = false;
  }
  assert.ok(!(await new Client(h.baseUrl).get('/en')).body.includes('Demo site'));
});

test('without an SMS provider: sign-up goes straight in, booking works, messages are skipped', async () => {
  const { NoSmsProvider } = await import('../../src/services/sms.js');
  const { deliverPending } = await import('../../src/services/outbox.js');
  const original = { provider: h.deps.cfg.SMS_PROVIDER, sms: h.deps.sms };
  h.deps.cfg.SMS_PROVIDER = 'none';
  h.deps.sms = new NoSmsProvider() as unknown as typeof h.deps.sms;
  try {
    const doctor = await createApprovedDoctor(h.db, { name: 'Dr. No SMS' });
    const c = new Client(h.baseUrl);
    const phone = testPhone();
    await c.get('/en/signup');
    const res = await c.post('/en/signup', { fullName: 'Nada NoSms', phone: '0' + phone.slice(3), password: 'green-tea-garden', consent: 'yes' });
    assert.equal(res.location, '/en');
    const slot = await firstSlotStart(c, doctor.slug);
    assert.equal((await c.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`)).status, 200);
    const booked = await c.post('/en/book', { clinic: slot.clinic, start: slot.start, visitType: 'new' });
    assert.equal(booked.location, '/en/appointments?ok=bookedNoSms');
    await deliverPending(h.db, h.deps.sms);
    const { rows } = await h.db.query<{ status: string }>('select distinct status from notification_outbox where to_phone = $1', [phone]);
    assert.deepEqual(rows.map((r) => r.status), ['skipped']);
  } finally {
    h.deps.cfg.SMS_PROVIDER = original.provider;
    h.deps.sms = original.sms;
  }
});

test('database file storage round-trips binary files', async () => {
  const { DbFileStorage } = await import('../../src/storage/files.js');
  const store = new DbFileStorage(h.db);
  const data = Buffer.concat([Buffer.from('%PDF-1.4 '), Buffer.from([0, 1, 2, 255, 92, 120])]);
  const key = await store.put(data, 'pdf');
  assert.deepEqual(await store.get(key), data);
  await store.remove(key);
  await assert.rejects(store.get(key));
});
