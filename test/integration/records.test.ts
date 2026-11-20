import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createAdmin, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const count = async (sql: string, params: unknown[] = []) => (await h.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0]!.n;

async function appointment(doctor: { id: string; clinicId: string }, patientId: string, daysAhead: number) {
  const start = new Date(Date.now() + daysAhead * 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const { rows } = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp)
     values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [doctor.id, doctor.clinicId, patientId, start, new Date(start.getTime() + 30 * 60_000)],
  );
  return rows[0]!.id;
}

async function signedInDoctor(enabled = true) {
  const d = await createApprovedDoctor(h.db);
  if (enabled) await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  return { ...d, c };
}

const walkIn = {
  fullName: 'Mona Adel', phone: '01011112222', dateOfBirth: '1990-05-20', sex: 'female', occupation: 'Teacher', maritalStatus: 'married',
  habits: ['shisha', 'caffeine'], habitsNote: 'Shisha weekly', allergies: 'Penicillin', chronicConditions: 'Hypothyroidism', pastHistory: 'Appendectomy 2015',
  currentMedications: 'Eltroxin 50 mcg', familyHistory: 'Father diabetic', consent: 'yes',
};

const rxLines = (lines: Partial<Record<'medicine' | 'form' | 'dose' | 'frequency' | 'timing' | 'duration' | 'instructions', string>>[]) => {
  const keys = ['medicine', 'form', 'dose', 'frequency', 'timing', 'duration', 'instructions'] as const;
  return Object.fromEntries(keys.map((k) => [`rx_${k}`, lines.map((l) => l[k] ?? '')]));
};

test('records are off by default and switched on per doctor by an admin', async () => {
  const doc = await signedInDoctor(false);
  assert.equal((await doc.c.get('/en/dashboard/patients')).status, 404);
  assert.doesNotMatch((await doc.c.get('/en/dashboard')).body, /dashboard\/patients/);

  const admin = await createAdmin(h.db);
  const a = new Client(h.baseUrl);
  await login(a, admin.phone, admin.password);
  const page = await a.get(`/en/admin/doctors/${doc.id}`);
  assert.match(page.body, /Clinical records/);
  assert.equal((await a.post(`/en/admin/doctors/${doc.id}/records`, { on: 'yes' })).status, 303);
  assert.equal((await doc.c.get('/en/dashboard/patients')).status, 200);
  assert.match((await doc.c.get('/en/dashboard')).body, /dashboard\/patients/);
  assert.equal(await count(`audit_log where action = 'records.enable' and entity_id = $1`, [doc.id]), 1);

  // Only admins can flip the switch.
  assert.equal((await doc.c.post(`/en/admin/doctors/${doc.id}/records`, { on: 'no' })).status, 403);
  assert.equal((await a.post(`/en/admin/doctors/${doc.id}/records`, { on: 'no' })).status, 303);
  assert.equal((await doc.c.get('/en/dashboard/patients')).status, 404);
});

