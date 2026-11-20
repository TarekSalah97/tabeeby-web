import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createAdmin, createPatient, login, lastOtp, firstSlotStart, testPhone, type Harness } from '../helpers.js';
import { book } from '../../src/services/booking.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

function joinForm(phone: string, extra: Record<string, string | string[]> = {}, card: Blob | null = new Blob([Buffer.from('%PDF-1.4 syndicate card')], { type: 'application/pdf' })) {
  const f = new FormData();
  const fields: Record<string, string | string[]> = {
    fullName: 'Dr. Hana Ortho',
    email: `hana.${phone.slice(-6)}@example.com`,
    phone: '0' + phone.slice(3),
    password: 'knee-surgeon-2026',
    kind: 'medical',
    specialty: '',
    graduationYear: '2012',
    consent: 'yes',
    posTitle: ['Resident', 'Specialist', ''],
    posWorkplace: ['Hospital A', 'Hospital B', ''],
    posStart: ['2021-01', '2022-01', ''],
    posEnd: ['2023-01', '2024-01', ''],
    ...extra,
  };
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  if (card) f.append('card', card, 'card.pdf');
  return f;
}

test('doctor joins, is hidden until approved, sets up hours, then runs a visit', async () => {
  const { rows: specs } = await h.db.query<{ id: number }>("select id from specialties where slug = 'orthopedics'");
  const { rows: subs } = await h.db.query<{ id: number }>("select id from subspecialties where slug = 'knee'");
  const { rows: wrongSubs } = await h.db.query<{ id: number }>("select id from subspecialties where slug = 'acne'");
  const phone = testPhone();
  const doc = new Client(h.baseUrl);
  await doc.get('/en/for-doctors/join');

  // Validation: no card, subspecialty from another specialty, start date in the future.
  const bad = await doc.postMultipart(
    '/en/for-doctors/join',
    joinForm(phone, { specialty: String(specs[0]!.id), subspecialties: [String(wrongSubs[0]!.id)], posStart: ['2099-01', '', ''], posTitle: ['X', '', ''], posWorkplace: ['Y', '', ''], posEnd: ['', '', ''] }, null),
  );
  assert.equal(bad.status, 422);
  assert.match(bad.body, /Upload your syndicate membership card/);
  assert.match(bad.body, /Choose subspecialties that belong to your specialty/);
  assert.match(bad.body, /start date can’t be in the future/);

  // A disguised file (HTML named .pdf) is rejected by content sniffing.
  const disguised = await doc.postMultipart(
    '/en/for-doctors/join',
    joinForm(phone, { specialty: String(specs[0]!.id), subspecialties: [String(subs[0]!.id)] }, new Blob(['<html><script>x</script>'], { type: 'application/pdf' })),
  );
  assert.match(disguised.body, /must be a JPG, PNG or PDF/);

  const ok = await doc.postMultipart('/en/for-doctors/join', joinForm(phone, { specialty: String(specs[0]!.id), subspecialties: [String(subs[0]!.id)] }));
  assert.equal(ok.status, 303, ok.body.slice(0, 300));
  assert.match(ok.location!, /verify-phone/);
  await doc.get('/en/verify-phone?next=%2Fdashboard');
  const verified = await doc.post('/en/verify-phone', { code: await lastOtp(h, phone), next: '/dashboard' });
  assert.equal(verified.location, '/en/dashboard');

  const dash = await doc.get('/en/dashboard');
  assert.match(dash.body, /Your profile is being verified/);
  const { rows: d } = await h.db.query<{ user_id: string; slug: string; verification_status: string }>(
    `select d.user_id, d.slug, d.verification_status from doctors d join users u on u.id = d.user_id where u.phone_e164 = $1`,
    [phone],
  );
  assert.equal(d[0]!.verification_status, 'pending');

  // Experience: 2021–2023 and 2022–2024 overlap → 3 years.
  const profile = await doc.get('/en/dashboard/profile');
  assert.match(profile.body, /3 years of experience/);

  // Clinic + hours.
  const { rows: dist } = await h.db.query<{ id: number }>("select id from districts where slug = 'louran'");
  await doc.get('/en/dashboard/clinics');
  const badClinic = await doc.post('/en/dashboard/clinics', { name: 'L', district: String(dist[0]!.id), address: 'x', fee: '-5' });
  assert.equal(badClinic.status, 422);
  assert.equal((await doc.post('/en/dashboard/clinics', { name: 'Louran Ortho', district: String(dist[0]!.id), address: '12 Louran Street', fee: '٤٥٠', active: 'yes' })).status, 303);
  const { rows: clinic } = await h.db.query<{ id: string; fee_egp: number }>('select id, fee_egp from clinics where doctor_id = $1', [d[0]!.user_id]);
  assert.equal(clinic[0]!.fee_egp, 450, 'Arabic-Indic digits accepted');

  await doc.get('/en/dashboard/hours');
  for (let wd = 0; wd < 7; wd++) {
    const r = await doc.post('/en/dashboard/hours/rules', { clinic: clinic[0]!.id, weekday: String(wd), start: '00:00', end: '23:30', slot: '30' });
    assert.equal(r.status, 303);
  }
  const overlap = await doc.post('/en/dashboard/hours/rules', { clinic: clinic[0]!.id, weekday: '1', start: '10:00', end: '11:00', slot: '30' });
  assert.equal(overlap.status, 422);
  assert.match(overlap.body, /overlap/);

  // Still invisible to patients while pending.
  const anon = new Client(h.baseUrl);
  assert.ok(!(await anon.get('/en/search?q=Hana')).body.includes('Hana Ortho'));
  assert.equal((await anon.get(`/en/doctors/${d[0]!.slug}`)).status, 404);

  // Admin reviews and approves.
  const admin = await createAdmin(h.db);
  const a = new Client(h.baseUrl);
  await login(a, admin.phone, admin.password);
  const list = await a.get('/en/admin');
  assert.match(list.body, /Hana Ortho/);
  await a.get(`/en/admin/doctors/${d[0]!.user_id}`);
  const noNote = await a.post(`/en/admin/doctors/${d[0]!.user_id}/reject`, { note: '' });
  assert.match(noNote.location!, /error=admin\.noteRequired/);
  assert.equal((await a.post(`/en/admin/doctors/${d[0]!.user_id}/approve`, {})).location, '/en/admin?ok=done');

  const found = await anon.get('/en/search?q=knee%20pain&district=louran');
  assert.match(found.body, /Hana Ortho/);

  // A patient books; the doctor runs the visit from the dashboard.
  const patient = await createPatient(h.db);
  const slot = await firstSlotStart(anon, d[0]!.slug, 0.5);
  const apptId = await book(
    h.deps,
    { id: patient.id, role: 'patient', fullName: 'Test Patient', phone: patient.phone, phoneVerified: true, locale: 'ar' },
    { clinicId: slot.clinic, startsAt: new Date(slot.start), visitType: 'follow_up', reason: '' },
    'ip',
  );
  await doc.get('/en/dashboard');
  for (const to of ['arrived', 'in_consultation', 'completed']) {
    const r = await doc.post(`/en/dashboard/appointments/${apptId}/status`, { to });
    assert.equal(r.status, 303);
    assert.ok(!r.location!.includes('error'), `${to}: ${r.location}`);
  }
  const { rows: st } = await h.db.query<{ status: string }>('select status from appointments where id = $1', [apptId]);
  assert.equal(st[0]!.status, 'completed');

  // Suspension hides the doctor and signs them out.
  await a.get(`/en/admin/doctors/${d[0]!.user_id}`);
  await a.post(`/en/admin/doctors/${d[0]!.user_id}/suspend`, { note: 'Card expired' });
  assert.equal((await anon.get(`/en/doctors/${d[0]!.slug}`)).status, 404);
  assert.equal((await doc.get('/en/dashboard')).status, 303);
});

test('time off removes those days from availability', async () => {
  const { rows } = await h.db.query<{ slug: string; phone_e164: string }>(
    `select d.slug, u.phone_e164 from doctors d join users u on u.id = d.user_id where d.verification_status = 'suspended' limit 1`,
  );
  // Reinstate the doctor from the previous test to reuse their schedule.
  await h.db.query(`update doctors set verification_status = 'approved' where slug = $1`, [rows[0]!.slug]);
  const doc = new Client(h.baseUrl);
  await login(doc, rows[0]!.phone_e164, 'knee-surgeon-2026');
  await doc.get('/en/dashboard/hours');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const tomorrow = new Date(Date.now() + 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  assert.equal((await doc.post('/en/dashboard/hours/blocks', { fromDate: today, toDate: tomorrow, note: 'Conference' })).status, 303);
  const page = await new Client(h.baseUrl).get(`/en/doctors/${rows[0]!.slug}`);
  assert.ok(!page.body.includes(`date=${today}`) && !page.body.includes(`date=${tomorrow}`));
  assert.equal((await doc.post('/en/dashboard/hours/blocks', { fromDate: tomorrow, toDate: today, note: '' })).status, 422);
});
