import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';

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

async function walkInFile(c: Client, name: string): Promise<string> {
  const r = await c.post('/en/dashboard/patients', { fullName: name, consent: 'yes' });
  return /patients\/([0-9a-f-]{36})/.exec(r.location!)![1]!;
}

async function patientCode(pc: Client): Promise<string> {
  await pc.get('/en/health-record');
  const page = await pc.post('/en/health-record/link-code', {});
  assert.equal(page.status, 200);
  return /class="link-code-value" dir="ltr">([A-Z0-9]{3}-[A-Z0-9]{3})</.exec(page.body)![1]!;
}

test('a walk-in patient with an account links their file with a code; prescriptions then reach them', async () => {
  const { d, c } = await doctor();
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  const file = await walkInFile(c, 'Walk-in Ahmed');
  // A prescription written before linking is visible afterwards too.
  await c.get(`/en/dashboard/patients/${file}/visits/new`);
  await c.post(`/en/dashboard/patients/${file}/visits`, { complaint: 'Cough', rx_medicine: ['Augmentin 1g'], rx_form: ['tablet'], rx_dose: ['1'], rx_frequency: ['twice_daily'], rx_timing: [''], rx_duration: [''], rx_instructions: [''] });
  assert.doesNotMatch((await pc.get('/en/health-record')).body, /Augmentin/);

  const code = await patientCode(pc);
  assert.equal((await h.db.query('select 1 from account_link_codes where code_hash::text like $1', [`%${code}%`])).rows.length, 0, 'only a hash is stored');
  const page = await c.get(`/en/dashboard/patients/${file}`);
  assert.match(page.body, /Link to the patient&#39;s Tabeeby account|Link to the patient's Tabeeby account/);

  // Step 1 shows whose account it is, without linking (lower case and spaces are fine).
  const check = await c.post(`/en/dashboard/patients/${file}/link-code`, { code: ` ${code.toLowerCase().replace('-', ' ')} ` });
  assert.equal(check.status, 200);
  const name = (await h.db.query<{ full_name: string }>('select full_name from users where id = $1', [p.id])).rows[0]!.full_name;
  assert.ok(check.body.includes(name), 'the account name is shown for confirmation');
  assert.match(check.body, /Link this file to this account\?/);
  assert.doesNotMatch(check.body, new RegExp(p.phone.slice(3)), 'the phone is masked');
  assert.equal((await h.db.query<{ patient_user_id: string | null }>('select patient_user_id from patient_records where id = $1', [file])).rows[0]!.patient_user_id, null);

  // Step 2 links; the patient now sees the prescription (never the notes).
  const done = await c.post(`/en/dashboard/patients/${file}/link-code/confirm`, { code });
  assert.match(done.location!, /ok=fileLinkedByCode/);
  const hr = await pc.get('/en/health-record');
  assert.match(hr.body, /Augmentin/);
  assert.doesNotMatch(hr.body, /Cough/);
  // The code is used up.
  const { c: c2 } = await doctor();
  const other = await walkInFile(c2, 'Someone');
  assert.match((await c2.post(`/en/dashboard/patients/${other}/link-code`, { code })).body, /wrong or has expired/);
});

test('codes expire, only the newest works, wrong codes and other doctors\' files are refused, tries are limited', async () => {
  const { d, c } = await doctor();
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  const first = await patientCode(pc);
  const second = await patientCode(pc);
  const file = await walkInFile(c, 'Test Person');
  assert.match((await c.post(`/en/dashboard/patients/${file}/link-code`, { code: first })).body, /wrong or has expired/, 'older code stopped working');
  await h.db.query("update account_link_codes set expires_at = now() - interval '1 minute' where patient_id = $1", [p.id]);
  assert.equal((await c.post(`/en/dashboard/patients/${file}/link-code`, { code: second })).status, 422, 'expired');

  // Another doctor cannot use someone else's file id.
  const fresh = await patientCode(pc);
  const { c: stranger } = await doctor();
  assert.equal((await stranger.post(`/en/dashboard/patients/${file}/link-code`, { code: fresh })).status, 404);
  assert.equal((await stranger.post(`/en/dashboard/patients/${file}/link-code/confirm`, { code: fresh })).status, 404);

  // A patient already linked to another of this doctor's files is refused.
  await c.post(`/en/dashboard/patients/${file}/link-code/confirm`, { code: fresh });
  const second2 = await walkInFile(c, 'Duplicate Person');
  const again = await patientCode(pc);
  assert.match((await c.post(`/en/dashboard/patients/${second2}/link-code`, { code: again })).body, /already linked to another of your files/);

  // Guessing is limited per doctor.
  const { c: guesser } = await doctor();
  const target = await walkInFile(guesser, 'Guess Target');
  let last = '';
  for (let i = 0; i < 11; i++) last = (await guesser.post(`/en/dashboard/patients/${target}/link-code`, { code: 'AAA-AAA' })).body;
  assert.match(last, /Too many tries/);
  void d;
});

test('only patients can make codes; Arabic text renders', async () => {
  const { c } = await doctor();
  assert.notEqual((await c.post('/en/health-record/link-code', {})).status, 200);
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  await pc.get('/health-record');
  const ar = await pc.post('/health-record/link-code', {});
  assert.match(ar.body, /صالح حتى/);
});
