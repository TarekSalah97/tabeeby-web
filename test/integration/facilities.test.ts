import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createAdmin, createApprovedDoctor, createPatient, login, testPhone, type Harness } from '../helpers.js';
import { hashPassword } from '../../src/auth/password.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const PDF = () => new Blob([Buffer.from('%PDF-1.4 licence')], { type: 'application/pdf' });

function joinForm(phone: string, extra: Record<string, string> = {}, file: Blob | null = PDF()) {
  const f = new FormData();
  const fields: Record<string, string> = {
    kind: 'pharmacy', name: 'Nile Pharmacy', licenceNumber: 'MOH-12345', contactName: 'Sara Ahmed',
    phone: '0' + phone.slice(3), email: `p${crypto.randomBytes(3).toString('hex')}@example.com`, password: 'Nile-pharmacy-pass-2026', consent: 'yes', ...extra,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (file) {
    f.append('licence', file, 'licence.pdf');
    f.append('doc_manager_syndicate_card', PDF(), 'card.pdf');
    f.append('doc_manager_national_id', PDF(), 'id.pdf');
  }
  return f;
}

/** An approved place with one branch, created directly. */
async function createFacility(kind: 'pharmacy' | 'lab' | 'radiology', name: string, o: { district?: string; homeService?: boolean; open24h?: boolean; prices?: Record<string, number> } = {}) {
  const phone = testPhone();
  const { rows } = await h.db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('facility', 'Owner', $1, $2, now()) returning id`,
    [phone, await hashPassword('facility-password-1')],
  );
  const id = rows[0]!.id;
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  await h.db.query(
    `insert into facilities (user_id, kind, slug, name, licence_number, home_service, verification_status, verified_at) values ($1, $2, $3, $4, 'LIC-1', $5, 'approved', now())`,
    [id, kind, slug, name, !!o.homeService],
  );
  await h.db.query(
    `insert into facility_branches (facility_id, name, district_id, address, open_24h, opens, closes)
     select $1, 'Main branch', id, '12 Fouad Street', $3, case when $3 then '00:00'::time else '03:00'::time end, case when $3 then '23:59'::time else '03:01'::time end from districts where slug = $2`,
    [id, o.district ?? 'smouha', o.open24h ?? true],
  );
  for (const [code, price] of Object.entries(o.prices ?? {})) {
    await h.db.query('insert into facility_tests (facility_id, test_code, price_egp) values ($1, $2, $3)', [id, code, price]);
  }
  return { id, slug, phone, password: 'facility-password-1' };
}

async function signedIn(person: { phone: string; password: string }) {
  const c = new Client(h.baseUrl);
  await login(c, person.phone, person.password);
  return c;
}

test('a pharmacy signs up with its licence, prepares its page, and appears after admin approval', async () => {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  const join = await c.get('/en/facilities/join?kind=lab');
  assert.match(join.body, /value="lab" checked/);

  const bad = await c.postMultipart('/en/facilities/join', joinForm(phone, { kind: 'clinic', licenceNumber: '' }, null));
  assert.equal(bad.status, 422);
  assert.match(bad.body, /Choose the type of place/);
  assert.match(bad.body, /licence number/);
  // Documents never block sign-up; the list still shows what is needed for approval.
  assert.doesNotMatch(bad.body, /Upload this document/);
  assert.match(bad.body, /Responsible manager’s syndicate card/);
  assert.match(bad.body, /needed for approval/);
  assert.match(bad.body, /Radiation licence/);

  const ok = await c.postMultipart('/en/facilities/join', joinForm(phone));
  assert.equal(ok.status, 303, ok.body.slice(0, 300));
  assert.equal(ok.location, '/en/facility?ok=facilityJoined');
  const dash = await c.get(ok.location!);
  assert.match(dash.body, /checking your licence/);
  assert.match(dash.body, /Finish setting up your page/);
  const f = (await h.db.query<{ user_id: string; slug: string; verification_status: string }>(
    `select f.user_id, f.slug, f.verification_status from facilities f join users u on u.id = f.user_id where u.phone_e164 = $1`, [phone],
  )).rows[0]!;
  assert.equal(f.verification_status, 'pending');

  // Profile and a late-night branch.
  assert.equal((await c.post('/en/facility', { name: 'Nile Pharmacy', description: 'Delivery across Smouha.', phone: '03 4251234', whatsapp: '01012345678', homeService: 'yes' })).status, 303);
  const district = (await h.db.query<{ id: number }>("select id from districts where slug = 'smouha'")).rows[0]!.id;
  const branchBad = await c.post('/en/facility/branches', { name: 'S', district: String(district), address: 'x', opens: '10:00', closes: '10:00', active: 'yes' });
  assert.equal(branchBad.status, 422);
  assert.match(branchBad.body, /at least one day/);
  assert.match(branchBad.body, /cannot be the same/);
  const branch = await c.post('/en/facility/branches', {
    name: 'Smouha branch', district: String(district), address: '14 Victor Emmanuel Square', phone: '', days: ['0', '1', '2', '3', '4', '5', '6'], opens: '10:00', closes: '02:00', active: 'yes',
  });
  assert.equal(branch.status, 303);
  // Browsers on computers whose clock shows seconds send "03:00:00"; it saves as 3 AM.
  const branchId = /branches\/([0-9a-f-]{36})/.exec(branch.location ?? '')?.[1]
    ?? (await h.db.query<{ id: string }>('select id from facility_branches where name = $1', ['Smouha branch'])).rows[0]!.id;
  const withSeconds = await c.post(`/en/facility/branches/${branchId}`, {
    name: 'Smouha branch', district: String(district), address: '14 Victor Emmanuel Square', phone: '', days: ['0', '1', '2', '3', '4', '5', '6'], opens: '09:00', closes: '03:00:00', active: 'yes',
  });
  assert.equal(withSeconds.status, 303, withSeconds.body.slice(0, 300));
  assert.deepEqual((await h.db.query('select opens::text, closes::text from facility_branches where id = $1', [branchId])).rows[0], { opens: '09:00:00', closes: '03:00:00' });
  // Pharmacies have no price list.
  assert.equal((await c.get('/en/facility/prices')).status, 404);

  // Not public yet: only the owner can preview it.
  assert.equal((await new Client(h.baseUrl).get(`/en/pharmacies/${f.slug}`)).status, 404);
  assert.match((await c.get(`/en/pharmacies/${f.slug}`)).body, /visible only to you/);
  assert.ok(!(await new Client(h.baseUrl).get('/en/pharmacies')).body.includes('Nile Pharmacy'));

  // Admin reviews the licence (audited) and approves.
  const admin = await createAdmin(h.db);
  const ac = await signedIn(admin);
  const dashA = await ac.get('/en/admin');
  assert.match(dashA.body, /pharmacy\/lab application/);
  const list = await ac.get('/en/admin/facilities');
  assert.match(list.body, /Nile Pharmacy/);
  const detail = await ac.get(`/en/admin/facilities/${f.user_id}`);
  assert.match(detail.body, /MOH-12345/);
  const docId = /\/en\/admin\/facility-documents\/([0-9a-f-]+)/.exec(detail.body)![1]!;
  const doc = await fetch(`${h.baseUrl}/en/admin/facility-documents/${docId}`, { headers: { cookie: (ac as unknown as { cookieHeader(): string }).cookieHeader() } });
  assert.equal(doc.headers.get('content-type'), 'application/pdf');
  const viewed = await h.db.query<{ n: number }>(`select count(*)::int as n from audit_log where action = 'document.view' and entity_id = $1`, [docId]);
  assert.equal(viewed.rows[0]!.n, 1);
  assert.match((await ac.post(`/en/admin/facilities/${f.user_id}/reject`, { note: '' })).location!, /error=admin\.noteRequired/);
  assert.equal((await ac.post(`/en/admin/facilities/${f.user_id}/approve`, {})).location, '/en/admin/facilities?ok=done');
  const sms = await h.db.query<{ body: string }>('select body from notification_outbox where to_phone = $1 order by id desc limit 1', [phone]);
  assert.match(sms.rows[0]!.body, /approved/);

  const pub = await new Client(h.baseUrl).get(`/en/pharmacies/${f.slug}`);
  assert.equal(pub.status, 200);
  assert.match(pub.body, /Delivery across Smouha/);
  assert.match(pub.body, /Every day, ⁦?9:00\sAM–3:00\sAM \(next day\)/);
  assert.match(pub.body, /wa\.me\/201012345678/);
  assert.match(pub.body, /tel:\+2034251234/);
  assert.match((await new Client(h.baseUrl).get('/en/pharmacies?home=1')).body, /Nile Pharmacy/);
  // Wrong kind in the address redirects to the right one.
  assert.equal((await new Client(h.baseUrl).get(`/en/labs/${f.slug}`)).status, 301);

  // Suspending hides it again and signs the owner out.
  await ac.post(`/en/admin/facilities/${f.user_id}/suspend`, { note: 'Licence expired' });
  assert.equal((await new Client(h.baseUrl).get(`/en/pharmacies/${f.slug}`)).status, 404);
  assert.notEqual((await c.get('/en/facility')).status, 200);
});

test('labs: price list only for their own tests; patients compare the total for their request', async () => {
  const alpha = await createFacility('lab', 'Alpha Labs', { prices: { cbc: 150, hba1c: 300 } });
  await createFacility('lab', 'Beta Lab', { prices: { cbc: 120, hba1c: 250, tsh: 200 } });
  await createFacility('lab', 'Gamma Lab', { prices: { cbc: 90 } });

  const c = await signedIn(alpha);
  const page = await c.get('/en/facility/prices');
  assert.match(page.body, /Complete blood count/);
  assert.ok(!page.body.includes('name="price_mri"'), 'labs do not price MRI');
  const bad = await c.post('/en/facility/prices', { price_cbc: 'abc' });
  assert.equal(bad.status, 422);
  // Arabic digits accepted; empty = not offered; codes outside the list or kind are ignored.
  assert.equal((await c.post('/en/facility/prices', { price_cbc: '١٦٠', price_hba1c: '', price_mri: '999', price_xyz: '5', price_urine: '40' })).status, 303);
  const saved = await h.db.query<{ test_code: string; price_egp: number }>('select test_code, price_egp from facility_tests where facility_id = $1 order by test_code', [alpha.id]);
  assert.deepEqual(saved.rows, [{ test_code: 'cbc', price_egp: 160 }, { test_code: 'urine', price_egp: 40 }]);

  // A request for CBC + HbA1c: only places doing both, cheapest total first.
  await h.db.query("insert into facility_tests (facility_id, test_code, price_egp) values ($1, 'hba1c', 310)", [alpha.id]);
  const res = await new Client(h.baseUrl).get('/en/labs?tests=cbc,hba1c');
  assert.match(res.body, /do all 2 tests/);
  const beta = res.body.indexOf('Beta Lab');
  const alphaAt = res.body.indexOf('Alpha Labs');
  assert.ok(beta > 0 && alphaAt > beta, 'Beta (370) before Alpha (470)');
  assert.ok(!res.body.includes('Gamma Lab'), 'Gamma does not do HbA1c');
  assert.match(res.body, /EGP\s*370|370\s*EGP/);
  const prof = await new Client(h.baseUrl).get(`/en/labs/${alpha.slug}?tests=cbc,hba1c,tsh`);
  assert.match(prof.body, /Your tests here/);
  assert.match(prof.body, /Not listed here:/);
});

test('filters: district, open now, name; scan centres; junk in the address is ignored', async () => {
  await createFacility('radiology', 'Delta Scan', { prices: { mri: 1800, us_abdomen: 350 }, district: 'smouha' });
  await createFacility('radiology', 'Night Scan', { open24h: false, district: 'smouha' });
  const all = await new Client(h.baseUrl).get('/en/scan-centres');
  assert.match(all.body, /Delta Scan/);
  assert.match(all.body, /Night Scan/);
  const open = await new Client(h.baseUrl).get('/en/scan-centres?open=1');
  assert.match(open.body, /Delta Scan/);
  assert.ok(!open.body.includes('Night Scan'), 'closed (open 03:00–03:01 only)');
  const other = (await h.db.query<{ id: number }>("select id from districts where slug <> 'smouha' limit 1")).rows[0]!.id;
  assert.ok(!(await new Client(h.baseUrl).get(`/en/scan-centres?district=${other}`)).body.includes('Delta Scan'));
  assert.match((await new Client(h.baseUrl).get('/en/scan-centres?q=delta')).body, /Delta Scan/);
  const junk = await new Client(h.baseUrl).get("/en/labs?tests=';drop table users;--,cbc&district=abc&q=%25");
  assert.equal(junk.status, 200);
  assert.equal((await new Client(h.baseUrl).get('/en/pharmacies/..%2Fadmin')).status, 404);
});

test('access: only the owner edits; doctors, patients and other places are kept out', async () => {
  const one = await createFacility('pharmacy', 'One Pharmacy');
  const two = await createFacility('pharmacy', 'Two Pharmacy');
  const branchOfOne = (await h.db.query<{ id: string }>('select id from facility_branches where facility_id = $1', [one.id])).rows[0]!.id;
  const c2 = await signedIn(two);
  await c2.get('/en/facility');
  const district = (await h.db.query<{ id: number }>("select id from districts limit 1")).rows[0]!.id;
  const res = await c2.post(`/en/facility/branches/${branchOfOne}`, { name: 'Hijack', district: String(district), address: '1 Some Street', days: ['1'], opens: '09:00', closes: '10:00', active: 'yes' });
  assert.equal(res.status, 404);
  assert.equal((await c2.post(`/en/facility/branches/${branchOfOne}/delete`, {})).status, 404);
  assert.equal((await c2.get('/en/dashboard')).status, 403, 'not a doctor');
  assert.equal((await c2.get('/en/admin/facilities')).status, 403);
  const patient = await createPatient(h.db);
  assert.equal((await (await signedIn(patient)).get('/en/facility')).status, 403);
  const doctor = await createApprovedDoctor(h.db);
  assert.equal((await (await signedIn(doctor)).get('/en/facility')).status, 403);
  // The owner's private mobile is never on the public page.
  const pub = await new Client(h.baseUrl).get(`/en/pharmacies/${one.slug}`);
  assert.ok(!pub.body.includes(one.phone));
  // Sign-in sends the owner to their page.
  const login2 = new Client(h.baseUrl);
  assert.equal((await login(login2, one.phone, one.password)).location, '/en/facility');
});