test('walk-in file, visit with prescription and lab order, saved together or not at all', async () => {
  const doc = await signedInDoctor();
  await doc.c.get('/en/dashboard/patients/new');

  const noConsent = await doc.c.post('/en/dashboard/patients', { ...walkIn, consent: '' });
  assert.equal(noConsent.status, 422);
  assert.match(noConsent.body, /Confirm the patient agreed/);
  const future = await doc.c.post('/en/dashboard/patients', { ...walkIn, dateOfBirth: '2999-01-01' });
  assert.equal(future.status, 422);
  assert.match(future.body, /real date of birth/);
  assert.equal(await count('patient_records where doctor_id = $1', [doc.id]), 0);

  const created = await doc.c.post('/en/dashboard/patients', walkIn);
  assert.equal(created.status, 303);
  const recordId = /patients\/([0-9a-f-]{36})/.exec(created.location!)![1]!;
  const file = await doc.c.get(`/en/dashboard/patients/${recordId}`);
  assert.equal(file.status, 200);
  assert.match(file.body, /Mona Adel/);
  assert.match(file.body, /Penicillin/, 'allergies shown prominently');
  assert.match(file.body, /\d+ years · Female/);
  assert.match(file.body, /Shisha/);
  assert.equal(await count(`audit_log where action = 'record.view' and entity_id = $1`, [recordId]), 1);

  // A bad prescription line or a missing complaint saves nothing at all.
  await doc.c.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const badLine = await doc.c.post(`/en/dashboard/patients/${recordId}/visits`, {
    complaint: 'Sore throat', diagnosis: 'Tonsillitis', lab_code: ['cbc'],
    ...rxLines([{ medicine: 'Augmentin 1 g', form: 'tablet', dose: '1 tablet', frequency: 'twice_daily' }, { medicine: 'Brufen 400', form: 'tablet' }, {}]),
  });
  assert.equal(badLine.status, 422);
  assert.match(badLine.body, /Medicine 2: fill in the medicine, form, dose and how often/);
  assert.match(badLine.body, /value="Brufen 400"/, 'typed lines are kept');
  const noComplaint = await doc.c.post(`/en/dashboard/patients/${recordId}/visits`, { complaint: '', ...rxLines([{ medicine: 'X', form: 'tablet', dose: '1', frequency: 'once_daily' }]) });
  assert.equal(noComplaint.status, 422);
  assert.equal(await count('encounters where record_id = $1', [recordId]), 0);
  assert.equal(await count('prescriptions where doctor_id = $1', [doc.id]), 0);

  const ok = await doc.c.post(`/en/dashboard/patients/${recordId}/visits`, {
    complaint: 'Sore throat and fever for 3 days', history: 'Started after a cold', examination: 'Temp 38.5, enlarged tonsils',
    diagnosis: 'Acute tonsillitis', plan: 'Antibiotic, fluids, review in 1 week',
    ...rxLines([
      { medicine: 'Augmentin 1 g', form: 'tablet', dose: '1 tablet', frequency: 'twice_daily', timing: 'after_meals', duration: '7 days' },
      {},
      { medicine: 'Panadol Extra', form: 'tablet', dose: '1 tablet', frequency: 'as_needed', instructions: 'For fever above 38' },
    ]),
    rx_notes: 'Warm fluids',
    lab_code: ['cbc', 'crp'], lab_other: 'Throat swab culture\n\n', lab_notes: 'Before antibiotics',
  });
  assert.equal(ok.status, 303);
  const visitId = /visits\/([0-9a-f-]{36})/.exec(ok.location!)![1]!;
  const visit = await doc.c.get(`/en/dashboard/visits/${visitId}`);
  assert.match(visit.body, /Acute tonsillitis/);
  assert.match(visit.body, /Augmentin 1 g/);
  assert.match(visit.body.replace(/<\/?bdi>/g, ''), /1 tablet · Twice a day · After meals · for 7 days/);
  assert.match(visit.body, /Throat swab culture/);
  assert.deepEqual(
    (await h.db.query<{ medicine: string; position: number }>('select medicine, position from prescription_items i join prescriptions p on p.id = i.prescription_id where p.encounter_id = $1 order by position', [visitId])).rows,
    [{ medicine: 'Augmentin 1 g', position: 1 }, { medicine: 'Panadol Extra', position: 2 }],
    'blank lines skipped, order kept',
  );
  assert.equal(await count('lab_order_items i join lab_orders l on l.id = i.lab_order_id where l.encounter_id = $1', [visitId]), 3);

  // Medicines are learned and suggested next time.
  const next = await doc.c.get(`/en/dashboard/patients/${recordId}/visits/new`);
  assert.match(next.body, /<option value="Augmentin 1 g" data-form="tablet">/);

  // Printing.
  const rxId = (await h.db.query<{ id: string }>('select id from prescriptions where encounter_id = $1', [visitId])).rows[0]!.id;
  const print = await doc.c.get(`/en/dashboard/prescriptions/${rxId}/print`);
  assert.equal(print.status, 200);
  assert.match(print.body, /Mona Adel/);
  assert.match(print.body, /Warm fluids/);
  assert.match((await doc.c.get(`/dashboard/prescriptions/${rxId}/print`)).body, /روشتة/);

  // Editing notes keeps the earlier version.
  assert.equal((await doc.c.post(`/en/dashboard/visits/${visitId}`, { complaint: 'Sore throat', diagnosis: 'Streptococcal tonsillitis' })).status, 303);
  assert.equal(await count(`record_revisions where entity_type = 'encounter' and entity_id = $1`, [visitId]), 1);
  assert.equal((await doc.c.post(`/en/dashboard/visits/${visitId}`, { complaint: '' })).status, 422);
  // Editing the file keeps the earlier version too.
  assert.equal((await doc.c.post(`/en/dashboard/patients/${recordId}`, { ...walkIn, occupation: 'Headteacher' })).status, 303);
  assert.equal(await count(`record_revisions where entity_type = 'patient_record' and entity_id = $1`, [recordId]), 1);

  // Cancelling needs a reason; issued lines can never be edited, even directly in the database.
  const noReason = await doc.c.post(`/en/dashboard/prescriptions/${rxId}/void`, { reason: '' });
  assert.match(noReason.location!, /error=rx\.err\.voidReason/);
  assert.equal((await doc.c.post(`/en/dashboard/prescriptions/${rxId}/void`, { reason: 'Wrong strength' })).status, 303);
  assert.equal((await h.db.query<{ status: string }>('select status from prescriptions where id = $1', [rxId])).rows[0]!.status, 'voided');
  await assert.rejects(h.db.query(`update prescription_items set dose = '2 tablets' where prescription_id = $1`, [rxId]));
  await assert.rejects(h.db.query(`update prescriptions set status = 'active', voided_at = null where id = $1`, [rxId]));
  await assert.rejects(h.db.query('delete from prescriptions where id = $1', [rxId]));
  assert.match((await doc.c.get(`/en/dashboard/prescriptions/${rxId}/print`)).body, /CANCELLED/);

  // Searching the list.
  assert.match((await doc.c.get('/en/dashboard/patients?q=mona')).body, /Mona Adel/);
  assert.match((await doc.c.get('/en/dashboard/patients?q=01011112222')).body, /Mona Adel/);
  assert.doesNotMatch((await doc.c.get('/en/dashboard/patients?q=zzz')).body, /Mona Adel/);
  assert.equal((await doc.c.get('/en/dashboard/patients?q=%25')).status, 200);
});

