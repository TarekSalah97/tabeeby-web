import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createApprovedDoctor, createPatient, login, testPhone, type Harness } from '../helpers.js';
import { hashPassword } from '../../src/auth/password.js';
import { pngWithGps } from '../fixtures/images.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function centre(kind: 'lab' | 'radiology', name: string, prices: Record<string, number>) {
  const phone = testPhone();
  const { rows } = await h.db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('facility', 'Owner', $1, $2, now()) returning id`,
    [phone, await hashPassword('facility-password-1')],
  );
  const id = rows[0]!.id;
  await h.db.query(
    `insert into facilities (user_id, kind, slug, name, licence_number, verification_status, verified_at) values ($1, $2, $3, $4, 'LIC-1', 'approved', now())`,
    [id, kind, `${kind}-${crypto.randomBytes(3).toString('hex')}`, name],
  );
  for (const [code, price] of Object.entries(prices)) await h.db.query('insert into facility_tests (facility_id, test_code, price_egp) values ($1, $2, $3)', [id, code, price]);
  const c = new Client(h.baseUrl);
  await login(c, phone, 'facility-password-1');
  return { id, c };
}

/** A doctor's visit for the patient with one order holding a blood test and a chest X-ray. */
async function orderFor(patientId: string) {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const start = new Date(Date.now() + 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const appt = (await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [d.id, d.clinicId, patientId, start, new Date(start.getTime() + 1800_000)])).rows[0]!.id;
  await dc.get(`/en/dashboard/appointments/${appt}/file`);
  await dc.post('/en/dashboard/patients', { fullName: 'Test Patient', consent: 'yes', appointment: appt });
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [d.id])).rows[0]!.id;
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await dc.post(`/en/dashboard/patients/${recordId}/visits`, { complaint: 'Cough for a month', lab_code: ['cbc', 'xray_chest'] });
  const visitId = /visits\/([0-9a-f-]{36})/.exec(v.location!)![1]!;
  const labOrderId = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [visitId])).rows[0]!.id;
  return { d, dc, visitId, labOrderId };
}

test('health record: tabs split prescriptions, lab tests and imaging; old address redirects', async () => {
  const p = await createPatient(h.db);
  await orderFor(p.id);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  const old = await pc.get('/en/prescriptions');
  assert.equal(old.status, 303);
  assert.equal(old.location, '/en/health-record');
  const lab = await pc.get('/en/health-record?tab=lab');
  assert.match(lab.body, /Complete blood count|CBC/);
  assert.doesNotMatch(lab.body, /Chest X-ray/);
  const img = await pc.get('/en/health-record?tab=imaging');
  assert.match(img.body, /Chest X-ray/);
  assert.doesNotMatch(img.body, /Complete blood count/);
  assert.match(img.body, /Send to a scan centre on Tabeeby/);
});

test('full round trip: patient sends to a lab, the lab uploads results, patient and doctor see them', async () => {
  const p = await createPatient(h.db);
  const { dc, visitId, labOrderId } = await orderFor(p.id);
  const alpha = await centre('lab', 'Alpha Labs Test', { cbc: 120 });
  const other = await centre('lab', 'Other Lab', {});
  const scan = await centre('radiology', 'Delta Scan Test', { xray_chest: 200 });
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);

  // Choosing: the lab that does the test comes first, with its price; scan centres are not offered for blood tests.
  const choose = await pc.get(`/en/health-record/orders/${labOrderId}/lab/send`);
  assert.equal(choose.status, 200);
  assert.ok(choose.body.indexOf('Alpha Labs Test') < choose.body.indexOf('Other Lab'));
  assert.match(choose.body, /120 EGP in total/);
  assert.match(choose.body, /Has all tests/);
  assert.doesNotMatch(choose.body, /Delta Scan Test/);
  // A scan centre cannot be picked for the lab part.
  assert.equal((await pc.post(`/en/health-record/orders/${labOrderId}/lab/send`, { facility: scan.id })).status, 422);
  assert.equal((await pc.post(`/en/health-record/orders/${labOrderId}/lab/send`, { facility: alpha.id })).status, 303);
  assert.equal((await pc.post(`/en/health-record/orders/${labOrderId}/lab/send`, { facility: other.id })).status, 422, 'only one open request');

  // The lab sees only the blood test, not the X-ray, and not the other lab.
  const list = await alpha.c.get('/en/facility/requests');
  const reqId = /\/en\/facility\/requests\/([0-9a-f-]{36})/.exec(list.body)![1]!;
  const detail = await alpha.c.get(`/en/facility/requests/${reqId}`);
  assert.match(detail.body, /Complete blood count|CBC/);
  assert.doesNotMatch(detail.body, /Chest X-ray/);
  assert.equal((await other.c.get(`/en/facility/requests/${reqId}`)).status, 404);
  assert.doesNotMatch((await scan.c.get('/en/facility/requests')).body, new RegExp(reqId));

  // Upload before confirming is refused; then confirm; patient can no longer cancel.
  const early = new FormData();
  early.set('file', new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), 'cbc.pdf');
  assert.match((await alpha.c.postMultipart(`/en/facility/requests/${reqId}/results`, early)).location!, /error=hr.err.receiveFirst/);
  await alpha.c.post(`/en/facility/requests/${reqId}/received`, {});
  const cancel = await pc.post(`/en/health-record/requests/${reqId}/cancel`, {});
  assert.match(cancel.location!, /error=hr.err.cannotCancel/);

  // Wrong file types are refused; PDF and PNG accepted.
  const bad = new FormData();
  bad.set('file', new Blob(['<html><script>alert(1)</script>'], { type: 'application/pdf' }), 'x.pdf');
  assert.match((await alpha.c.postMultipart(`/en/facility/requests/${reqId}/results`, bad)).location!, /error=hr.err.fileType/);
  const ok = new FormData();
  ok.set('file', new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), 'cbc.pdf');
  assert.match((await alpha.c.postMultipart(`/en/facility/requests/${reqId}/results`, ok)).location!, /ok=resultAdded/);
  const img = new FormData();
  img.set('file', new Blob([new Uint8Array(pngWithGps())], { type: 'image/png' }), 'smear.png');
  await alpha.c.postMultipart(`/en/facility/requests/${reqId}/results`, img);
  const files = (await h.db.query<{ id: string }>('select id from order_results where request_id = $1 order by created_at', [reqId])).rows;
  assert.equal(files.length, 2);

  // Before release, the patient sees no files and cannot open them.
  assert.doesNotMatch((await pc.get('/en/health-record?tab=lab')).body, /\/results\//);
  assert.equal((await pc.get(`/en/results/${files[0]!.id}`)).status, 404);

  await alpha.c.post(`/en/facility/requests/${reqId}/ready`, { note: 'Please show these to your doctor.' });
  const after = await pc.get('/en/health-record?tab=lab');
  assert.match(after.body, /Results ready/);
  assert.match(after.body, /Please show these to your doctor/);
  const file = await pc.get(`/en/results/${files[0]!.id}`);
  assert.equal(file.status, 200);
  assert.ok(file.body.startsWith('%PDF'));

  // The ordering doctor sees them on the visit; others do not.
  const visit = await dc.get(`/en/dashboard/visits/${visitId}`);
  assert.match(visit.body, /Patient sent this to Alpha Labs Test/);
  assert.equal((await dc.get(`/en/results/${files[1]!.id}`)).status, 200);
  const stranger = await createPatient(h.db);
  const sc = new Client(h.baseUrl);
  await login(sc, stranger.phone, stranger.password);
  assert.equal((await sc.get(`/en/results/${files[0]!.id}`)).status, 404);
  assert.equal((await new Client(h.baseUrl).get(`/en/results/${files[0]!.id}`)).status, 404);
  assert.equal((await sc.get(`/en/health-record/orders/${labOrderId}/imaging/send`)).status, 404);

  // The SMS to the patient is queued; viewing is audited.
  assert.ok((await h.db.query("select 1 from notification_outbox where to_phone = $1 and body like '%results%'", [p.phone])).rows.length);
  assert.ok((await h.db.query("select 1 from audit_log where action = 'order.result_viewed'")).rows.length >= 2);
});

test('patient can cancel before the centre confirms, then choose another', async () => {
  const p = await createPatient(h.db);
  const { labOrderId } = await orderFor(p.id);
  const scan1 = await centre('radiology', 'Scan One', { xray_chest: 150 });
  const scan2 = await centre('radiology', 'Scan Two', { xray_chest: 180 });
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  await pc.get(`/en/health-record/orders/${labOrderId}/imaging/send`);
  await pc.post(`/en/health-record/orders/${labOrderId}/imaging/send`, { facility: scan1.id });
  const reqId = (await h.db.query<{ id: string }>('select id from order_requests where lab_order_id = $1', [labOrderId])).rows[0]!.id;
  assert.match((await pc.post(`/en/health-record/requests/${reqId}/cancel`, {})).location!, /ok=orderCancelled/);
  assert.equal((await pc.post(`/en/health-record/orders/${labOrderId}/imaging/send`, { facility: scan2.id })).status, 303);
  assert.doesNotMatch((await scan1.c.get('/en/facility/requests')).body, /Test Patient/);
  assert.match((await scan2.c.get('/en/facility/requests')).body, /Test Patient/);
});
