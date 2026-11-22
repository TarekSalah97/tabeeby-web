import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';
import { addDays, todayIn } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function doctor() {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard');
  return { d, c };
}

test('one click turns patient messages on and off; days and hours are kept', async () => {
  const { d, c } = await doctor();
  await h.db.query("update doctors set messaging_enabled = false, messaging_days = '{0,1,2}', messaging_start = '10:00', messaging_end = '14:00' where user_id = $1", [d.id]);
  const page = await c.get('/en/dashboard/messages');
  assert.match(page.body, /Patient messages are OFF/);
  assert.match(page.body, /role="switch" aria-checked="false"/);
  const on = await c.post('/en/dashboard/messages/toggle', { enabled: 'yes' });
  assert.match(on.location!, /ok=messagingOn/);
  const row = (await h.db.query<{ messaging_enabled: boolean; messaging_days: number[]; messaging_start: string }>(
    'select messaging_enabled, messaging_days, messaging_start::text from doctors where user_id = $1', [d.id])).rows[0]!;
  assert.equal(row.messaging_enabled, true);
  assert.deepEqual(row.messaging_days.map(Number), [0, 1, 2]);
  assert.equal(row.messaging_start, '10:00:00');
  assert.match((await c.get('/en/dashboard/messages')).body, /Patient messages are ON/);
  await c.post('/en/dashboard/messages/toggle', { enabled: 'no' });
  assert.equal((await h.db.query<{ e: boolean }>('select messaging_enabled as e from doctors where user_id = $1', [d.id])).rows[0]!.e, false);
  // Saving hours does not switch it back on.
  await c.post('/en/dashboard/messages/settings', { enabled: 'no', days: ['1'], start: '09:00', end: '12:00' });
  assert.equal((await h.db.query<{ e: boolean }>('select messaging_enabled as e from doctors where user_id = $1', [d.id])).rows[0]!.e, false);
  // A patient cannot flip a doctor's switch.
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  await pc.get('/en');
  assert.notEqual((await pc.post('/en/dashboard/messages/toggle', { enabled: 'yes' })).status, 303);
});

test('the booking calendar: big month grid of links, closed days greyed, month navigation within range', async () => {
  const { d, c } = await doctor();
  const today = todayIn('Africa/Cairo', new Date());
  // Close the clinic on Fridays (if it opens then) so a greyed day appears.
  await h.db.query('delete from schedule_rules where clinic_id = $1 and weekday = 5', [d.clinicId]);
  const page = await c.get('/en/dashboard/book');
  assert.match(page.body, /class="cal"/);
  assert.doesNotMatch(page.body, /type="date"/, 'no small native date box');
  assert.match(page.body, new RegExp(`href="/en/dashboard/book\\?clinic=${d.clinicId}&amp;date=${addDays(today, 1)}#cbook-times"`));
  assert.match(page.body, /aria-current="date"/);
  assert.match(page.body, /is-closed/, 'the test clinic is closed on some weekdays');
  // Next month is reachable; a month far outside the bookable range falls back to the chosen day.
  const next = /href="([^"]+month=\d{4}-\d{2}[^"]*)" aria-label="Next month"/.exec(page.body)![1]!.replace(/&amp;/g, '&');
  assert.equal((await c.get(next)).status, 200);
  const far = await c.get('/en/dashboard/book?month=2099-01');
  assert.doesNotMatch(far.body, /January 2099/);
  const ar = await c.get('/dashboard/book');
  assert.match(ar.body, /سبت/);
});

test('insights: sex and age split from the doctor\'s own files, visit types and no-shows; nothing from other doctors', async () => {
  const { d, c } = await doctor();
  const add = async (name: string, sex: string | null, dob: string | null) => {
    const { rows } = await h.db.query<{ id: string }>(
      'insert into patient_records (doctor_id, full_name, sex, date_of_birth, consent_at) values ($1, $2, $3, $4, now()) returning id', [d.id, name, sex, dob]);
    await h.db.query("insert into encounters (record_id, doctor_id, visit_at, chief_complaint) values ($1, $2, now() - interval '3 days', 'x')", [rows[0]!.id, d.id]);
  };
  await add('Amal', 'female', '1990-01-01');
  await add('Basma', 'female', '2015-06-01');
  await add('Camelia', 'female', null);
  await add('Daoud', 'male', '1950-01-01');
  await add('Eman', null, null);
  // Another doctor's patients never count.
  const other = await doctor();
  await h.db.query("insert into patient_records (doctor_id, full_name, sex, consent_at) values ($1, 'Zaki', 'male', now())", [other.d.id]);
  const p = await createPatient(h.db);
  const past = new Date(Date.now() - 5 * 86400_000);
  past.setUTCMinutes(0, 0, 0);
  for (const [i, status, type] of [[0, 'completed', 'new'], [1, 'completed', 'follow_up'], [2, 'no_show', 'new']] as const) {
    const s = new Date(past.getTime() + i * 3600_000);
    await h.db.query(
      `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, status) values ($1, $2, $3, $4, $5, $6, 300, $7)`,
      [d.id, d.clinicId, p.id, s, new Date(s.getTime() + 1800_000), type, status]);
  }
  const page = await c.get('/en/dashboard/insights');
  assert.equal(page.status, 200);
  assert.match(page.body, /Most of your patients are women \(75%\)/);
  assert.match(page.body, /Women<\/span><span class="muted">3 · 75%/);
  assert.match(page.body, /Men<\/span><span class="muted">1 · 25%/);
  assert.match(page.body, /1 patient files have no sex recorded/);
  assert.match(page.body, /0-12 years<\/span><span class="muted">1/);
  assert.match(page.body, /65\+ years<\/span><span class="muted">1/);
  assert.match(page.body, /<strong>33%<\/strong><span class="muted small">did not come/);
  assert.doesNotMatch(page.body, /style="/, 'no inline styles (blocked by the security policy)');
  assert.match((await c.get('/en/dashboard')).body, /href="\/en\/dashboard\/insights"/);
  assert.match((await c.get('/dashboard/insights?period=all')).body, /أغلب مرضاك سيدات/);
  // Patients cannot open it.
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  assert.notEqual((await pc.get('/en/dashboard/insights')).status, 200);
});