test('booked patient: file from the appointment, prescription in the patient account, never the notes', async () => {
  const doc = await signedInDoctor();
  const patient = await createPatient(h.db);
  const apptId = await appointment(doc, patient.id, 1);

  const today = await doc.c.get('/en/dashboard?date=' + new Date(Date.now() + 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }));
  assert.match(today.body, new RegExp(`/en/dashboard/appointments/${apptId}/file`));

  const start = await doc.c.get(`/en/dashboard/appointments/${apptId}/file`);
  assert.equal(start.status, 200);
  assert.match(start.body, /value="Test Patient"/);
  const created = await doc.c.post('/en/dashboard/patients', { fullName: 'Test Patient', consent: 'yes', appointment: apptId });
  assert.equal(created.status, 303);
  assert.match(created.location!, new RegExp(`visits/new\\?appointment=${apptId}`));
  // Opening it again goes straight to the existing file; no duplicate.
  assert.match((await doc.c.get(`/en/dashboard/appointments/${apptId}/file`)).location!, /visits\/new/);
  assert.equal(await count('patient_records where doctor_id = $1 and patient_user_id = $2', [doc.id, patient.id]), 1);
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where patient_user_id = $1', [patient.id])).rows[0]!.id;

  await doc.c.get(`/en/dashboard/patients/${recordId}/visits/new?appointment=${apptId}`);
  const saved = await doc.c.post(`/en/dashboard/patients/${recordId}/visits`, {
    appointment: apptId, complaint: 'SECRET-COMPLAINT', diagnosis: 'SECRET-DIAGNOSIS',
    ...rxLines([{ medicine: 'Nexium 40 mg', form: 'capsule', dose: '1 capsule', frequency: 'once_daily', timing: 'empty_stomach', duration: '1 month' }]),
    lab_code: ['h_pylori'],
  });
  assert.equal(saved.status, 303);
  assert.equal((await h.db.query<{ clinic_id: string }>('select clinic_id from encounters where appointment_id = $1', [apptId])).rows[0]!.clinic_id, doc.clinicId);
  const again = await doc.c.post(`/en/dashboard/patients/${recordId}/visits`, { appointment: apptId, complaint: 'x' });
  assert.equal(again.status, 422);
  assert.match(again.body, /already has a visit/);

  const p = new Client(h.baseUrl);
  await login(p, patient.phone, patient.password);
  const docs = await p.get('/en/prescriptions');
  assert.equal(docs.status, 200);
  assert.match(docs.body, /Prescription ·/);
  assert.match(docs.body, /Lab and imaging request ·/);
  assert.doesNotMatch(docs.body, /SECRET/);
  const rxId = (await h.db.query<{ id: string }>(`select p.id from prescriptions p join encounters e on e.id = p.encounter_id where e.appointment_id = $1`, [apptId])).rows[0]!.id;
  const sheet = await p.get(`/en/prescriptions/${rxId}`);
  assert.equal(sheet.status, 200);
  assert.match(sheet.body, /Nexium 40 mg/);
  assert.doesNotMatch(sheet.body, /SECRET/);
  assert.match((await p.get('/en/appointments')).body, /\/en\/prescriptions/);

  // Once cancelled, it disappears from the patient's account.
  await doc.c.post(`/en/dashboard/prescriptions/${rxId}/void`, { reason: 'Replaced' });
  assert.doesNotMatch((await p.get('/en/prescriptions')).body, /Prescription ·/);
  assert.equal((await p.get(`/en/prescriptions/${rxId}`)).status, 404);
});

