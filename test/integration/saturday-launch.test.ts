import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, testPhone, firstSlotStart, lastEmailCode, type Harness,
} from '../helpers.js';
import { hashPassword } from '../../src/auth/password.js';
import { deliverPending } from '../../src/services/outbox.js';
import { pngWithGps } from '../fixtures/images.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const PNG = () => new Blob([new Uint8Array(pngWithGps())], { type: 'image/png' });

async function signedIn(phone: string, password: string) {
  const c = new Client(h.baseUrl);
  await login(c, phone, password);
  return c;
}

async function facility(kind: 'pharmacy' | 'lab', name: string, o: { homeService?: boolean } = {}) {
  const phone = testPhone();
  const { rows } = await h.db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('facility', 'Owner', $1, $2, now()) returning id`,
    [phone, await hashPassword('facility-password-1')],
  );
  const id = rows[0]!.id;
  await h.db.query(
    `insert into facilities (user_id, kind, slug, name, licence_number, home_service, phone_e164, whatsapp_e164, verification_status, verified_at)
     values ($1, $2, $3, $4, 'LIC-1', $5, '+2034251234', '+201012345678', 'approved', now())`,
    [id, kind, `${kind}-${crypto.randomBytes(3).toString('hex')}`, name, !!o.homeService],
  );
  return { id, phone, c: await signedIn(phone, 'facility-password-1') };
}

/** A visit for the patient with one prescription and one blood test. */
async function visitWithOrders(patientId: string) {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const dc = await signedIn(d.phone, d.password);
  const start = new Date(Date.now() + 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const appt = (await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [d.id, d.clinicId, patientId, start, new Date(start.getTime() + 1800_000)])).rows[0]!.id;
  await dc.get(`/en/dashboard/appointments/${appt}/file`);
  await dc.post('/en/dashboard/patients', { fullName: 'Test Patient', consent: 'yes', appointment: appt });
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [d.id])).rows[0]!.id;
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await dc.post(`/en/dashboard/patients/${recordId}/visits`, {
    complaint: 'Sore throat', lab_code: ['cbc'],
    rx_medicine: ['Augmentin 1g'], rx_form: ['tablet'], rx_dose: ['1 tablet'], rx_frequency: ['twice_daily'], rx_timing: [''], rx_duration: ['7 days'], rx_instructions: [''],
  });
  const visitId = /visits\/([0-9a-f-]{36})/.exec(v.location!)![1]!;
  const rxId = (await h.db.query<{ id: string }>('select id from prescriptions where encounter_id = $1', [visitId])).rows[0]!.id;
  const labOrderId = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [visitId])).rows[0]!.id;
  return { d, dc, recordId, visitId, rxId, labOrderId };
}

test('booking: patient picks how to pay; InstaPay only when the doctor has an address; reference reaches the doctor', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const pc = await signedIn(p.phone, p.password);
  const slot = await firstSlotStart(pc, d.slug);
  const page = await pc.get(`/en/book?doctor=${d.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(page.body, /Cash at the clinic/);
  assert.match(page.body, /Debit or credit card at the clinic/);
  assert.match(page.body, /Online card, Fawry or mobile wallet/);
  assert.doesNotMatch(page.body, /value="instapay"/, 'no InstaPay without an address');
  // Choosing InstaPay anyway is refused.
  assert.equal((await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '', pay: 'instapay' })).status, 409);

  // The doctor sets an InstaPay address (bad ones are refused).
  const dc = await signedIn(d.phone, d.password);
  await dc.get('/en/dashboard/profile');
  assert.match((await dc.post('/en/dashboard/settings/instapay', { instapay: 'not an address' })).location!, /error=payopt\.addressInvalid/);
  assert.match((await dc.post('/en/dashboard/settings/instapay', { instapay: 'DrTest@instapay' })).location!, /ok=instapay/);
  const page2 = await pc.get(`/en/book?doctor=${d.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(page2.body, /drtest@instapay/);
  const booked = await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '', pay: 'instapay' });
  assert.equal(booked.status, 303, booked.body.slice(0, 200));
  const a = (await h.db.query<{ id: string; pay_choice: string }>('select id, pay_choice from appointments where patient_id = $1', [p.id])).rows[0]!;
  assert.equal(a.pay_choice, 'instapay');

  // The patient adds the transfer reference; another patient cannot.
  const list = await pc.get('/en/appointments');
  assert.match(list.body, /Send EGP 400 to drtest@instapay/);
  assert.match((await pc.post(`/en/appointments/${a.id}/pay-ref`, { ref: 'IPN-778899' })).location!, /ok=payRef/);
  const other = await createPatient(h.db);
  const oc = await signedIn(other.phone, other.password);
  assert.equal((await oc.post(`/en/appointments/${a.id}/pay-ref`, { ref: 'HACK123' })).status, 404);
  assert.equal((await h.db.query<{ pay_ref: string }>('select pay_ref from appointments where id = $1', [a.id])).rows[0]!.pay_ref, 'IPN-778899');

  // The doctor sees how the patient will pay and the reference.
  const date = new Date(slot.start).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const day = await dc.get(`/en/dashboard?date=${date}`);
  assert.match(day.body, /InstaPay · <bdi dir="ltr">IPN-778899<\/bdi>/);
});

test('guest booking: the guest chooses email or SMS for the code; SMS also verifies the mobile', async () => {
  const d = await createApprovedDoctor(h.db);
  for (const codeBy of ['sms', 'email'] as const) {
    const c = new Client(h.baseUrl);
    const slot = await firstSlotStart(c, d.slug);
    const form = await c.get(`/en/book?doctor=${d.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
    assert.match(form.body, /SMS to my mobile/);
    const phone = testPhone();
    const email = `g${crypto.randomBytes(3).toString('hex')}@example.com`;
    const res = await c.post('/en/book/guest', { clinic: slot.clinic, start: slot.start, fullName: 'Salma Guest', phone: '0' + phone.slice(3), email, reason: '', consent: 'yes', pay: 'card_clinic', codeBy });
    assert.equal(res.status, 303);
    const codePage = await c.get(res.location!);
    await deliverPending(h.db, h.sms, 20, h.email);
    let code: string;
    if (codeBy === 'sms') {
      assert.match(codePage.body, /by SMS/);
      const sms = [...h.sms.sent].reverse().find((m) => m.to === phone && /\d{6}/.test(m.body));
      assert.ok(sms, 'code by SMS');
      assert.ok(!h.email.sent.some((m) => m.to === email), 'no email code');
      code = /(\d{6})/.exec(sms.body)![1]!;
    } else {
      code = await lastEmailCode(h, email);
    }
    const done = await c.post(res.location!, { code });
    assert.equal(done.status, 303);
    if (codeBy === 'sms') assert.match(done.location!, /\/appointments/, 'no second code needed');
    else assert.match(done.location!, /verify-phone|appointments/);
    const u = (await h.db.query<{ phone_verified_at: Date | null; email_verified_at: Date | null }>('select phone_verified_at, email_verified_at from users where email = $1', [email])).rows[0]!;
    assert.equal(!!u.phone_verified_at, codeBy === 'sms');
    assert.equal(!!u.email_verified_at, codeBy === 'email');
    if (codeBy === 'sms') {
      const appt = (await h.db.query<{ pay_choice: string }>(`select a.pay_choice from appointments a join users u on u.id = a.patient_id where u.email = $1`, [email])).rows[0]!;
      assert.equal(appt.pay_choice, 'card_clinic');
      await deliverPending(h.db, h.sms, 20, h.email);
      assert.ok(h.sms.sent.some((m) => m.to === phone && /Dr\. Test Doctor/.test(m.body)), 'booking confirmation by SMS');
    }
  }
});

