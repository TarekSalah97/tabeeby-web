import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, testPhone, firstSlotStart, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function doctorWithSecretary(access: 'schedule' | 'files') {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Team Owner' });
  await h.db.query('update doctors set records_enabled = true, show_income = true where user_id = $1', [d.id]);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  await dc.get('/en/dashboard/team');
  const phone = testPhone();
  const res = await dc.post('/en/dashboard/team', { fullName: 'Mona Secretary', phone: '0' + phone.slice(3), access });
  assert.equal(res.status, 200, res.body.slice(0, 300));
  const link = /value="(http[^"]+\/team\/join\/([A-Za-z0-9_-]+))"/.exec(res.body)!;
  assert.ok(link, 'invite link shown once');
  assert.match(res.body, /wa\.me\/\?text=/);
  const sc = new Client(h.baseUrl);
  const path = new URL(link[1]!.replace(/&amp;/g, '&')).pathname;
  const join = await sc.get(path);
  assert.match(join.body, /Join Dr\. Team Owner’s clinic/);
  assert.equal((await sc.post(path, { password: 'short' })).status, 422);
  const ok = await sc.post(path, { password: 'Secretary-pass-2026' });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/en/dashboard');
  // The link works once.
  assert.equal((await new Client(h.baseUrl).get(path)).status, 410);
  const sid = (await h.db.query<{ id: string }>('select id from users where phone_e164 = $1', [phone])).rows[0]!.id;
  return { d, dc, sc, phone, sid };
}

test('secretary (schedule): sees the day, adds a walk-in, marks arrival and payment; nothing doctor-only', async () => {
  const { d, sc, sid } = await doctorWithSecretary('schedule');
  const day = await sc.get('/en/dashboard');
  assert.equal(day.status, 200);
  assert.match(day.body, /Secretary for Dr\. Team Owner/);
  assert.match(day.body, /Hello, Mona Secretary|Mona Secretary/);
  assert.doesNotMatch(day.body, /href="\/en\/dashboard\/(messages|income|insights|profile|team)"/);

  // A walk-in booking by the secretary.
  const book = await sc.get('/en/dashboard/book');
  assert.equal(book.status, 200);
  const slot = await firstSlotStart(new Client(h.baseUrl), d.slug);
  const date = new Date(slot.start).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  await sc.get(`/en/dashboard/book?date=${date}`);
  const made = await sc.post('/en/dashboard/book', { clinic: slot.clinic, start: slot.start, name: 'Walk In Person', phone: '01012340000', reason: 'Checkup', visitType: 'new' });
  assert.equal(made.status, 303, made.body.slice(0, 300));
  const appt = (await h.db.query<{ id: string }>('select id from appointments where doctor_id = $1 and walk_in_name = $2', [d.id, 'Walk In Person'])).rows[0]!;
  assert.ok(appt);
  // Recorded under the secretary's name, on behalf of the doctor.
  const log = (await h.db.query<{ actor_user_id: string; metadata: { onBehalfOf?: string } }>(
    "select actor_user_id, metadata from audit_log where entity_id = $1 order by created_at limit 1", [appt.id])).rows[0]!;
  assert.equal(log.actor_user_id, sid);
  assert.equal(log.metadata.onBehalfOf, d.id);

  // Doctor-only areas are refused.
  for (const p of ['/en/dashboard/patients', '/en/dashboard/messages', '/en/dashboard/income', '/en/dashboard/profile', '/en/dashboard/team', '/en/dashboard/insights', '/en/dashboard/hours']) {
    assert.equal((await sc.get(p)).status, 403, p);
  }
  assert.equal((await sc.post('/en/dashboard/day-off', { date })).status, 403);
});

