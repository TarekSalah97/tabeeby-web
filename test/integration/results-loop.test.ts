import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createApprovedDoctor, createPatient, login, testPhone, type Harness } from '../helpers.js';
import { hashPassword } from '../../src/auth/password.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function centre(kind: 'lab' | 'radiology', name: string, prices: Record<string, number>, extra: Record<string, number> = {}) {
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
  for (const [n, price] of Object.entries(extra)) await h.db.query('insert into facility_extra_tests (facility_id, name, price_egp) values ($1, $2, $3)', [id, n, price]);
  const c = new Client(h.baseUrl);
  await login(c, phone, 'facility-password-1');
  return { id, c };
}

/** A doctor with records on, a visit for the patient, and a lab order with the given tests. */
async function doctorVisit(patientId: string, form: Record<string, string | string[]>) {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Loop Owner' });
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const start = new Date(Date.now() + 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const appt = (await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [d.id, d.clinicId, patientId, start, new Date(start.getTime() + 1800_000)])).rows[0]!.id;
  await dc.get(`/en/dashboard/appointments/${appt}/file`);
  await dc.post('/en/dashboard/patients', { fullName: 'Loop Patient', consent: 'yes', appointment: appt });
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [d.id])).rows[0]!.id;
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await dc.post(`/en/dashboard/patients/${recordId}/visits`, { complaint: 'Check-up', ...form });
  assert.equal(v.status, 303, v.body.slice(0, 200));
  const visitId = /visits\/([0-9a-f-]{36})/.exec(v.location!)![1]!;
  const labOrderId = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [visitId])).rows[0]?.id;
  return { d, dc, visitId, labOrderId: labOrderId!, recordId, location: v.location! };
}

async function itemsOf(labOrderId: string) {
  return (await h.db.query<{ test_code: string | null; test_name: string | null }>('select test_code, test_name from lab_order_items where lab_order_id = $1 order by position', [labOrderId])).rows;
}

const outboxTo = async (phone: string) => (await h.db.query<{ body: string }>('select body from notification_outbox where to_phone = $1 order by created_at', [phone])).rows.map((r) => r.body);

/** Send, receive, sample, upload and release; returns the request id. */
async function runToReady(pc: Client, lab: { id: string; c: Client }, labOrderId: string, section: 'lab' | 'imaging' = 'lab', extra: Record<string, string> = {}) {
  const sent = await pc.post(`/en/health-record/orders/${labOrderId}/${section}/send`, { facility: lab.id, ...extra });
  assert.equal(sent.status, 303, sent.body.slice(0, 300));
  const reqId = (await h.db.query<{ id: string }>(`select id from order_requests where lab_order_id = $1 and section = $2 and status <> 'cancelled'`, [labOrderId, section])).rows[0]!.id;
  await lab.c.post(`/en/facility/requests/${reqId}/received`, {});
  return reqId;
}

async function release(lab: { c: Client }, reqId: string) {
  const f = new FormData();
  f.set('file', new Blob([new Uint8Array(PDF)], { type: 'application/pdf' }), 'r.pdf');
  await lab.c.postMultipart(`/en/facility/requests/${reqId}/results`, f);
  assert.equal((await lab.c.post(`/en/facility/requests/${reqId}/ready`, { note: 'Done.' })).status, 303);
}