test('visit photos: taken or uploaded on a visit, seen only by that doctor, removable', async () => {
  const p = await createPatient(h.db);
  const { dc, recordId, visitId } = await visitWithOrders(p.id);
  const page = await dc.get(`/en/dashboard/visits/${visitId}`);
  assert.match(page.body, /capture="environment"/);
  const form = new FormData();
  form.append('photos', PNG(), 'rash.png');
  form.append('photos', PNG(), 'rash2.png');
  assert.match((await dc.postMultipart(`/en/dashboard/visits/${visitId}/photos`, form)).location!, /ok=photosAdded/);
  const bad = new FormData();
  bad.append('photos', new Blob(['%PDF-1.4 x'], { type: 'application/pdf' }), 'x.pdf');
  assert.match((await dc.postMultipart(`/en/dashboard/visits/${visitId}/photos`, bad)).location!, /error=vphoto\.invalid/);
  const ids = (await h.db.query<{ id: string }>('select id from encounter_photos where encounter_id = $1', [visitId])).rows.map((r) => r.id);
  assert.equal(ids.length, 2);
  const img = await dc.get(`/en/dashboard/visit-photos/${ids[0]}`);
  assert.equal(img.status, 200);
  // Another doctor and the patient cannot open it.
  const other = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [other.id]);
  assert.equal((await (await signedIn(other.phone, other.password)).get(`/en/dashboard/visit-photos/${ids[0]}`)).status, 404);
  assert.notEqual((await (await signedIn(p.phone, p.password)).get(`/en/dashboard/visit-photos/${ids[0]}`)).status, 200);
  // Removing hides it from the visit.
  assert.match((await dc.post(`/en/dashboard/visit-photos/${ids[0]}/remove`, {})).location!, /ok=photoRemovedVisit/);
  assert.equal((await dc.get(`/en/dashboard/visit-photos/${ids[0]}`)).status, 404);

  // Photos chosen on the new-visit form are saved with the new visit.
  await dc.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const nv = new FormData();
  nv.append('complaint', 'Follow-up of rash');
  nv.append('photos', PNG(), 'today.png');
  const saved = await dc.postMultipart(`/en/dashboard/patients/${recordId}/visits`, nv);
  const newVisit = /visits\/([0-9a-f-]{36})/.exec(saved.location!)![1]!;
  assert.equal((await h.db.query('select 1 from encounter_photos where encounter_id = $1', [newVisit])).rows.length, 1);
});

