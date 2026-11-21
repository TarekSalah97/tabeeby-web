import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, firstSlotStart, lastEmailCode, testPhone, type Harness } from '../helpers.js';
import { deliverPending } from '../../src/services/outbox.js';
import { toZoned } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

let n = 0;
const uniqueEmail = () => `guest${process.pid}x${++n}@example.com`;

async function startGuest(c: Client, doctor: { slug: string }, fields: { phone?: string; email?: string; fullName?: string } = {}) {
  const slot = await firstSlotStart(c, doctor.slug);
  const page = await c.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.equal(page.status, 200);
  const phone = fields.phone ?? testPhone();
  const email = fields.email ?? uniqueEmail();
  const res = await c.post('/en/book/guest', {
    clinic: slot.clinic,
    start: slot.start,
    fullName: fields.fullName ?? 'Salma Guest',
    phone: '0' + phone.slice(3),
    email,
    visitType: 'new',
    reason: '',
    consent: 'yes',
  });
  return { slot, phone, email, res, page };
}

test('patient-only pages show a sign-in page to visitors, and point staff to their dashboard', async () => {
  const anon = new Client(h.baseUrl);
  const rx = await anon.get('/en/health-record');
  assert.equal(rx.status, 200);
  assert.match(rx.body, /Sign in to see your prescriptions &amp; tests/);
  assert.match(rx.body, /href="\/en\/login\?next=%2Fhealth-record"/);
  assert.match(rx.body, /Create a patient account/);
  const home = await anon.get('/en');
  assert.match(home.body, /What would you like to do\?/);
  assert.match(home.body, /href="\/en\/health-record"/);

  const doctor = await createApprovedDoctor(h.db);
  const d = new Client(h.baseUrl);
  await login(d, doctor.phone, doctor.password);
  const staff = await d.get('/en/health-record');
  assert.match(staff.body, /This page is for patient accounts/);
  assert.match(staff.body, /href="\/en\/dashboard"/);
});

/** Like the live site: no SMS provider, so the emailed code is the only check. */
async function withoutSms(fn: () => Promise<void>) {
  const { NoSmsProvider } = await import('../../src/services/sms.js');
  const original = { provider: h.deps.cfg.SMS_PROVIDER, sms: h.deps.sms };
  h.deps.cfg.SMS_PROVIDER = 'none';
  h.deps.sms = new NoSmsProvider() as unknown as typeof h.deps.sms;
  try {
    await fn();
  } finally {
    h.deps.cfg.SMS_PROVIDER = original.provider;
    h.deps.sms = original.sms;
  }
}

test('with SMS switched on, the new account also verifies its mobile before the booking is made', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const c = new Client(h.baseUrl);
  const { res, email } = await startGuest(c, doctor);
  const ok = await c.post(res.location!, { code: await lastEmailCode(h, email) });
  assert.match(ok.location!, /^\/en\/verify-phone\?next=%2Fen%2Fbook/);
});

test('a visitor books with an emailed code: account created, signed in, visit on both sides, email shown to the doctor', () => withoutSms(async () => {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Guest Friendly' });
  const c = new Client(h.baseUrl);
  const { slot, phone, email, res, page } = await startGuest(c, doctor);
  assert.match(page.body, /Book with your email/);
  assert.equal(res.status, 303);
  const codeUrl = res.location!;
  assert.match(codeUrl, /^\/en\/book\/guest\/[0-9a-f-]{36}$/);

  // Nothing exists until the code is confirmed.
  assert.equal((await h.db.query('select 1 from users where phone_e164 = $1', [phone])).rows.length, 0);
  const codePage = await c.get(codeUrl);
  assert.match(codePage.body, /Check your email/);
  assert.match(codePage.body, /g•••@example\.com/, 'the address is masked');

  const code = await lastEmailCode(h, email);
  const wrong = await c.post(codeUrl, { code: code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.status, 422);
  const ok = await c.post(codeUrl, { code });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/en/appointments?ok=bookedGuest');

  const user = await h.db.query<{ id: string; email: string; has_password: boolean; email_verified_at: Date | null; role: string }>(
    'select id, email, has_password, email_verified_at, role from users where phone_e164 = $1',
    [phone],
  );
  assert.equal(user.rows[0]!.role, 'patient');
  assert.equal(user.rows[0]!.email, email);
  assert.equal(user.rows[0]!.has_password, false);
  assert.ok(user.rows[0]!.email_verified_at);
  const appt = await h.db.query<{ starts_at: Date }>('select starts_at from appointments where patient_id = $1 and doctor_id = $2', [user.rows[0]!.id, doctor.id]);
  assert.equal(appt.rows[0]!.starts_at.toISOString(), new Date(slot.start).toISOString());

  // My appointments shows it, with a nudge to set a password.
  const mine = await c.get('/en/appointments?ok=bookedGuest');
  assert.match(mine.body, /You’re booked and signed in/);
  assert.match(mine.body, /Dr\. Guest Friendly/);
  assert.match(mine.body, /Set a password to sign in faster/);

  // Confirmation email.
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(h.email.sent.some((m) => m.to === email && m.subject.includes('Booking confirmed with Dr. Guest Friendly')));

  // The doctor sees the visit with the patient's phone and email.
  const d = new Client(h.baseUrl);
  await login(d, doctor.phone, doctor.password);
  const day = toZoned(new Date(slot.start), h.deps.cfg.TIME_ZONE).date;
  const dash = await d.get(`/en/dashboard?date=${day}`);
  assert.match(dash.body, /Salma Guest/);
  assert.match(dash.body, new RegExp(email.replace(/[.]/g, '\\.')));

  // A code works once only.
  const replay = new Client(h.baseUrl);
  assert.equal((await replay.get(codeUrl)).status, 410, 'a used code page says it has expired');
  assert.equal((await replay.post(codeUrl, { code })).status, 410);

  // Set a password, then sign in with mobile + password, and with an emailed code.
  await c.get('/en/account/password');
  assert.equal((await c.post('/en/account/password', { password: 'olive-tree-garden' })).location, '/en/appointments?ok=passwordSet');
  const again = new Client(h.baseUrl);
  assert.equal((await login(again, phone, 'olive-tree-garden')).status, 303);
  assert.match((await again.get('/en/appointments')).body, /Dr\. Guest Friendly/);

  const viaCode = new Client(h.baseUrl);
  await viaCode.get('/en/login/email');
  const req = await viaCode.post('/en/login/email', { email: email.toUpperCase() });
  assert.match(req.location!, /^\/en\/login\/email\/[0-9a-f-]{36}$/);
  await viaCode.get(req.location!);
  const signedIn = await viaCode.post(req.location!, { code: await lastEmailCode(h, email) });
  assert.equal(signedIn.status, 303);
  assert.match((await viaCode.get('/en/appointments')).body, /Dr\. Guest Friendly/);
}));

test('a mobile or email that already has an account must sign in instead (no takeover by email code)', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const existing = await createPatient(h.db);
  const sentBefore = h.email.sent.length;
  const c = new Client(h.baseUrl);
  const byPhone = await startGuest(c, doctor, { phone: existing.phone });
  assert.equal(byPhone.res.status, 422);
  assert.match(byPhone.res.body, /already has a Tabeeby account/);

  const email = uniqueEmail();
  await h.db.query(`update users set email = $2 where id = $1`, [existing.id, email]);
  const byEmail = await startGuest(new Client(h.baseUrl), doctor, { email });
  assert.equal(byEmail.res.status, 422);
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.equal(h.email.sent.length, sentBefore, 'no code was sent');
});

