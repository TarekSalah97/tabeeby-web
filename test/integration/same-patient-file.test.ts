import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, login, testPhone, type Harness } from '../helpers.js';
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
  await c.get('/en/dashboard/patients/new');
  return { d, c };
}
const local = (e164: string) => '0' + e164.slice(3);
const files = async (doctorId: string, phone: string) =>
  (await h.db.query<{ id: string; full_name: string; allergies: string | null; date_of_birth: string | null }>(
    'select id, full_name, allergies, date_of_birth::text from patient_records where doctor_id = $1 and phone_e164 = $2 order by created_at', [doctorId, phone])).rows;

test('walk-in with a known mobile and name: the existing file opens and gets the new details', async () => {
  const { d, c } = await doctor();
  const phone = testPhone();
  const first = await c.post('/en/dashboard/patients', { fullName: 'Tarek Tarahony', phone: local(phone), allergies: 'Penicillin', consent: 'yes' });
  assert.equal(first.status, 303);
  assert.match(first.location!, /ok=fileCreated/);
  const again = await c.post('/en/dashboard/patients', { fullName: 'tarek  tarahony', phone: local(phone), allergies: 'Aspirin', dateOfBirth: '1990-05-01', consent: 'yes' });
  assert.equal(again.status, 303);
  assert.match(again.location!, /ok=fileFoundByPhone/);
  const list = await files(d.id, phone);
  assert.equal(list.length, 1, 'no second file');
  assert.equal(list[0]!.allergies, 'Penicillin\nAspirin', 'new information added, old kept');
  assert.equal(list[0]!.date_of_birth, '1990-05-01');
  assert.match((await c.get(again.location!)).body, /already had a file with this mobile number/);
  // Repeating the same details changes nothing.
  await c.post('/en/dashboard/patients', { fullName: 'Tarek', phone: local(phone), allergies: 'penicillin', consent: 'yes' });
  assert.equal((await files(d.id, phone))[0]!.allergies, 'Penicillin\nAspirin');
});

test('same mobile, different name (a family phone): the doctor chooses, and can create a new file', async () => {
  const { d, c } = await doctor();
  const phone = testPhone();
  await c.post('/en/dashboard/patients', { fullName: 'Tarek Tarahony', phone: local(phone), consent: 'yes' });
  const ask = await c.post('/en/dashboard/patients', { fullName: 'Mona Tarahony', phone: local(phone), consent: 'yes' });
  assert.equal(ask.status, 422);
  assert.match(ask.body, /This mobile number already has a file/);
  assert.match(ask.body, /Tarek Tarahony/);
  assert.match(ask.body, /name="newPerson" value="yes"/);
  assert.equal((await files(d.id, phone)).length, 1);
  const made = await c.post('/en/dashboard/patients', { fullName: 'Mona Tarahony', phone: local(phone), consent: 'yes', newPerson: 'yes' });
  assert.equal(made.status, 303);
  assert.equal((await files(d.id, phone)).length, 2);
  // Another doctor's files never count.
  const other = await doctor();
  const own = await other.c.post('/en/dashboard/patients', { fullName: 'Tarek Tarahony', phone: local(phone), consent: 'yes' });
  assert.match(own.location!, /ok=fileCreated/);
});

test('a walk-in booking for a known patient opens their file and the visit goes into it', async () => {
  const { d, c } = await doctor();
  const phone = testPhone();
  await c.post('/en/dashboard/patients', { fullName: 'Tarek Tarahony', phone: local(phone), consent: 'yes' });
  const fileId = (await files(d.id, phone))[0]!.id;
  const day = addDays(todayIn('Africa/Cairo', new Date()), 1);
  const page = await c.get(`/en/dashboard/book?date=${day}`);
  const start = [...page.body.matchAll(/name="start" value="([^"]+)"/g)][0]![1]!;
  await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, start, name: 'tarek tarahony', phone: local(phone), visitType: 'new' });
  const appt = (await h.db.query<{ id: string }>('select id from appointments where doctor_id = $1 and walk_in_phone = $2', [d.id, phone])).rows[0]!.id;
  const open = await c.get(`/en/dashboard/appointments/${appt}/file`);
  assert.equal(open.status, 303);
  assert.match(open.location!, new RegExp(`/dashboard/patients/${fileId}/visits/new\\?appointment=${appt}&ok=fileFoundByPhone`));
  const v = await c.post(`/en/dashboard/patients/${fileId}/visits`, { appointment: appt, complaint: 'Back pain again' });
  assert.equal(v.status, 303);
  assert.equal((await h.db.query('select 1 from encounters where record_id = $1', [fileId])).rows.length, 1);
  assert.equal((await files(d.id, phone)).length, 1);
});
