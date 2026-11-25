import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';
import { sendDueReminders } from '../../src/services/medReminders.js';
import { clearVapidCache } from '../../src/services/webPush.js';

let h: Harness;
before(async () => {
  h = await startHarness();
  clearVapidCache();
});
after(async () => {
  await h.close();
});

// 10:30 in Cairo on 1 Dec 2026 (winter time, UTC+2).
const MORNING = new Date('2026-12-01T08:30:00Z');

/** A visit for the patient with a prescription: twice daily for 7 days, as needed, weekly. */
async function prescribe(patientId: string) {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Rx Owner' });
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const start = new Date(Date.now() + 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const appt = (await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [d.id, d.clinicId, patientId, start, new Date(start.getTime() + 1800_000)])).rows[0]!.id;
  await dc.get(`/en/dashboard/appointments/${appt}/file`);
  await dc.post('/en/dashboard/patients', { fullName: 'Rx Patient', consent: 'yes', appointment: appt });
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [d.id])).rows[0]!.id;
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await dc.post(`/en/dashboard/patients/${recordId}/visits`, {
    complaint: 'Sore throat',
    rx_medicine: ['Augmentin 1g', 'Panadol 500mg', 'Vidrop'],
    rx_form: ['tablet', 'tablet', 'drops'],
    rx_dose: ['1 tablet', '1 tablet', '5 drops'],
    rx_frequency: ['twice_daily', 'as_needed', 'weekly'],
    rx_timing: ['after_meals', '', ''],
    rx_duration: ['7 days', '', ''],
    rx_instructions: ['', 'For fever', ''],
  });
  assert.equal(v.status, 303, v.body.slice(0, 300));
  const rxId = (await h.db.query<{ id: string }>('select p.id from prescriptions p join encounters e on e.id = p.encounter_id where e.record_id = $1', [recordId])).rows[0]!.id;
  return { d, dc, rxId };
}