test('results loop: tracker steps, the doctor is told, reviews with a comment and asks for a follow-up', async () => {
  const p = await createPatient(h.db);
  const { d, dc, labOrderId } = await doctorVisit(p.id, { lab_code: ['fbs', 'cbc'] });
  const lab = await centre('lab', 'Loop Lab', { fbs: 50, cbc: 120 });
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);

  // Before sending: preparation advice for fasting sugar.
  const rec = await pc.get('/en/health-record?tab=lab');
  assert.match(rec.body, /How to prepare/);
  assert.match(rec.body, /Fast for 8–12 hours/);

  const reqId = await runToReady(pc, lab, labOrderId);
  let page = (await pc.get('/en/health-record?tab=lab')).body;
  assert.match(page, /data-testid="tracker"/);
  assert.match(page, /<li class="done"[^>]*>\s*<span class="tracker-dot"[^>]*><\/span>\s*<span class="tracker-label">Received by the centre/);
  assert.match(page, /class="current" aria-current="step">\s*<span class="tracker-dot"[^>]*><\/span>\s*<span class="tracker-label">Sample taken/);

  // The centre marks the sample taken (only once, only its own request).
  const other = await centre('lab', 'Not Mine Lab', {});
  assert.equal((await other.c.post(`/en/facility/requests/${reqId}/sample`, {})).status, 404);
  assert.match((await lab.c.post(`/en/facility/requests/${reqId}/sample`, {})).location!, /ok=sampleTaken/);
  assert.match((await lab.c.post(`/en/facility/requests/${reqId}/sample`, {})).location!, /error=hr.err.receiveFirst/);
  page = (await pc.get('/en/health-record?tab=lab')).body;
  assert.match(page, /class="current" aria-current="step">\s*<span class="tracker-dot"[^>]*><\/span>\s*<span class="tracker-label">Results ready/);

  // Nothing to review yet.
  assert.doesNotMatch((await dc.get('/en/dashboard')).body, /data-testid="results-banner"/);
  await release(lab, reqId);

  // The doctor gets an SMS without the patient's name, a banner, and the result in the list.
  const sms = await outboxTo(d.phone);
  assert.ok(sms.some((b) => /(new test results are ready for you to review|نتايج تحاليل جديدة جاهزة لمراجعتك)/.test(b) && b.includes('/dashboard/results')));
  assert.ok(sms.every((b) => !b.includes('Loop Patient')));
  assert.match((await dc.get('/en/dashboard')).body, /1 new result\(s\) waiting for your review/);
  const list = await dc.get('/en/dashboard/results');
  assert.equal(list.status, 200);
  assert.match(list.body, /data-testid="result-to-review"/);
  assert.match(list.body, /Loop Patient/);
  assert.match(list.body, /Fasting blood sugar/);

  // Another doctor can neither see nor review it.
  const stranger = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [stranger.id]);
  const sc = new Client(h.baseUrl);
  await login(sc, stranger.phone, stranger.password);
  assert.doesNotMatch((await sc.get('/en/dashboard/results')).body, /Loop Patient/);
  assert.equal((await sc.post(`/en/dashboard/results/${reqId}/review`, { comment: 'x' })).status, 404);
  // A patient or the centre cannot either.
  assert.notEqual((await pc.post(`/en/dashboard/results/${reqId}/review`, {})).status, 303);
  // Too-long comments are refused.
  assert.match((await dc.post(`/en/dashboard/results/${reqId}/review`, { comment: 'x'.repeat(501) })).location!, /error=res.err.tooLong/);

  const rv = await dc.post(`/en/dashboard/results/${reqId}/review`, { comment: 'Sugar is a little high <b>.', followUp: 'yes' });
  assert.match(rv.location!, /ok=resReviewed/);
  assert.match((await dc.post(`/en/dashboard/results/${reqId}/review`, {})).location!, /error=res.err.already/);
  assert.doesNotMatch((await dc.get('/en/dashboard/results')).body, /data-testid="result-to-review"/);
  assert.match((await dc.get('/en/dashboard/results?tab=reviewed')).body, /Follow-up requested/);

  // The patient sees the doctor's comment (escaped), the follow-up button, and a full tracker.
  page = (await pc.get('/en/health-record?tab=lab')).body;
  assert.match(page, /Dr\. Loop Owner reviewed these results/);
  assert.match(page, /Sugar is a little high &lt;b&gt;\./);
  assert.match(page, /Book a follow-up/);
  assert.doesNotMatch(page, /class="current"/);
  const psms = await outboxTo(p.phone);
  assert.ok(psms.some((b) => /(reviewed your results and asks you to book a follow-up|وطالب تحجز متابعة)/.test(b)));
  assert.ok(psms.every((b) => !b.includes('Sugar is a little high')), 'no medical detail by SMS');

  // The visit page shows it as reviewed.
  const audit = await h.db.query(`select 1 from audit_log where action = 'order.reviewed' and entity_id = $1`, [reqId]);
  assert.equal(audit.rows.length, 1);
});

test('results loop: a secretary cannot see or review results', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Team Results' });
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  await dc.get('/en/dashboard/team');
  const phone = testPhone();
  const res = await dc.post('/en/dashboard/team', { fullName: 'Sara Secretary', phone: '0' + phone.slice(3), access: 'files' });
  const link = /value="(http[^"]+\/team\/join\/([A-Za-z0-9_-]+))"/.exec(res.body)!;
  const s = new Client(h.baseUrl);
  const path = new URL(link[1]!.replace(/&amp;/g, '&')).pathname;
  await s.get(path);
  assert.equal((await s.post(path, { password: 'Secretary-pass-2026' })).status, 303);
  assert.equal((await s.get('/en/dashboard/results')).status, 403);
  assert.equal((await s.get('/en/dashboard/lab-sets')).status, 403);
  assert.doesNotMatch((await s.get('/en/dashboard')).body, /dashboard\/results/);
});

