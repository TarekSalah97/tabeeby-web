import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, type Harness } from '../helpers.js';
import { parseRange } from '../../src/services/adminConsole.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function adminClient() {
  const admin = await createAdmin(h.db);
  const c = new Client(h.baseUrl);
  await login(c, admin.phone, admin.password);
  return { c, admin };
}

test('the dashboard counts people and activity, and the date range narrows activity only', async () => {
  const { c } = await adminClient();
  const doctor = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db);
  // One booking created long ago, one today.
  const start = new Date(Date.now() + 2 * 86400_000);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, created_at)
     values ($1, $2, $3, $4, $5, 'new', 400, now() - interval '90 days')`,
    [doctor.id, doctor.clinicId, patient.id, start, new Date(start.getTime() + 1800_000)],
  );
  const all = await c.get('/en/admin');
  assert.equal(all.status, 200);
  for (const label of ['Active doctors', 'Pending applications', 'Registered patients', 'Bookings', 'Waitlist joins', 'Cancellations', 'No-shows', 'Quick actions']) {
    assert.match(all.body, new RegExp(label), label);
  }
  const counted = (body: string) => Number(/<strong>(\d+)<\/strong><span>Bookings<\/span>/.exec(body)![1]);
  const today = await c.get('/en/admin?range=today');
  assert.ok(counted(all.body) >= counted(today.body) + 1, 'a booking made 90 days ago is outside "today"');
  assert.match(today.body, /aria-current="true"[^>]*>Today|>Today<\/a>/);
  const custom = await c.get('/en/admin?from=2020-01-01&to=2020-01-31');
  assert.equal(counted(custom.body), 0);

  // Ranges: presets, custom (swapped if backwards), and junk ignored.
  const now = new Date('2026-03-15T10:00:00Z');
  assert.deepEqual(parseRange(new URLSearchParams('range=7d'), 'Africa/Cairo', now), { preset: '7d', from: '2026-03-09', to: '2026-03-15' });
  assert.deepEqual(parseRange(new URLSearchParams('from=2026-02-10&to=2026-02-01'), 'Africa/Cairo', now), { preset: 'custom', from: '2026-02-01', to: '2026-02-10' });
  assert.deepEqual(parseRange(new URLSearchParams('from=bad'), 'Africa/Cairo', now), { preset: 'all' });
});

test('every admin page is admin-only and shares the sidebar', async () => {
  const { c } = await adminClient();
  for (const path of ['/en/admin', '/en/admin/doctors', '/en/admin/accounts', '/en/admin/reviews', '/en/admin/audit', '/en/admin/messages']) {
    const res = await c.get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.body, /class="dash admin"/, path);
    assert.match(res.body, /href="\/en\/admin\/audit"/, path);
  }
  const patient = await createPatient(h.db);
  const p = new Client(h.baseUrl);
  await login(p, patient.phone, patient.password);
  for (const path of ['/en/admin/accounts?q=te', '/en/admin/audit', '/en/admin/messages']) assert.equal((await p.get(path)).status, 403, path);
  assert.equal((await new Client(h.baseUrl).get('/en/admin/audit')).status, 303, 'visitors are sent to sign in');
});

test('suspend an account: found by mobile, signed out at once, cannot sign in; reactivate restores it; admins are protected', async () => {
  const { c, admin } = await adminClient();
  const patient = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, patient.phone, patient.password);
  assert.equal((await pc.get('/en/appointments')).status, 200);

  const found = await c.get(`/en/admin/accounts?q=0${patient.phone.slice(3)}`);
  assert.match(found.body, new RegExp(`/en/admin/accounts/${patient.id}/suspend`));
  const noReason = await c.post(`/en/admin/accounts/${patient.id}/suspend`, { reason: '' });
  assert.match(noReason.location!, /error=admin\.noteRequired/);
  const ok = await c.post(`/en/admin/accounts/${patient.id}/suspend`, { reason: 'Fake bookings', q: '0' + patient.phone.slice(3) });
  assert.match(ok.location!, /ok=accountSuspended/);

  // Signed out on their next request, and cannot sign in again.
  const after = await pc.get('/en/appointments');
  assert.ok(!after.body.includes('My appointments</h1>'));
  assert.notEqual((await login(new Client(h.baseUrl), patient.phone, patient.password)).location, '/en/appointments');
  const u = await h.db.query<{ status: string }>('select status from users where id = $1', [patient.id]);
  assert.equal(u.rows[0]!.status, 'suspended');

  // Recorded in the audit log with the reason, and findable by who did it.
  const log = await c.get(`/en/admin/audit?action=account.&actor=${encodeURIComponent('0' + admin.phone.slice(3))}`);
  assert.match(log.body, /account\.suspend/);
  assert.match(log.body, /Fake bookings/);

  await c.get('/en/admin/accounts');
  assert.match((await c.post(`/en/admin/accounts/${patient.id}/reactivate`, {})).location!, /ok=accountReactivated/);
  assert.equal((await login(new Client(h.baseUrl), patient.phone, patient.password)).status, 303);

  const other = await createAdmin(h.db);
  const denied = await c.post(`/en/admin/accounts/${other.id}/suspend`, { reason: 'Nope nope' });
  assert.match(denied.location!, /error=adm\.cannotSuspendAdmin/);
  assert.equal((await c.post(`/en/admin/accounts/${patient.id}/delete`, {})).status, 404, 'only suspend/reactivate exist');
});

test('a suspended doctor disappears from search', async () => {
  const { c } = await adminClient();
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Hidden Soon' });
  assert.match((await c.get('/en/search?q=Hidden%20Soon')).body, /Dr\. Hidden Soon/);
  await c.get('/en/admin/accounts');
  await c.post(`/en/admin/accounts/${doctor.id}/suspend`, { reason: 'Licence check' });
  assert.ok(!(await new Client(h.baseUrl).get('/en/search?q=Hidden%20Soon')).body.includes('Dr. Hidden Soon'));
});

test('messages page: services, weekly counts, masked failed messages and retry', async () => {
  const { c } = await adminClient();
  await h.db.query(
    `insert into notification_outbox (channel, to_phone, body, status, attempts, last_error) values ('sms', '+201011112222', 'x', 'failed', 6, 'gateway 500')`,
  );
  const page = await c.get('/en/admin/messages');
  assert.match(page.body, /Connected services/);
  assert.match(page.body, /Booking rules/);
  assert.match(page.body, /\+2010•••22/, 'recipient is masked');
  assert.ok(!page.body.includes('+201011112222'));
  assert.match(page.body, /gateway 500/);
  const retry = await c.post('/en/admin/messages/retry', {});
  assert.equal(retry.location, '/en/admin/messages?ok=retried');
  const { rows } = await h.db.query<{ n: number }>(`select count(*)::int as n from notification_outbox where status = 'failed'`);
  assert.equal(rows[0]!.n, 0);
  assert.match((await c.get('/en/admin/audit?action=outbox.')).body, /outbox\.retry_failed/);
});