test('pharmacy: patient sends a prescription, the pharmacy answers with price, patient sees it; others see nothing', async () => {
  const p = await createPatient(h.db);
  const { rxId } = await visitWithOrders(p.id);
  const nile = await facility('pharmacy', 'Nile Pharmacy Test', { homeService: true });
  const other = await facility('pharmacy', 'Other Pharmacy Test');
  const pc = await signedIn(p.phone, p.password);
  const hr = await pc.get('/en/health-record');
  assert.match(hr.body, new RegExp(`/en/health-record/prescriptions/${rxId}/send`));
  const choose = await pc.get(`/en/health-record/prescriptions/${rxId}/send`);
  assert.match(choose.body, /Nile Pharmacy Test/);
  // Delivery from a pharmacy that does not deliver is refused.
  assert.equal((await pc.post(`/en/health-record/prescriptions/${rxId}/send`, { facility: other.id, delivery: 'yes', note: '' })).status, 422);
  assert.equal((await pc.post(`/en/health-record/prescriptions/${rxId}/send`, { facility: nile.id, delivery: 'yes', note: '12 Fouad St, 3rd floor' })).status, 303);
  assert.equal((await pc.post(`/en/health-record/prescriptions/${rxId}/send`, { facility: other.id, delivery: 'no', note: '' })).status, 422, 'one open request');
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(h.sms.sent.some((m) => m.to === nile.phone && /prescription/.test(m.body)));

  const inbox = await nile.c.get('/en/facility/prescriptions');
  const reqId = /\/en\/facility\/prescriptions\/([0-9a-f-]{36})/.exec(inbox.body)![1]!;
  const detail = await nile.c.get(`/en/facility/prescriptions/${reqId}`);
  assert.match(detail.body, /Augmentin 1g/);
  assert.match(detail.body, /12 Fouad St/);
  assert.equal((await other.c.get(`/en/facility/prescriptions/${reqId}`)).status, 404);
  // Labs have no prescription inbox.
  const lab = await facility('lab', 'Lab Test');
  assert.equal((await lab.c.get('/en/facility/prescriptions')).status, 404);

  // Patient can't cancel after the answer.
  assert.match((await nile.c.post(`/en/facility/prescriptions/${reqId}/reply`, { status: 'out_for_delivery', total: '٢٣٥', note: 'Arrives in 45 minutes' })).location!, /ok=rxReplied/);
  assert.match((await pc.post(`/en/health-record/pharmacy-requests/${reqId}/cancel`, {})).location!, /error=rxsend\.err\.cannotCancel/);
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(h.sms.sent.some((m) => m.to === p.phone && /Out for delivery/.test(m.body)));
  const after = await pc.get('/en/health-record');
  assert.match(after.body, /Out for delivery/);
  assert.match(after.body, /EGP 235/);
  assert.match(after.body, /Arrives in 45 minutes/);
  assert.match(after.body, /wa\.me\/201012345678/);
  assert.match((await nile.c.post(`/en/facility/prescriptions/${reqId}/done`, {})).location!, /ok=rxCompleted/);
});

