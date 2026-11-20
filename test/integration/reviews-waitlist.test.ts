import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, firstSlotStart, type Harness } from '../helpers.js';
import { addDays, todayIn, weekdayOf, zonedToUtc } from '../../src/domain/time.js';
import { deliverPending } from '../../src/services/outbox.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

/** A visit in the past, already marked completed by the doctor. */
async function completedVisit(doctor: { id: string; clinicId: string }, patientId: string, daysAgo = 3): Promise<string> {
  const start = new Date(Date.now() - daysAgo * 86400_000);
  start.setUTCMinutes(0, 0, 0);
  const { rows } = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, status, fee_egp)
     values ($1, $2, $3, $4, $5, 'new', 'completed', 400) returning id`,
    [doctor.id, doctor.clinicId, patientId, start, new Date(start.getTime() + 30 * 60000)],
  );
  return rows[0]!.id;
}

test('a patient reviews their own completed visit; it shows on the profile and in search with a short name', async () => {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Review Target' });
  const patient = await createPatient(h.db);
  await h.db.query(`update users set full_name = 'Nour Hassan' where id = $1`, [patient.id]);
  const visit = await completedVisit(doctor, patient.id);
  const c = new Client(h.baseUrl);
  await login(c, patient.phone, patient.password);

  const list = await c.get('/en/appointments');
  assert.match(list.body, /Rate visit/);
  assert.match(list.body, /Book again/);

  const form = await c.get(`/en/appointments/${visit}/review`);
  assert.equal(form.status, 200);
  const bad = await c.post(`/en/appointments/${visit}/review`, { rating: '6', comment: '' });
  assert.equal(bad.status, 422, 'ratings outside 1–5 are refused');

  const ok = await c.post(`/en/appointments/${visit}/review`, { rating: '5', comment: 'Explained everything clearly.' });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/en/appointments?ok=reviewSaved');

  // Editing replaces the same review instead of adding a second one.
  await c.get(`/en/appointments/${visit}/review`);
  await c.post(`/en/appointments/${visit}/review`, { rating: '4', comment: 'Explained everything clearly.' });
  const { rows } = await h.db.query<{ rating: number }>('select rating from reviews where appointment_id = $1', [visit]);
  assert.deepEqual(rows, [{ rating: 4 }]);

  const profile = await c.get(`/en/doctors/${doctor.slug}`);
  assert.match(profile.body, /Explained everything clearly\./);
  assert.match(profile.body, /Nour H\./, 'first name and last initial only');
  assert.ok(!profile.body.includes('Nour Hassan'), 'the full name is never shown');
  assert.match(profile.body, /4\.0 out of 5 from 1 review/);

  const search = await c.get('/en/search?q=Review%20Target');
  assert.match(search.body, /4\.0 out of 5 from 1 review/);
});

test('reviews are refused for visits that are not completed, and for other people’s visits', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const owner = await createPatient(h.db);
  const other = await createPatient(h.db);
  const visit = await completedVisit(doctor, owner.id);
  await h.db.query(`update appointments set status = 'no_show' where id = $1`, [visit]);

  const c = new Client(h.baseUrl);
  await login(c, owner.phone, owner.password);
  await c.get('/en/appointments');
  const notCompleted = await c.post(`/en/appointments/${visit}/review`, { rating: '1', comment: '' });
  assert.equal(notCompleted.status, 303);
  assert.match(notCompleted.location!, /error=review\.onlyCompleted/);

  await h.db.query(`update appointments set status = 'completed' where id = $1`, [visit]);
  const intruder = new Client(h.baseUrl);
  await login(intruder, other.phone, other.password);
  await intruder.get('/en/appointments');
  const foreign = await intruder.post(`/en/appointments/${visit}/review`, { rating: '1', comment: 'Fake' });
  assert.equal(foreign.status, 404, 'someone else’s visit looks like it does not exist');
  const page = await intruder.get(`/en/appointments/${visit}/review`);
  assert.equal(page.status, 404);
  const { rows } = await h.db.query('select 1 from reviews where appointment_id = $1', [visit]);
  assert.equal(rows.length, 0);

  // Doctors cannot post reviews at all.
  const dc = new Client(h.baseUrl);
  await login(dc, doctor.phone, doctor.password);
  await dc.get('/en/dashboard');
  const asDoctor = await dc.post(`/en/appointments/${visit}/review`, { rating: '5', comment: '' });
  assert.equal(asDoctor.status, 403);
});

test('an admin can hide and restore a review, with a required reason; the doctor sees their rating', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db);
  const visit = await completedVisit(doctor, patient.id);
  const pc = new Client(h.baseUrl);
  await login(pc, patient.phone, patient.password);
  await pc.get(`/en/appointments/${visit}/review`);
  await pc.post(`/en/appointments/${visit}/review`, { rating: '2', comment: 'Rude words here' });
  const { rows } = await h.db.query<{ id: string }>('select id from reviews where appointment_id = $1', [visit]);
  const reviewId = rows[0]!.id;

  const dc = new Client(h.baseUrl);
  await login(dc, doctor.phone, doctor.password);
  const dash = await dc.get('/en/dashboard');
  assert.match(dash.body, /Patient rating/);
  assert.match(dash.body, /2\.0 out of 5 from 1 review/);

  const admin = await createAdmin(h.db);
  const ac = new Client(h.baseUrl);
  await login(ac, admin.phone, admin.password);
  const page = await ac.get('/en/admin/reviews');
  assert.match(page.body, /Rude words here/);
  const noReason = await ac.post(`/en/admin/reviews/${reviewId}/hide`, { reason: '' });
  assert.match(noReason.location!, /error=review\.hideReasonRequired/);
  const hide = await ac.post(`/en/admin/reviews/${reviewId}/hide`, { reason: 'Insults' });
  assert.equal(hide.location, '/en/admin/reviews?ok=done');
  const profile = await pc.get(`/en/doctors/${doctor.slug}`);
  assert.ok(!profile.body.includes('Rude words here'), 'hidden reviews are not shown');
  assert.match(profile.body, /No reviews yet/);

  // The author editing a hidden review does not make it visible again.
  await pc.get(`/en/appointments/${visit}/review`);
  await pc.post(`/en/appointments/${visit}/review`, { rating: '3', comment: 'Edited' });
  const after = await h.db.query<{ status: string }>('select status from reviews where id = $1', [reviewId]);
  assert.equal(after.rows[0]!.status, 'hidden');

  await ac.get('/en/admin/reviews');
  await ac.post(`/en/admin/reviews/${reviewId}/show`, {});
  assert.match((await pc.get(`/en/doctors/${doctor.slug}`)).body, /Edited/);

  // Patients cannot reach the admin page.
  assert.equal((await pc.get('/en/admin/reviews')).status, 403);
});

/** A doctor with exactly one 30-minute slot, tomorrow at 10:00 (Cairo). */
async function oneSlotDoctor() {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. One Slot' });
  const tz = h.deps.cfg.TIME_ZONE;
  const date = addDays(todayIn(tz, new Date()), 1);
  await h.db.query('delete from schedule_rules where clinic_id = $1', [doctor.clinicId]);
  await h.db.query(`insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, '10:00', '10:30', 30)`, [
    doctor.clinicId,
    weekdayOf(date),
  ]);
  return { ...doctor, date, start: zonedToUtc(date, '10:00', tz) };
}

test('waitlist: a full day is offered, the waiter is told when a place opens, and booking closes the entry', async () => {
  const doctor = await oneSlotDoctor();
  const first = await createPatient(h.db);
  const waiter = await createPatient(h.db);

  const a = new Client(h.baseUrl);
  await login(a, first.phone, first.password);
  const slot = await firstSlotStart(a, doctor.slug, 0);
  assert.equal(new Date(slot.start).getTime(), doctor.start.getTime());
  await a.get(`/en/book?doctor=${doctor.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.equal((await a.post('/en/book', { clinic: slot.clinic, start: slot.start, visitType: 'new' })).status, 303);

  // Visitors who are signed out are sent to sign in first.
  const anon = await new Client(h.baseUrl).get(`/en/doctors/${doctor.slug}`);
  assert.match(anon.body, /Fully booked days/);
  assert.match(anon.body, /href="\/en\/login\?next=/);

  const w = new Client(h.baseUrl);
  await login(w, waiter.phone, waiter.password);
  const profile = await w.get(`/en/doctors/${doctor.slug}`);
  assert.match(profile.body, /Fully booked days/);
  assert.match(profile.body, new RegExp(`name="date" value="${doctor.date}"`));

  const join = await w.post('/en/waitlist', { clinic: doctor.clinicId, date: doctor.date });
  assert.equal(join.status, 303);
  assert.match(join.location!, /ok=waitlistJoined/);
  assert.match((await w.get(`/en/doctors/${doctor.slug}`)).body, /On the waitlist/);
  const again = await w.post('/en/waitlist', { clinic: doctor.clinicId, date: doctor.date });
  assert.match(again.location!, /error=waitlist\.already/);
  assert.match((await w.get('/en/appointments')).body, /Waiting for a place/);

  // The first patient cancels: the waiter is told by SMS and on their appointments page.
  const { rows } = await h.db.query<{ id: string }>('select id from appointments where doctor_id = $1 and patient_id = $2', [doctor.id, first.id]);
  await a.get('/en/appointments');
  assert.equal((await a.post(`/en/appointments/${rows[0]!.id}/cancel`, {})).location, '/en/appointments?ok=cancelled');
  await deliverPending(h.db, h.sms);
  const sms = h.sms.sent.find((m) => m.to === waiter.phone && m.body.includes('a place opened with Dr. One Slot'));
  assert.ok(sms, 'waiter got an SMS');
  assert.ok(sms!.body.includes(`date=${doctor.date}`), 'the SMS links straight to that day');
  const list = await w.get('/en/appointments');
  assert.match(list.body, /A place opened up/);

  // The waiter books the freed slot; their waitlist entry closes.
  await w.get(`/en/book?doctor=${doctor.slug}&clinic=${doctor.clinicId}&start=${encodeURIComponent(doctor.start.toISOString())}`);
  assert.equal((await w.post('/en/book', { clinic: doctor.clinicId, start: doctor.start.toISOString(), visitType: 'new' })).status, 303);
  const entry = await h.db.query<{ status: string }>('select status from waitlist_entries where patient_id = $1', [waiter.id]);
  assert.equal(entry.rows[0]!.status, 'booked');
});