test('secretary (files): creates and edits patient files, never sees visits; doctor can change access and remove', async () => {
  const { d, dc, sc, sid, phone } = await doctorWithSecretary('files');
  await sc.get('/en/dashboard/patients/new');
  const created = await sc.post('/en/dashboard/patients', { fullName: 'Old Patient', phone: '01099998888', allergies: 'Penicillin', consent: 'yes' });
  assert.equal(created.status, 303, created.body.slice(0, 300));
  const recordId = /patients\/([0-9a-f-]{36})/.exec(created.location!)![1]!;

  // The doctor writes a visit; the secretary can't see it.
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await dc.post(`/en/dashboard/patients/${recordId}/visits`, { complaint: 'Private complaint text', diagnosis: 'Secret diagnosis' });
  const visitId = /visits\/([0-9a-f-]{36})/.exec(v.location!)![1]!;
  const file = await sc.get(`/en/dashboard/patients/${recordId}`);
  assert.equal(file.status, 200);
  assert.match(file.body, /Penicillin/);
  assert.doesNotMatch(file.body, /Secret diagnosis|Private complaint text/);
  assert.match(file.body, /visible to the doctor only/);
  assert.equal((await sc.get(`/en/dashboard/visits/${visitId}`)).status, 403);
  assert.equal((await sc.post(`/en/dashboard/patients/${recordId}/visits`, { complaint: 'x' })).status, 403);

  // Another doctor's patients stay invisible.
  const other = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [other.id]);
  const oc = new Client(h.baseUrl);
  await login(oc, other.phone, other.password);
  await oc.get('/en/dashboard/patients/new');
  const otherRec = /patients\/([0-9a-f-]{36})/.exec((await oc.post('/en/dashboard/patients', { fullName: 'Not Yours', consent: 'yes' })).location!)![1]!;
  assert.equal((await sc.get(`/en/dashboard/patients/${otherRec}`)).status, 404);

  // The doctor narrows access: patient files close at once.
  await dc.get('/en/dashboard/team');
  assert.match((await dc.post(`/en/dashboard/team/${sid}/access`, { access: 'schedule' })).location!, /ok=teamUpdated/);
  assert.equal((await sc.get('/en/dashboard/patients')).status, 403);
  // Another doctor cannot manage this secretary.
  assert.equal((await oc.post(`/en/dashboard/team/${sid}/remove`, {})).status, 404);
  // Removing signs the secretary out for good; the number is free again.
  assert.match((await dc.post(`/en/dashboard/team/${sid}/remove`, {})).location!, /ok=teamRemoved/);
  const after = await sc.get('/en/dashboard');
  assert.notEqual(after.status, 200);
  assert.notEqual((await login(new Client(h.baseUrl), phone, 'Secretary-pass-2026')).location, '/en/dashboard');
  void d;
});

test('a secretary cannot be added with a number that already has an account, and patients cannot reach team pages', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  await dc.get('/en/dashboard/team');
  const res = await dc.post('/en/dashboard/team', { fullName: 'Taken Number', phone: '0' + p.phone.slice(3), access: 'schedule' });
  assert.equal(res.status, 422);
  assert.match(res.body, /already has a Tabeeby account/);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  assert.equal((await pc.get('/en/dashboard/team')).status, 403);
});

test('pages share well: canonical link, preview card, and search-engine data on doctor profiles', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Share Test' });
  const c = new Client(h.baseUrl);
  const home = await c.get('/en/');
  assert.match(home.body, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/en">/);
  assert.match(home.body, /<meta property="og:image" content="[^"]+\/static\/og\.jpg">/);
  assert.match(home.body, /twitter:card/);
  assert.equal((await c.get('/static/og.jpg')).status, 200);
  const profile = await c.get(`/en/doctors/${d.slug}`);
  const ld = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(profile.body);
  assert.ok(ld, 'structured data');
  const data = JSON.parse(ld[1]!);
  assert.equal(data['@type'], 'Physician');
  assert.equal(data.name, 'Dr. Share Test');
  assert.equal(data.medicalSpecialty, 'Cardiology');
  assert.equal(data.address.addressCountry, 'EG');
  // A name with </script> cannot break out of the data block.
  await h.db.query(`update users set full_name = 'Dr. </script><script>x' where id = $1`, [d.id]);
  const evil = await c.get(`/en/doctors/${d.slug}`);
  assert.doesNotMatch(evil.body, /<\/script><script>x/);
});
