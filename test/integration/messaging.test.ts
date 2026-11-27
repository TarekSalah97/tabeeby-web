import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const ALL_DAYS = ['0', '1', '2', '3', '4', '5', '6'];

async function signedIn(person: { phone: string; password: string }) {
  const c = new Client(h.baseUrl);
  await login(c, person.phone, person.password);
  return c;
}

async function booking(doctor: { id: string; clinicId: string }, patientId: string, daysFromNow: number, status = 'confirmed') {
  const start = new Date(Date.now() + daysFromNow * 86400_000);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, status) values ($1, $2, $3, $4, $5, 'new', 400, $6)`,
    [doctor.id, doctor.clinicId, patientId, start, new Date(start.getTime() + 1800_000), status],
  );
}

async function setup(opts: { open?: boolean } = {}) {
  const d = await createApprovedDoctor(h.db);
  const dc = await signedIn(d);
  await dc.get('/en/dashboard/messages');
  const todayWeekday = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' })).getDay();
  const days = opts.open === false ? ALL_DAYS.filter((x) => Number(x) !== todayWeekday) : ALL_DAYS;
  const saved = await dc.post('/en/dashboard/messages/settings', { enabled: 'yes', days, start: '00:00', end: '23:59' });
  assert.equal(saved.status, 303);
  const p = await createPatient(h.db);
  const pc = await signedIn(p);
  return { d, dc, p, pc };
}

test('a patient who booked writes during the hours; the doctor sees it, replies, and the patient is told', async () => {
  const { d, dc, p, pc } = await setup();
  await booking(d, p.id, 2);

  const profile = await pc.get(`/en/doctors/${d.slug}`);
  assert.match(profile.body, /Message the doctor/);
  const thread = await pc.get(`/en/messages/${d.slug}`);
  assert.match(thread.body, /Messages with Dr\. Test Doctor/);
  assert.match(thread.body, /emergency call 123/);

  const sent = await pc.post(`/en/messages/${d.slug}`, { body: 'Can I take my pills before the visit?\n<b>thanks</b>' });
  assert.equal(sent.location, `/en/messages/${d.slug}?ok=sent`);
  // The doctor is alerted by text, without the content (health data).
  const alert = await h.db.query<{ body: string }>('select body from notification_outbox where to_phone = $1 order by id desc limit 1', [d.phone]);
  assert.match(alert.rows[0]!.body, /new message from a patient/);
  assert.ok(!alert.rows[0]!.body.includes('pills'));
  // A second message before the doctor reads it does not send another alert.
  await pc.get(`/en/messages/${d.slug}`);
  await pc.post(`/en/messages/${d.slug}`, { body: 'Also, should I fast?' });
  const alerts = await h.db.query<{ n: number }>('select count(*)::int as n from notification_outbox where to_phone = $1', [d.phone]);
  assert.equal(alerts.rows[0]!.n, 1);

  // Doctor: unread badge, inbox, thread (escaped), reply.
  const inbox = await dc.get('/en/dashboard/messages');
  assert.match(inbox.body, /count-badge inline[^>]*>1</);
  assert.match(inbox.body, /Test Patient/);
  const convId = (await h.db.query<{ id: string }>('select id from conversations where doctor_id = $1', [d.id])).rows[0]!.id;
  const dThread = await dc.get(`/en/dashboard/messages/${convId}`);
  assert.match(dThread.body, /Can I take my pills/);
  assert.match(dThread.body, /&lt;b&gt;thanks&lt;\/b&gt;/, 'message text is escaped');
  assert.ok(!(await dc.get('/en/dashboard/messages')).body.includes('count-badge inline'), 'read after opening');
  assert.equal((await dc.post(`/en/dashboard/messages/${convId}`, { body: 'Yes, take them as usual.' })).status, 303);

  // Patient: badge on the tab bar, inbox shows "New", reply visible.
  const home = await pc.get('/en/');
  assert.match(home.body, /tab-badge[^>]*>1</);
  assert.match((await pc.get('/en/messages')).body, />New</);
  assert.match((await pc.get(`/en/messages/${d.slug}`)).body, /take them as usual/);
  assert.ok(!(await pc.get('/en/')).body.includes('tab-badge'));
  const sms = await h.db.query<{ body: string }>('select body from notification_outbox where to_phone = $1 order by id desc limit 1', [p.phone]);
  assert.match(sms.rows[0]!.body, /replied to your message/);
});

test('patients who never booked (or only cancelled) cannot write; other people cannot read', async () => {
  const { d, p, pc } = await setup();
  assert.ok(!(await pc.get(`/en/doctors/${d.slug}`)).body.includes('Message the doctor'));
  const res = await pc.post(`/en/messages/${d.slug}`, { body: 'Hello' });
  assert.equal(res.status, 422);
  assert.match(res.body, /after you book a visit/);
  await booking(d, p.id, 3, 'cancelled');
  assert.match((await pc.post(`/en/messages/${d.slug}`, { body: 'Hello' })).body, /after you book a visit/);
  // A visit 200 days ago is too old.
  await booking(d, p.id, -200, 'completed');
  assert.match((await pc.post(`/en/messages/${d.slug}`, { body: 'Hello' })).body, /after you book a visit/);

  // A real conversation, then outsiders try to read it.
  await booking(d, p.id, -10, 'completed');
  assert.equal((await pc.post(`/en/messages/${d.slug}`, { body: 'Private question' })).status, 303);
  const convId = (await h.db.query<{ id: string }>('select id from conversations where doctor_id = $1', [d.id])).rows[0]!.id;
  const other = await createApprovedDoctor(h.db);
  const oc = await signedIn(other);
  assert.equal((await oc.get(`/en/dashboard/messages/${convId}`)).status, 404);
  await oc.get('/en/dashboard/messages');
  assert.equal((await oc.post(`/en/dashboard/messages/${convId}`, { body: 'x' })).status, 404);
  const admin = await createAdmin(h.db);
  const ac = await signedIn(admin);
  assert.equal((await ac.get(`/en/dashboard/messages/${convId}`)).status, 403, 'admins cannot read messages');
  const stranger = await createPatient(h.db);
  const sc = await signedIn(stranger);
  assert.ok(!(await sc.get(`/en/messages/${d.slug}`)).body.includes('Private question'));
  // Signed out: the sign-in page, no content.
  const anon = await new Client(h.baseUrl).get('/en/messages');
  assert.match(anon.body, /Sign in to message your doctors/);
});

test('outside the hours the patient sees when to write; empty and too-long messages are refused', async () => {
  const { d, p, pc } = await setup({ open: false });
  await booking(d, p.id, 1);
  const profile = await pc.get(`/en/doctors/${d.slug}`);
  assert.match(profile.body, /closed now/);
  const page = await pc.get(`/en/messages/${d.slug}`);
  assert.match(page.body, /Messages are closed right now/);
  assert.match(page.body, /<textarea[^>]*disabled/);
  assert.match((await pc.post(`/en/messages/${d.slug}`, { body: 'Hi' })).body, /closed right now/);

  const open = await setup();
  await booking(open.d, open.p.id, 1);
  assert.match((await open.pc.post(`/en/messages/${open.d.slug}`, { body: '   ' })).body, /Write a message first/);
  const long = await open.pc.post(`/en/messages/${open.d.slug}`, { body: 'x'.repeat(1001) });
  assert.match(long.body, /under 1,000 characters/);
  assert.match(long.body, /xxxxxxxx/, 'the text is kept so nothing is lost');
});

test('messaging off by default; settings validation; blocking a patient', async () => {
  const d = await createApprovedDoctor(h.db);
  const dc = await signedIn(d);
  const p = await createPatient(h.db);
  await booking(d, p.id, 1);
  const pc = await signedIn(p);
  assert.equal((await pc.get(`/en/messages/${d.slug}`)).status, 404, 'off and no earlier conversation');
  assert.match((await dc.get('/en/dashboard/messages')).body, /Messaging is off/);

  const noDays = await dc.post('/en/dashboard/messages/settings', { enabled: 'yes', start: '10:00', end: '12:00' });
  assert.equal(noDays.status, 422);
  assert.match(noDays.body, /at least one day/);
  assert.equal((await dc.post('/en/dashboard/messages/settings', { enabled: 'yes', days: ALL_DAYS, start: '09:00:00', end: '17:30:00.000' })).status, 303, 'times with seconds are accepted');
  const backwards = await dc.post('/en/dashboard/messages/settings', { enabled: 'yes', days: ALL_DAYS, start: '18:00', end: '09:00' });
  assert.match(backwards.body, /must be after the start/);
  assert.equal((await dc.post('/en/dashboard/messages/settings', { enabled: 'yes', days: ['9', ...ALL_DAYS], start: '00:00', end: '23:59' })).status, 303);

  assert.equal((await pc.post(`/en/messages/${d.slug}`, { body: 'First' })).status, 303);
  const convId = (await h.db.query<{ id: string }>('select id from conversations where doctor_id = $1', [d.id])).rows[0]!.id;
  await dc.get(`/en/dashboard/messages/${convId}`);
  assert.match((await dc.post(`/en/dashboard/messages/${convId}/block`, {})).location!, /ok=msgBlocked/);
  const blocked = await pc.post(`/en/messages/${d.slug}`, { body: 'Again' });
  assert.match(blocked.body, /not accepting messages from you/);
  assert.equal((await h.db.query<{ n: number }>('select count(*)::int as n from messages where conversation_id = $1', [convId])).rows[0]!.n, 1, 'the blocked message was not saved');
  await dc.post(`/en/dashboard/messages/${convId}/unblock`, {});
  assert.equal((await pc.post(`/en/messages/${d.slug}`, { body: 'Again' })).status, 303);

  // Turning messaging off keeps the old conversation readable but closed.
  await dc.post('/en/dashboard/messages/settings', { days: ALL_DAYS, start: '00:00', end: '23:59' });
  const after = await pc.get(`/en/messages/${d.slug}`);
  assert.equal(after.status, 200);
  assert.match(after.body, /not taking messages/);
});
