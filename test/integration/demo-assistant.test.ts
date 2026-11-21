import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, login, type Harness } from '../helpers.js';

// The fictional "Tabeeby AI" helper exists only on the demo site.
let live: Harness;
let demo: Harness;
before(async () => {
  [live, demo] = await Promise.all([startHarness(), startHarness({ DEMO_MODE: 'true' })]);
});
after(async () => {
  await Promise.all([live.close(), demo.close()]);
});

async function doctorWithFile(h: Harness) {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard/patients/new');
  const res = await c.post('/en/dashboard/patients', { fullName: 'Mona Adel', dateOfBirth: '1960-05-20', sex: 'female', allergies: 'Penicillin', habits: ['smoking'], consent: 'yes' });
  assert.equal(res.status, 303);
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [d.id])).rows[0]!.id;
  return { d, c, recordId };
}

test('live site: no assistant panel and the endpoint does not exist', async () => {
  const { c, recordId } = await doctorWithFile(live);
  const page = await c.get(`/en/dashboard/patients/${recordId}/visits/new`);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, /data-ai-assist|Tabeeby AI/);
  const r = await c.post('/en/dashboard/ai-assist', { record: recordId, complaint: 'Chest tightness on stairs' });
  assert.equal(r.status, 404);
});

test('demo: suggestions from the notes, cautions from the file, only for the doctor\'s own patients', async () => {
  const { c, recordId } = await doctorWithFile(demo);
  const page = await c.get(`/en/dashboard/patients/${recordId}/visits/new`);
  assert.match(page.body, /data-ai-assist/);
  assert.match(page.body, /Fictional · demo only/);

  const r = await c.post('/en/dashboard/ai-assist', { record: recordId, complaint: 'Chest tightness on climbing stairs', history: 'Relieved by rest', examination: '' });
  assert.equal(r.status, 200);
  const data = JSON.parse(r.body) as { matched: boolean; suggestions: { condition: string; likelihood: string }[]; tests: string[]; cautions: string[] };
  assert.equal(data.matched, true);
  assert.equal(data.suggestions[0]!.condition, 'Stable angina');
  assert.ok(data.tests.includes('ECG'));
  assert.ok(data.cautions.some((x) => /Penicillin/.test(x)));
  assert.ok(data.cautions.some((x) => /Smoker/.test(x)));
  assert.ok(data.cautions.some((x) => /Older adult/.test(x)));

  // Nothing about the notes is stored.
  const stored = await demo.db.query(`select 1 from audit_log where metadata::text like '%Chest tightness%'`);
  assert.equal(stored.rows.length, 0);

  // Another doctor cannot use someone else's patient file.
  const other = await createApprovedDoctor(demo.db);
  await demo.db.query('update doctors set records_enabled = true where user_id = $1', [other.id]);
  const oc = new Client(demo.baseUrl);
  await login(oc, other.phone, other.password);
  await oc.get('/en/dashboard/patients');
  assert.equal((await oc.post('/en/dashboard/ai-assist', { record: recordId, complaint: 'Chest pain' })).status, 404);

  // Patients cannot call it.
  assert.equal((await new Client(demo.baseUrl).post('/en/dashboard/ai-assist', { record: recordId })).status === 200, false);
});
