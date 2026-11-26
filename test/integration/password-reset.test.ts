import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createAdmin, createPatient, login, type Harness } from '../helpers.js';
import { deliverPending } from '../../src/services/outbox.js';

let h: Harness;
let off: Harness;
before(async () => {
  [h, off] = await Promise.all([startHarness(), startHarness({ SMS_PROVIDER: 'none', EMAIL_PROVIDER: 'none' })]);
});
after(async () => {
  await Promise.all([h.close(), off.close()]);
});

const local = (phone: string) => '0' + phone.slice(3);
const NEW_PASSWORD = 'Sunset-over-Stanley-bridge-7';

async function lastResetCode(phone: string): Promise<string> {
  await deliverPending(h.db, h.sms, 50, h.email);
  const m = [...h.sms.sent].reverse().find((x) => x.to === phone && /reset your password|تغيير كلمة السر/.test(x.body));
  if (!m) throw new Error('no reset SMS');
  return /(\d{6})/.exec(m.body)![1]!;
}

test('sign-in page links to "forgot password"', async () => {
  assert.match((await new Client(h.baseUrl).get('/en/login')).body, /href="\/en\/forgot-password"/);
});

test('a code by SMS resets the password, signs out other devices and the old password stops working', async () => {
  const p = await createPatient(h.db);
  const other = new Client(h.baseUrl);
  await login(other, p.phone, p.password);
  assert.equal((await other.get('/en/appointments')).status, 200);

  const c = new Client(h.baseUrl);
  await c.get('/en/forgot-password');
  const sent = await c.post('/en/forgot-password', { identifier: local(p.phone) });
  assert.equal(sent.status, 303);
  const page = sent.location!;
  assert.match(page, /^\/en\/forgot-password\/[0-9a-f-]{36}$/);
  const code = await lastResetCode(p.phone);

  const wrong = await c.post(page, { code: code === '000000' ? '111111' : '000000', password: NEW_PASSWORD });
  assert.equal(wrong.status, 422);
  assert.match(wrong.body, /That code isn&#39;t right/);
  const weak = await c.post(page, { code, password: 'short' });
  assert.equal(weak.status, 422);
  const ok = await c.post(page, { code, password: NEW_PASSWORD });
  assert.equal(ok.status, 303, ok.body.slice(0, 300));
  assert.match(ok.location!, /ok=passwordReset/);

  // The other device was signed out; old password no longer works; new one does.
  const sessions = await h.db.query<{ n: number }>('select count(*)::int as n from sessions where user_id = $1', [p.id]);
  assert.equal(sessions.rows[0]!.n, 1); // only the device that just reset
  assert.match((await other.get('/en/appointments')).body, /data-testid="patient-gate"|gate-icon/);
  assert.equal((await login(new Client(h.baseUrl), p.phone, p.password)).status, 401);
  assert.equal((await login(new Client(h.baseUrl), p.phone, NEW_PASSWORD)).status, 303);
  // The code can't be used twice.
  assert.equal((await c.post(page, { code, password: NEW_PASSWORD + 'x' })).status, 422);
  await deliverPending(h.db, h.sms, 50, h.email);
  assert.ok(h.sms.sent.some((m) => m.to === p.phone && /password was just changed|كلمة السر بتاعتك اتغيرت/.test(m.body)));
});

test('unknown numbers look the same, admins are never reset this way, and guessing is limited', async () => {
  const c = new Client(h.baseUrl);
  await c.get('/en/forgot-password');
  const unknown = await c.post('/en/forgot-password', { identifier: '01099999991' });
  assert.equal(unknown.status, 303);
  assert.match(unknown.location!, /^\/en\/forgot-password\/[0-9a-f-]{36}$/);
  assert.equal((await c.post(unknown.location!, { code: '123456', password: NEW_PASSWORD })).status, 422);

  const admin = await createAdmin(h.db);
  const before = h.sms.sent.length;
  await c.post('/en/forgot-password', { identifier: local(admin.phone) });
  await deliverPending(h.db, h.sms, 50, h.email);
  assert.ok(!h.sms.sent.slice(before).some((m) => m.to === admin.phone));

  const p = await createPatient(h.db);
  const page = (await c.post('/en/forgot-password', { identifier: local(p.phone) })).location!;
  for (let i = 0; i < 5; i++) await c.post(page, { code: '000001', password: NEW_PASSWORD });
  const code = await lastResetCode(p.phone);
  const blocked = await c.post(page, { code, password: NEW_PASSWORD });
  assert.equal(blocked.status, 422);
  assert.match(blocked.body, /Too many wrong tries|expired/);

  assert.equal((await c.post('/en/forgot-password', { identifier: 'not a phone' })).status, 422);
});

test('without SMS or email: the page says to contact us, and the admin can create a one-time link', async () => {
  const visitor = new Client(off.baseUrl);
  const page = await visitor.get('/en/forgot-password');
  assert.match(page.body, /data-testid="reset-contact"/);
  assert.doesNotMatch(page.body, /name="identifier"/);

  const p = await createPatient(off.db);
  const admin = await createAdmin(off.db);
  const ac = new Client(off.baseUrl);
  await login(ac, admin.phone, admin.password);
  const accounts = await ac.get(`/en/admin/accounts?q=${local(p.phone)}`);
  assert.match(accounts.body, new RegExp(`/en/admin/accounts/${p.id}/reset-link`));
  assert.doesNotMatch(accounts.body, new RegExp(`/en/admin/accounts/${admin.id}/reset-link`));
  const made = await ac.post(`/en/admin/accounts/${p.id}/reset-link`, { q: local(p.phone) });
  assert.equal(made.status, 200);
  const url = /value="http:\/\/127\.0\.0\.1(?::\d+)?(\/reset-password\/[0-9a-f-]{36}\/[A-Za-z0-9_-]+)"/.exec(made.body)![1]!;

  // Not for admins, and patients can't make links.
  assert.match((await ac.post(`/en/admin/accounts/${admin.id}/reset-link`, {})).location ?? '', /reset\.notForAdmins/);
  const pc = new Client(off.baseUrl);
  await login(pc, p.phone, p.password);
  assert.notEqual((await pc.post(`/en/admin/accounts/${p.id}/reset-link`, {})).status, 200);

  // A tampered secret does nothing; the real link works once.
  const u = new Client(off.baseUrl);
  const tampered = url.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
  await u.get(tampered);
  assert.equal((await u.post(tampered, { password: NEW_PASSWORD })).status, 422);
  const form = await u.get(url);
  assert.equal(form.status, 200);
  assert.doesNotMatch(form.body, /name="code"/);
  const done = await u.post(url, { password: NEW_PASSWORD });
  assert.equal(done.status, 303, done.body.slice(0, 300));
  assert.equal((await login(new Client(off.baseUrl), p.phone, NEW_PASSWORD)).status, 303);
  assert.equal((await new Client(off.baseUrl).get(url)).status, 410);
});