test('access control: other doctors and other patients get nothing', async () => {
  const owner = await signedInDoctor();
  const patient = await createPatient(h.db);
  const apptId = await appointment(owner, patient.id, 2);
  await owner.c.get(`/en/dashboard/appointments/${apptId}/file`);
  await owner.c.post('/en/dashboard/patients', { fullName: 'Private Patient', consent: 'yes', appointment: apptId });
  const recordId = (await h.db.query<{ id: string }>('select id from patient_records where doctor_id = $1', [owner.id])).rows[0]!.id;
  await owner.c.get(`/en/dashboard/patients/${recordId}/visits/new`);
  const v = await owner.c.post(`/en/dashboard/patients/${recordId}/visits`, {
    complaint: 'Headache', ...rxLines([{ medicine: 'Cataflam 50', form: 'tablet', dose: '1', frequency: 'three_daily' }]), lab_code: ['cbc'],
  });
  const visitId = /visits\/([0-9a-f-]{36})/.exec(v.location!)![1]!;
  const rxId = (await h.db.query<{ id: string }>('select id from prescriptions where encounter_id = $1', [visitId])).rows[0]!.id;
  const labId = (await h.db.query<{ id: string }>('select id from lab_orders where encounter_id = $1', [visitId])).rows[0]!.id;

  const other = await signedInDoctor();
  await other.c.get('/en/dashboard/patients');
  for (const path of [`/en/dashboard/patients/${recordId}`, `/en/dashboard/patients/${recordId}/edit`, `/en/dashboard/patients/${recordId}/visits/new`,
    `/en/dashboard/visits/${visitId}`, `/en/dashboard/prescriptions/${rxId}/print`, `/en/dashboard/lab-orders/${labId}/print`, `/en/dashboard/appointments/${apptId}/file`]) {
    assert.equal((await other.c.get(path)).status, 404, path);
  }
  for (const [path, body] of [
    [`/en/dashboard/patients/${recordId}`, { fullName: 'Hacked' }],
    [`/en/dashboard/patients/${recordId}/visits`, { complaint: 'x' }],
    [`/en/dashboard/visits/${visitId}`, { complaint: 'x' }],
    [`/en/dashboard/visits/${visitId}/prescriptions`, rxLines([{ medicine: 'X', form: 'tablet', dose: '1', frequency: 'once_daily' }])],
    [`/en/dashboard/visits/${visitId}/lab-orders`, { lab_code: ['cbc'] }],
    [`/en/dashboard/prescriptions/${rxId}/void`, { reason: 'Not mine' }],
    [`/en/dashboard/lab-orders/${labId}/void`, { reason: 'Not mine' }],
    ['/en/dashboard/patients', { fullName: 'Steal', consent: 'yes', appointment: apptId }],
  ] as const) {
    assert.equal((await other.c.post(path, body as Record<string, string | string[]>)).status, 404, path);
  }
  assert.doesNotMatch((await other.c.get('/en/dashboard/patients?q=Private')).body, /Private Patient/);
  assert.equal((await h.db.query<{ full_name: string }>('select full_name from patient_records where id = $1', [recordId])).rows[0]!.full_name, 'Private Patient');
  assert.equal((await h.db.query<{ status: string }>('select status from prescriptions where id = $1', [rxId])).rows[0]!.status, 'active');

  // The owner cannot attach another patient's appointment to this file.
  const stranger = await createPatient(h.db);
  const strangerAppt = await appointment(owner, stranger.id, 3);
  assert.equal((await owner.c.post(`/en/dashboard/patients/${recordId}/visits`, { appointment: strangerAppt, complaint: 'x' })).status, 404);

  // Another patient sees nothing; a patient cannot open the doctor pages; visitors must sign in.
  const p2 = new Client(h.baseUrl);
  await login(p2, stranger.phone, stranger.password);
  assert.equal((await p2.get(`/en/prescriptions/${rxId}`)).status, 404);
  assert.equal((await p2.get(`/en/lab-orders/${labId}`)).status, 404);
  assert.doesNotMatch((await p2.get('/en/prescriptions')).body, /Cataflam/);
  assert.equal((await p2.get(`/en/dashboard/patients/${recordId}`)).status, 403);
  const anon = new Client(h.baseUrl);
  assert.equal((await anon.get(`/en/dashboard/patients/${recordId}`)).status, 303);
  assert.equal((await anon.get(`/en/prescriptions/${rxId}`)).status, 303);
  assert.equal((await anon.get('/en/prescriptions')).status, 303);

  // Bad ids are "not found", not errors.
  assert.equal((await owner.c.get('/en/dashboard/patients/not-a-uuid')).status, 404);
  assert.equal((await owner.c.get('/en/dashboard/patients/new?appointment=x')).status, 200);
  assert.equal((await owner.c.get(`/en/dashboard/patients/${recordId}/visits/new?appointment=x`)).status, 404);
});