test('choosing a centre: typed tests match extra tests by name, missing tests are named, totals add up', async () => {
  const p = await createPatient(h.db);
  const { labOrderId } = await doctorVisit(p.id, { lab_code: ['cbc', 'tsh'], lab_other: 'Anti-TPO antibodies' });
  await centre('lab', 'Full Lab', { cbc: 100, tsh: 150 }, { 'anti-tpo antibodies': 300 });
  await centre('lab', 'Half Lab', { cbc: 80 });
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  const body = (await pc.get(`/en/health-record/orders/${labOrderId}/lab/send`)).body;
  assert.ok(body.indexOf('Full Lab') < body.indexOf('Half Lab'), 'the lab with every test first');
  assert.match(body, /550 EGP in total/);
  assert.match(body, /80 EGP for the listed tests/);
  assert.match(body, /does 1 of 3 tests/);
  assert.match(body, /Not listed: TSH, Anti-TPO antibodies/);
  // Arabic page works too.
  assert.match((await pc.get(`/health-record/orders/${labOrderId}/lab/send`)).body, /الإجمالي/);
});

test('contrast scan: the patient may share one of their own kidney tests; only that centre can open it', async () => {
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);
  // An earlier kidney test with released results.
  const first = await doctorVisit(p.id, { lab_code: ['kft'] });
  const lab = await centre('lab', 'Kidney Lab', { kft: 90 });
  const kidneyReq = await runToReady(pc, lab, first.labOrderId);
  await release(lab, kidneyReq);
  const kidneyFile = (await h.db.query<{ id: string }>('select id from order_results where request_id = $1', [kidneyReq])).rows[0]!.id;
  // A blood test that is not a kidney test.
  const cbcVisit = await doctorVisit(p.id, { lab_code: ['cbc'] });
  const cbcReq = await runToReady(pc, lab, cbcVisit.labOrderId);
  await release(lab, cbcReq);

  // A CT order.
  const ct = await doctorVisit(p.id, { lab_code: ['ct'] });
  const scan = await centre('radiology', 'Contrast Scan', { ct: 1500 });
  const otherScan = await centre('radiology', 'Other Scan', { ct: 1400 });
  const page = (await pc.get(`/en/health-record/orders/${ct.labOrderId}/imaging/send`)).body;
  assert.match(page, /data-testid="kidney-share"/);
  assert.match(page, /Share my kidney test from/);
  assert.match(page, new RegExp(`value="${kidneyReq}"`));
  assert.doesNotMatch(page, new RegExp(`value="${cbcReq}"`), 'only kidney tests are offered');
  assert.match(page, /contrast dye/);

  // Sharing a non-kidney request, or someone else's, is refused.
  assert.equal((await pc.post(`/en/health-record/orders/${ct.labOrderId}/imaging/send`, { facility: scan.id, shareKidney: cbcReq })).status, 422);
  const q2 = await pc.post(`/en/health-record/orders/${ct.labOrderId}/imaging/send`, { facility: scan.id, shareKidney: kidneyReq });
  assert.equal(q2.status, 303);
  const scanReq = (await h.db.query<{ id: string }>(`select id from order_requests where lab_order_id = $1 and status <> 'cancelled'`, [ct.labOrderId])).rows[0]!.id;

  const detail = await scan.c.get(`/en/facility/requests/${scanReq}`);
  assert.match(detail.body, /Kidney test shared by the patient/);
  assert.match(detail.body, new RegExp(`/results/${kidneyFile}`));
  assert.match(detail.body, /contrast dye/);
  assert.equal((await scan.c.get(`/en/results/${kidneyFile}`)).status, 200);
  assert.equal((await otherScan.c.get(`/en/results/${kidneyFile}`)).status, 404);
  const cbcFile = (await h.db.query<{ id: string }>('select id from order_results where request_id = $1', [cbcReq])).rows[0]!.id;
  assert.equal((await scan.c.get(`/en/results/${cbcFile}`)).status, 404, 'nothing else of the patient');

  // A plain X-ray (no contrast) cannot carry a share.
  const xr = await doctorVisit(p.id, { lab_code: ['xray_chest'] });
  const xrScan = await centre('radiology', 'Xray Scan', { xray_chest: 100 });
  assert.doesNotMatch((await pc.get(`/en/health-record/orders/${xr.labOrderId}/imaging/send`)).body, /data-testid="kidney-share"/);
  assert.equal((await pc.post(`/en/health-record/orders/${xr.labOrderId}/imaging/send`, { facility: xrScan.id, shareKidney: kidneyReq })).status, 422);

  // Another patient cannot share this patient's kidney test.
  const p2 = await createPatient(h.db);
  const pc2 = new Client(h.baseUrl);
  await login(pc2, p2.phone, p2.password);
  const ct2 = await doctorVisit(p2.id, { lab_code: ['mri'] });
  assert.equal((await pc2.post(`/en/health-record/orders/${ct2.labOrderId}/imaging/send`, { facility: scan.id, shareKidney: kidneyReq })).status, 422);
});

