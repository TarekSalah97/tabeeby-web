import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, login, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

test('menu order: Schedule, Patients, Messages, Income, Profile; clinics and hours sit under Profile', async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  const nav = /<nav class="dash-nav"[\s\S]*?<\/ul>/.exec((await c.get('/en/dashboard')).body)![0];
  const order = ['/en/dashboard"', '/en/dashboard/patients"', '/en/dashboard/messages"', '/en/dashboard/income"', '/en/dashboard/profile"'].map((p) => nav.indexOf(p));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]!)), `order ${order.join(',')}`);
  assert.ok(!nav.includes('/en/dashboard/clinics"') && !nav.includes('/en/dashboard/hours"'), 'not in the side menu');
  for (const path of ['/en/dashboard/profile', '/en/dashboard/clinics', '/en/dashboard/hours']) {
    const body = (await c.get(path)).body;
    assert.match(body, /class="row-wrap sub-tabs"/, path);
    assert.match(/<nav class="dash-nav"[\s\S]*?<\/ul>/.exec(body)![0], /href="\/en\/dashboard\/profile" aria-current="page"/, `${path} highlights Profile`);
  }
});

test('the doctor can hide and show Income; hidden means no menu item, no payment buttons, page redirects', async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, fee_egp, status)
     values ($1, $2, 'Walk In', '+201077777777', 'doctor', now() - interval '40 minutes', now() - interval '10 minutes', 'new', 400, 'completed')`,
    [d.id, d.clinicId],
  );
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  assert.match((await c.get('/en/dashboard')).body, /Mark paid/);
  await c.get('/en/dashboard/profile');
  assert.equal((await c.post('/en/dashboard/settings/income', { show: 'no' })).location, '/en/dashboard/profile?ok=incomeOff');
  const day = (await c.get('/en/dashboard')).body;
  assert.ok(!day.includes('/en/dashboard/income"'));
  assert.ok(!day.includes('Mark paid'));
  assert.ok(!day.includes('Collected (paid)'));
  assert.equal((await c.get('/en/dashboard/income')).location, '/en/dashboard/profile?error=dash.incomeIsOff');
  assert.match((await c.get('/en/dashboard/profile')).body, /Show Income/);
  await c.post('/en/dashboard/settings/income', { show: 'yes' });
  assert.equal((await c.get('/en/dashboard/income')).status, 200);
});