test('a walk-in file can be linked to the patient when they later book', async () => {
  const doc = await signedInDoctor();
  const patient = await createPatient(h.db);
  await doc.c.get('/en/dashboard/patients/new');
  const created = await doc.c.post('/en/dashboard/patients', { fullName: 'Walk In Then Booked', phone: '0' + patient.phone.slice(3), consent: 'yes' });
  const walkInId = /patients\/([0-9a-f-]{36})/.exec(created.location!)![1]!;
  const apptId = await appointment(doc, patient.id, 4);

  const page = await doc.c.get(`/en/dashboard/appointments/${apptId}/file`);
  assert.match(page.body, /Already seen as a walk-in/);
  assert.match(page.body, /Walk In Then Booked/);
  const linked = await doc.c.post(`/en/dashboard/patients/${walkInId}/link`, { appointment: apptId });
  assert.equal(linked.status, 303);
  assert.equal((await h.db.query<{ patient_user_id: string }>('select patient_user_id from patient_records where id = $1', [walkInId])).rows[0]!.patient_user_id, patient.id);
  assert.match((await doc.c.get(`/en/dashboard/appointments/${apptId}/file`)).location!, new RegExp(walkInId));

  // A file already linked to someone else cannot be relinked.
  const other = await createPatient(h.db);
  const otherAppt = await appointment(doc, other.id, 5);
  const refused = await doc.c.post(`/en/dashboard/patients/${walkInId}/link`, { appointment: otherAppt });
  assert.match(refused.location!, /error=records\.err\.alreadyLinked/);
});

test('Arabic pages render', async () => {
  const doc = await signedInDoctor();
  await doc.c.get('/dashboard/patients/new');
  const created = await doc.c.post('/dashboard/patients', { ...walkIn, fullName: 'منى عادل' });
  const recordId = /patients\/([0-9a-f-]{36})/.exec(created.location!)![1]!;
  const file = await doc.c.get(`/dashboard/patients/${recordId}`);
  assert.match(file.body, /منى عادل/);
  assert.match(file.body, /الحساسية/);
  assert.match(file.body, /أنثى/);
  const form = await doc.c.get(`/dashboard/patients/${recordId}/visits/new`);
  assert.match(form.body, /الشكوى الرئيسية/);
  assert.match(form.body, /مرتين يوميًا/);
  assert.match(form.body, /صورة دم كاملة/);
});