test('quick lab sets: built-in sets expand on the server, a doctor saves and reuses their own, scoped to them', async () => {
  const p = await createPatient(h.db);
  // Built-in "Thyroid" set ticked (no JavaScript), plus one single test.
  const v = await doctorVisit(p.id, { lab_set: 'builtin:thyroid', lab_code: 'cbc', lab_save_as: 'My thyroid work-up' });
  assert.match(v.location, /ok=visitSavedSet/);
  assert.deepEqual((await itemsOf(v.labOrderId)).map((i) => i.test_code).sort(), ['cbc', 'ft4', 'tsh']);
  const sets = (await h.db.query<{ id: string; codes: string[] }>('select id, codes from doctor_lab_sets where doctor_id = $1', [v.d.id])).rows;
  assert.equal(sets.length, 1);
  assert.deepEqual([...sets[0]!.codes].sort(), ['cbc', 'ft4', 'tsh']);

  // The set shows on the form and the manage page.
  const form = await v.dc.get(`/en/dashboard/visits/${v.visitId}`);
  assert.match(form.body, /My thyroid work-up/);
  assert.match(form.body, /Diabetes follow-up/);
  const manage = await v.dc.get('/en/dashboard/lab-sets');
  assert.equal(manage.status, 200);
  assert.match(manage.body, /My thyroid work-up/);

  // A set with typed tests; then reuse it on a second order.
  assert.match((await v.dc.post('/en/dashboard/lab-sets', { name: 'Liver plus', lab_code: ['lft'], lab_other: 'GGT\nAlpha-fetoprotein' })).location!, /ok=labSetSaved/);
  assert.equal((await v.dc.post('/en/dashboard/lab-sets', { name: 'liver PLUS', lab_code: ['lft'] })).status, 422, 'same name');
  assert.equal((await v.dc.post('/en/dashboard/lab-sets', { name: 'Empty' })).status, 422);
  assert.equal((await v.dc.post('/en/dashboard/lab-sets', { name: 'Bad', lab_code: ['not_a_test'] })).status, 422);
  const liver = (await h.db.query<{ id: string }>(`select id from doctor_lab_sets where doctor_id = $1 and name = 'Liver plus'`, [v.d.id])).rows[0]!.id;
  const add = await v.dc.post(`/en/dashboard/visits/${v.visitId}/lab-orders`, { lab_set: liver, lab_other: 'ggt' });
  assert.match(add.location!, /ok=labIssued/);
  const newest = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1 order by issued_at desc limit 1', [v.visitId])).rows[0]!.id;
  const items = await itemsOf(newest);
  assert.deepEqual(items.filter((i) => i.test_code).map((i) => i.test_code), ['lft']);
  assert.deepEqual(items.filter((i) => i.test_name).map((i) => i.test_name), ['ggt', 'Alpha-fetoprotein'], 'typed test not doubled');

  // Another doctor cannot use or delete this doctor's set.
  const other = await doctorVisit((await createPatient(h.db)).id, { lab_set: liver, lab_code: 'cbc' });
  assert.deepEqual((await itemsOf(other.labOrderId)).map((i) => i.test_code), ['cbc']);
  assert.equal((await other.dc.post(`/en/dashboard/lab-sets/${liver}/delete`, {})).status, 404);
  assert.match((await v.dc.post(`/en/dashboard/lab-sets/${liver}/delete`, {})).location!, /ok=labSetDeleted/);
  // Arabic labels.
  assert.match((await v.dc.get('/dashboard/lab-sets')).body, /متابعة السكر/);
});
