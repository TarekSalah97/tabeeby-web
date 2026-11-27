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

test('a clinic can list several phone numbers; patients see a call button for each', async () => {
  const d = await createApprovedDoctor(h.db);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  const district = (await h.db.query<{ district_id: number }>('select district_id from clinics where id = $1', [d.clinicId])).rows[0]!.district_id;
  const form = { name: 'Test Clinic', district: String(district), address: 'Test street 1', fee: '400', followUpFee: '', followUpDays: '14', active: 'yes' };
  const eleven = Array.from({ length: 11 }, (_, i) => `0345678${String(10 + i)}`).join(' - ');
  const tooMany = await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, phone: eleven });
  assert.equal(tooMany.status, 422);
  assert.match(tooMany.body, /up to 10/);
  const ok = await c.post(`/en/dashboard/clinics/${d.clinicId}`, { ...form, phone: '034567890 - 01012345678 - 01112345678' });
  assert.equal(ok.status, 303, ok.body.slice(0, 300));
  const row = (await h.db.query<{ phone_e164: string; extra_phones: string[] }>('select phone_e164, extra_phones from clinics where id = $1', [d.clinicId])).rows[0]!;
  assert.deepEqual([row.phone_e164, ...row.extra_phones], ['+2034567890', '+201012345678', '+201112345678']);
  assert.match((await c.get('/en/dashboard/clinics')).body, /value="034567890 - 01012345678 - 01112345678"/);
  const page = (await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`)).body;
  for (const n of ['tel:+2034567890', 'tel:+201012345678', 'tel:+201112345678']) assert.ok(page.includes(n), n);
});

test("a patient file keeps the patient's mobile as the main number and other numbers beside it", async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  const created = await c.post('/en/dashboard/patients', { fullName: 'Laila Mostafa', phone: '034567890 - 01012345679 - 01212345678', consent: 'yes' });
  assert.equal(created.status, 303, created.body.slice(0, 400));
  const r = (await h.db.query<{ id: string; phone_e164: string; extra_phones: string[] }>("select id, phone_e164, extra_phones from patient_records where full_name = 'Laila Mostafa'")).rows[0]!;
  assert.equal(r.phone_e164, '+201012345679');
  assert.deepEqual(r.extra_phones, ['+2034567890', '+201212345678']);
  const file = (await c.get(`/en/dashboard/patients/${r.id}`)).body;
  assert.match(file, /010 1234 5679 · 03 4567890 · 012 1234 5678/);
});