test('lab requests carry a patient note and home-visit wish; the lab sends instructions back by SMS', async () => {
  const p = await createPatient(h.db);
  const { labOrderId } = await visitWithOrders(p.id);
  const lab = await facility('lab', 'Home Lab Test', { homeService: true });
  const pc = await signedIn(p.phone, p.password);
  const send = await pc.get(`/en/health-record/orders/${labOrderId}/lab/send`);
  assert.match(send.body, /Ask for a home visit/);
  assert.equal((await pc.post(`/en/health-record/orders/${labOrderId}/lab/send`, { facility: lab.id, homeVisit: 'yes', note: 'Mornings please' })).status, 303);
  const reqId = (await h.db.query<{ id: string }>('select id from order_requests where lab_order_id = $1', [labOrderId])).rows[0]!.id;
  const detail = await lab.c.get(`/en/facility/requests/${reqId}`);
  assert.match(detail.body, /Asked for a home visit/);
  assert.match(detail.body, /Mornings please/);
  await lab.c.post(`/en/facility/requests/${reqId}/received`, { instructions: 'Fast for 8 hours. We come at 9am.' });
  await deliverPending(h.db, h.sms, 20, h.email);
  assert.ok(h.sms.sent.some((m) => m.to === p.phone && /Fast for 8 hours/.test(m.body)));
  assert.match((await pc.get('/en/health-record?tab=lab')).body, /Fast for 8 hours/);
});