test('wrong codes lock the code after 5 tries, and email sign-in does not reveal which emails exist', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const c = new Client(h.baseUrl);
  const { res, email } = await startGuest(c, doctor);
  const code = await lastEmailCode(h, email);
  const wrongCode = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await c.post(res.location!, { code: wrongCode });
  const locked = await c.post(res.location!, { code });
  assert.notEqual(locked.status, 303, 'the right code no longer works after 5 wrong tries');

  const unknown = new Client(h.baseUrl);
  await unknown.get('/en/login/email');
  const sentBefore = h.email.sent.length;
  const r1 = await unknown.post('/en/login/email', { email: 'nobody-here@example.com' });
  assert.match(r1.location!, /^\/en\/login\/email\/[0-9a-f-]{36}$/, 'same answer as for a real account');
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.equal(h.email.sent.length, sentBefore, 'nothing is emailed to unknown addresses');
  await unknown.get(r1.location!);
  assert.equal((await unknown.post(r1.location!, { code: '123456' })).status, 422);

  // Doctors cannot sign in by email code even with their email.
  const docEmail = uniqueEmail();
  await h.db.query(`update users set email = $2, email_verified_at = now() where id = $1`, [doctor.id, docEmail]);
  const dc = new Client(h.baseUrl);
  await dc.get('/en/login/email');
  await dc.post('/en/login/email', { email: docEmail });
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(!h.email.sent.some((m) => m.to === docEmail));
});

test('without an email service, visitors are asked to sign in to book and email sign-in is off', async () => {
  const { NoEmailProvider } = await import('../../src/services/email.js');
  const original = { provider: h.deps.cfg.EMAIL_PROVIDER, email: h.deps.email };
  h.deps.cfg.EMAIL_PROVIDER = 'none';
  h.deps.email = new NoEmailProvider();
  try {
    const doctor = await createApprovedDoctor(h.db);
    const c = new Client(h.baseUrl);
    const slot = await firstSlotStart(c, doctor.slug);
    const res = await c.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
    assert.equal(res.status, 303);
    assert.match(res.location!, /^\/en\/login\?next=/);
    assert.equal((await c.get('/en/login/email')).status, 404);
    assert.ok(!(await c.get('/en/login')).body.includes('/en/login/email'));
  } finally {
    h.deps.cfg.EMAIL_PROVIDER = original.provider;
    h.deps.email = original.email;
  }
});

test('the code is shown on screen only on the demo site (the demo sends no real email)', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const live = new Client(h.baseUrl);
  const { res, email } = await startGuest(live, doctor);
  const page = await live.get(res.location!);
  assert.doesNotMatch(page.body, /Your code is/);
  const original = h.deps.cfg.DEMO_MODE;
  h.deps.cfg.DEMO_MODE = true;
  try {
    const demo = await live.get(res.location!);
    const code = await lastEmailCode(h, email);
    assert.match(demo.body, new RegExp(`Your code is ${code}`));
  } finally {
    h.deps.cfg.DEMO_MODE = original;
  }
});
