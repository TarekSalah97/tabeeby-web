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

test("an existing patient account joins a doctor's team as itself, switches between clinic and own account, and keeps its account when removed", async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Linked Owner' });
  const p = await createPatient(h.db);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  await dc.get('/en/dashboard/team');
  const added = await dc.post('/en/dashboard/team', { fullName: 'Any Name', phone: '0' + p.phone.slice(3), access: 'schedule' });
  assert.equal(added.status, 200, added.body.slice(0, 300));
  assert.match(added.body, /already has a Tabeeby account/);
  const path = new URL(/value="(http[^"]+\/team\/join\/[A-Za-z0-9_-]+)"/.exec(added.body)![1]!).pathname;
  // Adding the same person twice is refused.
  assert.match((await dc.post('/en/dashboard/team', { fullName: 'Again', phone: '0' + p.phone.slice(3), access: 'schedule' })).body, /already on your team/);

  // Before joining, the patient has no access to the clinic.
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  assert.equal((await pc.get('/en/dashboard')).status, 403);
  // They prove it's their account with their own password (a wrong one is refused).
  const anon = new Client(h.baseUrl);
  const page = await anon.get(path);
  assert.match(page.body, /Your Tabeeby password/);
  assert.equal((await anon.post(path, { password: 'not-the-password-1' })).status, 422);
  const joined = await anon.post(path, { password: p.password });
  assert.equal(joined.status, 303);
  assert.equal(joined.location, '/en/dashboard');
  assert.match((await anon.get('/en/dashboard')).body, /Dr\. Linked Owner|Linked Owner/);
  // Their account is still a patient account; no second account was made.
  const u = (await h.db.query<{ n: number; role: string }>("select count(*)::int as n, min(role) as role from users where phone_e164 = $1", [p.phone])).rows[0]!;
  assert.deepEqual([u.n, u.role], [1, 'patient']);

  // The already signed-in patient session works as a patient until it chooses the clinic.
  assert.equal((await pc.get('/en/appointments')).status, 200);
  const sw = await pc.get('/en/team/clinics');
  assert.match(sw.body, /Dr\. Dr\. Linked Owner|Linked Owner/);
  assert.equal((await pc.post('/en/team/clinics', { to: d.id })).location, '/en/dashboard');
  assert.equal((await pc.get('/en/dashboard')).status, 200);
  assert.equal((await pc.get('/en/dashboard/income')).status, 403, 'still a secretary, not the doctor');
  assert.equal((await pc.post('/en/team/clinics', { to: 'own' })).status, 303);
  assert.equal((await pc.get('/en/dashboard')).status, 403);
  // Can't pick a clinic it isn't on.
  const other = await createApprovedDoctor(h.db);
  assert.equal((await pc.post('/en/team/clinics', { to: other.id })).status, 403);

  // The doctor sees "Own account"; removing ends clinic access but keeps the patient account.
  assert.match((await dc.get('/en/dashboard/team')).body, /Own account/);
  await pc.post('/en/team/clinics', { to: d.id });
  assert.equal((await dc.post(`/en/dashboard/team/${p.id}/remove`, {})).status, 303);
  assert.equal((await pc.get('/en/dashboard')).status, 403);
  assert.equal((await pc.get('/en/appointments')).status, 200);
  assert.equal((await h.db.query<{ status: string }>('select status from users where id = $1', [p.id])).rows[0]!.status, 'active');
});

test("one secretary on two doctors' teams; doctor/admin numbers can't join; patients can't reach team pages", async () => {
  const { d, sc, phone, sid } = await doctorWithSecretary('schedule');
  const d2 = await createApprovedDoctor(h.db, { name: 'Dr. Second Clinic' });
  const dc2 = new Client(h.baseUrl);
  await login(dc2, d2.phone, d2.password);
  await dc2.get('/en/dashboard/team');
  const added = await dc2.post('/en/dashboard/team', { fullName: 'Mona', phone: '0' + phone.slice(3), access: 'files' });
  assert.equal(added.status, 200);
  const path = new URL(/value="(http[^"]+\/team\/join\/[A-Za-z0-9_-]+)"/.exec(added.body)![1]!).pathname;
  // Signed in as herself: just press Join.
  assert.doesNotMatch((await sc.get(path)).body, /name="password"/);
  assert.equal((await sc.post(path, {})).location, '/en/dashboard');
  assert.match((await sc.get('/en/dashboard')).body, /Second Clinic/);
  assert.equal((await sc.post('/en/team/clinics', { to: d.id })).location, '/en/dashboard');
  assert.match((await sc.get('/en/dashboard')).body, /Team Owner/);
  // Removed by the second doctor: still works for the first.
  await dc2.post(`/en/dashboard/team/${sid}/remove`, {});
  assert.equal((await h.db.query<{ status: string }>('select status from users where id = $1', [sid])).rows[0]!.status, 'active');
  assert.equal((await sc.get('/en/dashboard')).status, 200);

  // A doctor's number can't join a team.
  const res = await dc2.post('/en/dashboard/team', { fullName: 'Another Doctor', phone: '0' + d.phone.slice(3), access: 'schedule' });
  assert.equal(res.status, 422);
  assert.match(res.body, /belongs to a doctor, pharmacy, lab or admin account/);
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  assert.equal((await pc.get('/en/dashboard/team')).status, 403);
  assert.notEqual((await pc.get('/en/team/clinics')).status, 200);
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