function fakeSubscription() {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomBytes(8).toString('hex')}`, p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
}

test('medicine reminders: set up from a prescription, tick doses, phone notifications exactly once, calendar file', async () => {
  h.deps.now = () => MORNING;
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  const { rxId, dc } = await prescribe(p.id);

  // The health record links to it; the setup page suggests times from the doctor's instructions.
  assert.match((await pc.get('/en/health-record')).body, new RegExp(`/en/medicines/setup/${rxId}`));
  const setup = await pc.get(`/en/medicines/setup/${rxId}`);
  assert.equal(setup.status, 200);
  assert.match(setup.body, /name="times_1" value="09:00"/);
  assert.match(setup.body, /name="times_1" value="21:00"/);
  assert.match(setup.body, /name="days_1"[^>]*value="7"/);
  assert.match(setup.body, /Taken only when needed/);

  // Bad input is refused.
  assert.equal((await pc.post(`/en/medicines/setup/${rxId}`, { on_1: 'yes', times_1: ['xx'], days_1: '7' })).status, 422);
  assert.equal((await pc.post(`/en/medicines/setup/${rxId}`, { on_1: 'yes', times_1: ['09:00'], days_1: '0' })).status, 422);
  assert.equal((await pc.post(`/en/medicines/setup/${rxId}`, {})).status, 422);

  const saved = await pc.post(`/en/medicines/setup/${rxId}`, { on_1: 'yes', times_1: ['09:00', '21:00', ''], days_1: '7', on_3: 'yes', times_3: ['10:00'], weekday_3: '2', ongoing_3: 'yes' });
  assert.match(saved.location!, /ok=medSaved/);
  const rem = (await h.db.query<{ id: string; position: number; end_date: string | null }>('select id, position, end_date::text from medicine_reminders where patient_id = $1 order by position', [p.id])).rows;
  assert.deepEqual(rem.map((r) => [r.position, r.end_date]), [[1, '2026-12-07'], [3, null]]);

  // Today (Tuesday): Augmentin at 09:00 and 21:00, Vidrop (Tuesdays) at 10:00.
  let page = await pc.get('/en/medicines');
  assert.equal((page.body.match(/data-testid="dose"/g) ?? []).length, 3);
  assert.match(page.body, /0 of 3 taken/);
  const dose9 = new Date('2026-12-01T07:00:00Z').toISOString();
  assert.match((await pc.post('/en/medicines/doses', { reminder: rem[0]!.id, due: dose9, taken: 'yes' })).location!, /\/en\/medicines$/);
  assert.match((await pc.get('/en/medicines')).body, /1 of 3 taken/);
  // Not a real dose time; too early (21:00 is more than 2 hours away).
  assert.match((await pc.post('/en/medicines/doses', { reminder: rem[0]!.id, due: '2026-12-01T07:05:00Z', taken: 'yes' })).location!, /error=med.err.dose/);
  assert.match((await pc.post('/en/medicines/doses', { reminder: rem[0]!.id, due: '2026-12-01T19:00:00Z', taken: 'yes' })).location!, /error=med.err.tooEarly/);

  // Someone else cannot see or touch it.
  const other = await createPatient(h.db);
  const oc = new Client(h.baseUrl);
  await login(oc, other.phone, other.password);
  assert.equal((await oc.get(`/en/medicines/setup/${rxId}`)).status, 404);
  assert.equal((await oc.post('/en/medicines/doses', { reminder: rem[0]!.id, due: dose9, taken: 'no' })).status, 404);
  assert.equal((await oc.post(`/en/medicines/reminders/${rem[0]!.id}/stop`, {})).status, 404);
  assert.equal((await dc.post('/en/medicines/push/subscribe', fakeSubscription())).status, 403, 'doctors are not patients');
  assert.equal((await new Client(h.baseUrl).get('/en/medicines')).status, 200, 'sign-in page for visitors');

  // Phones: only real push services, real keys.
  assert.equal((await pc.post('/en/medicines/push/subscribe', { ...fakeSubscription(), endpoint: 'https://evil.example/hook' })).status, 422);
  assert.equal((await pc.post('/en/medicines/push/subscribe', { ...fakeSubscription(), p256dh: 'AAAA' })).status, 422);
  const phone = fakeSubscription();
  assert.equal((await pc.post('/en/medicines/push/subscribe', phone)).status, 200);
  page = await pc.get('/en/medicines');
  assert.match(page.body, /sent to 1 device/);
  assert.match(page.body, /data-key="[A-Za-z0-9_-]{80,}"/);

  // 21:00 Cairo: one notification, without the medicine name; never twice.
  h.push.sent = [];
  h.deps.now = () => new Date('2026-12-01T19:00:30Z');
  assert.equal(await sendDueReminders(h.deps), 1);
  assert.equal(await sendDueReminders(h.deps), 0);
  assert.equal(h.push.sent.length, 1);
  assert.equal(h.push.sent[0]!.endpoint, phone.endpoint);
  assert.doesNotMatch(h.push.sent[0]!.payload.body, /Augmentin/);
  assert.match(h.push.sent[0]!.payload.body, /1 medicine|دوا واحد/);
  assert.match(h.push.sent[0]!.payload.url, /\/medicines$/);

  // With names switched on, and a dose ticked early is not notified.
  await pc.post('/en/medicines/settings', { showNames: 'yes' });
  h.deps.now = () => new Date('2026-12-02T06:30:00Z');
  await pc.post('/en/medicines/doses', { reminder: rem[0]!.id, due: '2026-12-02T07:00:00Z', taken: 'yes' });
  h.deps.now = () => new Date('2026-12-02T07:00:10Z');
  assert.equal(await sendDueReminders(h.deps), 0, 'already taken');
  h.deps.now = () => new Date('2026-12-02T19:00:10Z');
  assert.equal(await sendDueReminders(h.deps), 1);
  assert.match(h.push.sent.at(-1)!.payload.body, /Augmentin 1g — 1 tablet/);

  // Missed by more than 15 minutes (server asleep): not sent late.
  h.deps.now = () => new Date('2026-12-03T07:30:00Z');
  assert.equal(await sendDueReminders(h.deps), 0);

  // Calendar file.
  const ics = await pc.get('/en/medicines/calendar.ics');
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type') ?? '', /text\/calendar/);
  assert.match(ics.body, /SUMMARY:Augmentin 1g — 1 tablet/);
  assert.match(ics.body, /RRULE:FREQ=WEEKLY;BYDAY=TU/);

  // A phone that unsubscribed is forgotten.
  h.push.next = 'gone';
  h.deps.now = () => new Date('2026-12-03T19:00:05Z');
  await sendDueReminders(h.deps);
  h.push.next = 'ok';
  assert.equal((await h.db.query('select 1 from push_subscriptions where user_id = $1', [p.id])).rows.length, 0);

  // Stopping, and a voided prescription, end the reminders.
  await pc.post('/en/medicines/push/subscribe', phone);
  assert.match((await pc.post(`/en/medicines/reminders/${rem[1]!.id}/stop`, {})).location!, /ok=medStopped/);
  await h.db.query(`update prescriptions set status = 'voided', voided_at = now(), void_reason = 'test' where id = $1`, [rxId]);
  h.deps.now = () => new Date('2026-12-04T07:00:05Z');
  assert.equal(await sendDueReminders(h.deps), 0);
  assert.match((await pc.get('/en/medicines')).body, /data-testid="no-reminders"/);
  h.deps.now = () => new Date();
});

test('the notification helper script is served from the site root and allowed to run', async () => {
  const c = new Client(h.baseUrl);
  const sw = await c.get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type') ?? '', /javascript/);
  assert.equal(sw.headers.get('service-worker-allowed'), '/');
  assert.match(sw.body, /showNotification/);
  assert.match((await c.get('/en')).headers.get('content-security-policy') ?? '', /worker-src 'self'/);
});