test('waitlist refuses days that still have free times, days off, and more than 3 days at once', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db);
  const c = new Client(h.baseUrl);
  await login(c, patient.phone, patient.password);
  await c.get(`/en/doctors/${doctor.slug}`);
  const tz = h.deps.cfg.TIME_ZONE;
  const tomorrow = addDays(todayIn(tz, new Date()), 1);
  const free = await c.post('/en/waitlist', { clinic: doctor.clinicId, date: tomorrow });
  assert.match(free.location!, /error=waitlist\.hasSlots/);

  // A day off is not "full": nothing would ever open up.
  await h.db.query(`insert into schedule_blocks (doctor_id, starts_at, ends_at) values ($1, $2, $3)`, [
    doctor.id,
    zonedToUtc(addDays(tomorrow, 1), '00:00', tz),
    zonedToUtc(addDays(tomorrow, 2), '00:00', tz),
  ]);
  const off = await c.post('/en/waitlist', { clinic: doctor.clinicId, date: addDays(tomorrow, 1) });
  assert.match(off.location!, /error=waitlist\.notAvailable/);

  // The limit counts active entries.
  for (let i = 0; i < 3; i++) {
    await h.db.query(`insert into waitlist_entries (patient_id, doctor_id, clinic_id, wanted_date) values ($1, $2, $3, $4)`, [
      patient.id,
      doctor.id,
      doctor.clinicId,
      addDays(tomorrow, 3 + i),
    ]);
  }
  const tooMany = await c.post('/en/waitlist', { clinic: doctor.clinicId, date: tomorrow });
  assert.match(tooMany.location!, /error=waitlist\.tooMany/);

  // Leaving works only for your own entries.
  const { rows } = await h.db.query<{ id: string }>('select id from waitlist_entries where patient_id = $1 limit 1', [patient.id]);
  const other = await createPatient(h.db);
  const o = new Client(h.baseUrl);
  await login(o, other.phone, other.password);
  await o.get('/en/appointments');
  assert.equal((await o.post(`/en/waitlist/${rows[0]!.id}/leave`, {})).status, 404);
  assert.equal((await c.post(`/en/waitlist/${rows[0]!.id}/leave`, {})).location, '/en/appointments?ok=waitlistLeft');
});

test('the signed-in patient home shows quick actions, the next visit and one-tap rebooking', async () => {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Rebook Me' });
  const patient = await createPatient(h.db);
  await completedVisit(doctor, patient.id, 10);
  const c = new Client(h.baseUrl);
  await login(c, patient.phone, patient.password);
  const home = await c.get('/en');
  assert.match(home.body, /Welcome back/);
  assert.match(home.body, /Dr\. Rebook Me/);
  assert.match(home.body, new RegExp(`/en/doctors/${doctor.slug}\\?clinic=${doctor.clinicId}#book-title`));
  assert.match(home.body, /class="tabbar"/, 'patients get the bottom tab bar');

  const visitor = await new Client(h.baseUrl).get('/en');
  assert.ok(!visitor.body.includes('Welcome back'));
  assert.ok(!visitor.body.includes('class="tabbar"'));
});