test('admin removes a test account: details wiped, sign-in stops, visits cancelled, number free again', async () => {
  const admin = await createAdmin(h.db);
  const ac = await signedIn(admin.phone, admin.password);
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const pc = await signedIn(p.phone, p.password);
  const slot = await firstSlotStart(pc, d.slug);
  await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' });

  const list = await ac.get('/en/admin/accounts');
  assert.match(list.body, /Newest accounts/);
  assert.match(list.body, new RegExp(`/en/admin/accounts/${d.id}/remove`));
  // Needs the confirmation word.
  assert.match((await ac.post(`/en/admin/accounts/${d.id}/remove`, { confirm: 'yes' })).location!, /error=adm\.removeConfirmWord/);
  assert.match((await ac.post(`/en/admin/accounts/${d.id}/remove`, { confirm: 'حذف' })).location!, /ok=accountRemoved/);
  // Admins cannot be removed.
  assert.match((await ac.post(`/en/admin/accounts/${admin.id}/remove`, { confirm: 'REMOVE' })).location!, /error=/);

  const u = (await h.db.query<{ status: string; full_name: string; email: string | null }>('select status, full_name, email from users where id = $1', [d.id])).rows[0]!;
  assert.equal(u.status, 'removed');
  assert.equal(u.full_name, 'Removed account');
  assert.equal((await h.db.query<{ status: string }>('select status from appointments where doctor_id = $1', [d.id])).rows[0]!.status, 'cancelled');
  assert.equal((await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`)).status, 404);
  const relog = await login(new Client(h.baseUrl), d.phone, d.password);
  assert.notEqual(relog.location, '/en/dashboard');
  // The mobile number can be registered again.
  await h.db.query(`insert into users (role, full_name, phone_e164, password_hash) values ('patient', 'New Person', $1, 'x')`, [d.phone]);
});

test('two people can be signed in to the same account at once (e.g. doctor and assistant)', async () => {
  const d = await createApprovedDoctor(h.db);
  const one = await signedIn(d.phone, d.password);
  const two = await signedIn(d.phone, d.password);
  assert.equal((await one.get('/en/dashboard')).status, 200);
  assert.equal((await two.get('/en/dashboard')).status, 200);
});

test('labs add their own tests with prices; they show on the public price list; others cannot touch them', async () => {
  const lab = await facility('lab', 'Extra Lab Test');
  const slug = (await h.db.query<{ slug: string }>('select slug from facilities where user_id = $1', [lab.id])).rows[0]!.slug;
  await lab.c.get('/en/facility/prices');
  assert.match((await lab.c.post('/en/facility/extra-tests', { extraName: 'Anti-Müllerian hormone (AMH)', extraPrice: '٨٥٠', extraNote: 'Results in 3 days' })).location!, /ok=extraAdded/);
  const dup = await lab.c.post('/en/facility/extra-tests', { extraName: 'anti-müllerian hormone (amh)', extraPrice: '900', extraNote: '' });
  assert.equal(dup.status, 422);
  assert.match(dup.body, /already on your list/);
  assert.equal((await lab.c.post('/en/facility/extra-tests', { extraName: 'X', extraPrice: 'abc', extraNote: '' })).status, 422);
  const id = (await h.db.query<{ id: string }>('select id from facility_extra_tests where facility_id = $1', [lab.id])).rows[0]!.id;
  assert.match((await lab.c.post(`/en/facility/extra-tests/${id}`, { price: '800', note: 'Results in 2 days' })).location!, /ok=extraUpdated/);
  const pub = await new Client(h.baseUrl).get(`/en/labs/${slug}`);
  assert.match(pub.body, /Anti-Müllerian hormone \(AMH\)/);
  assert.match(pub.body, /EGP 800/);
  assert.match(pub.body, /Results in 2 days/);
  const other = await facility('lab', 'Other Extra Lab');
  assert.equal((await other.c.post(`/en/facility/extra-tests/${id}/delete`, {})).status, 404);
  assert.match((await lab.c.post(`/en/facility/extra-tests/${id}/delete`, {})).location!, /ok=extraDeleted/);
  assert.doesNotMatch((await new Client(h.baseUrl).get(`/en/labs/${slug}`)).body, /AMH/);
});

test('lab insights: requests, top referring doctors and top tests; a pharmacy sees its own', async () => {
  const lab = await facility('lab', 'Insight Lab Test', { homeService: true });
  const p1 = await createPatient(h.db);
  const p2 = await createPatient(h.db);
  const a = await visitWithOrders(p1.id);
  const b = await visitWithOrders(p2.id);
  await h.db.query(`update users set full_name = 'Dr. Top Referrer' where id = $1`, [a.d.id]);
  // Doctor A's patient sends one request; doctor A writes a second order for patient 1 too.
  const pc1 = await signedIn(p1.phone, p1.password);
  await pc1.post(`/en/health-record/orders/${a.labOrderId}/lab/send`, { facility: lab.id, note: '' });
  const pc2 = await signedIn(p2.phone, p2.password);
  await pc2.post(`/en/health-record/orders/${b.labOrderId}/lab/send`, { facility: lab.id, homeVisit: 'yes', note: '' });
  await a.dc.get(`/en/dashboard/patients/${a.recordId}/visits/new`);
  const v2 = await a.dc.post(`/en/dashboard/patients/${a.recordId}/visits`, { complaint: 'Recheck', lab_code: ['cbc'] });
  const visit2 = /visits\/([0-9a-f-]{36})/.exec(v2.location!)![1]!;
  const order2 = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [visit2])).rows[0]!.id;
  await pc1.post(`/en/health-record/orders/${order2}/lab/send`, { facility: lab.id, note: '' });
  await h.db.query(`insert into facility_tests (facility_id, test_code, price_egp) values ($1, 'cbc', 120)`, [lab.id]);
  const req = (await h.db.query<{ id: string }>('select id from order_requests where lab_order_id = $1', [a.labOrderId])).rows[0]!.id;
  await h.db.query(`update order_requests set status = 'ready', received_at = created_at, ready_at = created_at + interval '5 hours' where id = $1`, [req]);

  const page = await lab.c.get('/en/facility/insights?period=30d');
  assert.equal(page.status, 200);
  assert.match(page.body, /Your top referrer: Dr\. Top Referrer/);
  assert.match(page.body, /2 requests · 1 patients/);
  assert.match(page.body, /Complete blood count \(CBC\)/);
  assert.match(page.body, /5 h/);
  assert.match(page.body, /EGP 120/);
  // Lab-specific: tests asked for that are not on the price list, busiest hours, specialties.
  assert.match(page.body, /Asked for, but not on your price list/);
  assert.match(page.body, /Busiest hours/);
  assert.match(page.body, /Cardiology/);
  assert.match(page.body, /Returning patients/);
  assert.match(page.body, /href="\/en\/facility\/insights"/);
  // Another lab sees none of it.
  const other = await facility('lab', 'Quiet Lab');
  assert.match((await other.c.get('/en/facility/insights')).body, /No referrals in this period yet/);
  // Patients and doctors cannot open it.
  assert.equal((await pc1.get('/en/facility/insights')).status, 403);

  // Pharmacy version counts prescriptions sent to it.
  const ph = await facility('pharmacy', 'Insight Pharmacy');
  await pc1.post(`/en/health-record/prescriptions/${a.rxId}/send`, { facility: ph.id, delivery: 'no', note: '' });
  const pp = await ph.c.get('/en/facility/insights');
  assert.match(pp.body, /Your top referrer: Dr\. Top Referrer/);
  assert.match(pp.body, /Augmentin 1g/);
  // Pharmacy-specific: what it did not have, and how often it could fill the prescription.
  const prq = (await h.db.query<{ id: string }>('select id from pharmacy_requests where facility_id = $1', [ph.id])).rows[0]!.id;
  await ph.c.post(`/en/facility/prescriptions/${prq}/reply`, { status: 'unavailable', total: '', note: '' });
  const pp2 = await ph.c.get('/en/facility/insights');
  assert.match(pp2.body, /Medicines you did not have/);
  assert.match(pp2.body, /Augmentin 1g<\/bdi><\/span><strong>1×/);
  assert.match(pp2.body, /You had everything in 0% of prescriptions/);
  assert.doesNotMatch(pp2.body, /not on your price list/);

  // Scan centre: by type of scan.
  const scan = await facility('lab', 'Scan Insight Centre');
  await h.db.query(`update facilities set kind = 'radiology' where user_id = $1`, [scan.id]);
  await a.dc.get(`/en/dashboard/patients/${a.recordId}/visits/new`);
  const v3 = await a.dc.post(`/en/dashboard/patients/${a.recordId}/visits`, { complaint: 'Abdominal pain', lab_code: ['us_abdomen'] });
  const order3 = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [/visits\/([0-9a-f-]{36})/.exec(v3.location!)![1]!])).rows[0]!.id;
  assert.equal((await pc1.post(`/en/health-record/orders/${order3}/imaging/send`, { facility: scan.id, note: '' })).status, 303);
  const sp = await scan.c.get('/en/facility/insights');
  assert.match(sp.body, /By type of scan/);
  assert.match(sp.body, /Ultrasound/);
  assert.match(sp.body, /Most requested scans/);
});
