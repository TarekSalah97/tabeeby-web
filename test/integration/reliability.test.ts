import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, firstSlotStart, type Harness } from '../helpers.js';
import { addDays, todayIn, toZoned } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const TZ = 'Africa/Cairo';
async function signedIn(person: { phone: string; password: string }) {
  const c = new Client(h.baseUrl);
  await login(c, person.phone, person.password);
  return c;
}

async function appt(d: { id: string; clinicId: string }, o: { patientId?: string; walkIn?: boolean; hoursFromNow: number; status?: string }) {
  const start = new Date(Date.now() + o.hoursFromNow * 3600_000);
  start.setUTCSeconds(0, 0);
  const { rows } = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, fee_egp, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 400, $9) returning id`,
    [d.id, d.clinicId, o.patientId ?? null, o.walkIn ? 'Walk In' : null, o.walkIn ? '+201099999999' : null, o.walkIn ? 'doctor' : 'patient',
      start, new Date(start.getTime() + 25 * 60_000), o.status ?? 'confirmed'],
  );
  return rows[0]!.id;
}
const strikeCount = async (doctorId: string) =>
  (await h.db.query<{ n: number }>("select count(*)::int as n from doctor_strikes where doctor_id = $1 and status = 'active'", [doctorId])).rows[0]!.n;

test('cancelling: the clinic cancelling an online booking is a strike; "patient asked" and walk-ins are not', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const c = await signedIn(d);
  const a1 = await appt(d, { patientId: p.id, hoursFromNow: 30 });
  const a2 = await appt(d, { patientId: p.id, hoursFromNow: 50 });
  const a3 = await appt(d, { walkIn: true, hoursFromNow: 70 });
  // The schedule of the day a1 falls on (30 hours ahead is two days away after 6 pm Cairo time).
  const a1Start = (await h.db.query<{ starts_at: Date }>('select starts_at from appointments where id = $1', [a1])).rows[0]!.starts_at;
  const day = await c.get(`/en/dashboard?date=${toZoned(a1Start, TZ).date}`);
  assert.match(day.body, /The patient asked to cancel/);

  await c.post(`/en/dashboard/appointments/${a1}/status`, { to: 'cancelled', cancelKind: 'patient_request' });
  assert.equal(await strikeCount(d.id), 0);
  assert.equal((await h.db.query<{ cancelled_by: string }>('select cancelled_by from appointments where id = $1', [a1])).rows[0]!.cancelled_by, 'patient');

  await c.post(`/en/dashboard/appointments/${a2}/status`, { to: 'cancelled', cancelKind: 'clinic' });
  assert.equal(await strikeCount(d.id), 1);
  const sms = await h.db.query<{ n: number }>('select count(*)::int as n from notification_outbox where to_phone = $1', [p.phone]);
  assert.equal(sms.rows[0]!.n, 1, 'only the clinic cancellation is texted');

  await c.post(`/en/dashboard/appointments/${a3}/status`, { to: 'cancelled' });
  assert.equal(await strikeCount(d.id), 1, 'walk-ins booked by the clinic do not count');
  assert.match((await c.get('/en/dashboard')).body, /You cancelled 1 online booking/);
});

test('at the strike limit online booking pauses (profile, search, booking) until an admin waives a strike', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Often Cancels' });
  for (let i = 0; i < 5; i++) await h.db.query("insert into doctor_strikes (doctor_id, source, created_by) values ($1, 'doctor_cancel', $1)", [d.id]);
  const p = await createPatient(h.db);
  const pc = await signedIn(p);
  const profile = await pc.get(`/en/doctors/${d.slug}`);
  assert.match(profile.body, /not taking online bookings right now/);
  assert.ok(!/href="\/en\/book\?doctor=/.test(profile.body), 'no bookable times');
  const search = await pc.get('/en/search?q=Often%20Cancels');
  assert.match(search.body, /Dr\. Often Cancels/);
  // Booking a real slot directly is refused too.
  const slotStart = new Date(Date.now() + 2 * 86400_000);
  slotStart.setUTCMinutes(slotStart.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  const tryBook = await pc.get(`/en/book?clinic=${d.clinicId}&start=${encodeURIComponent(slotStart.toISOString())}`);
  assert.match(tryBook.location ?? '', /error=booking\.doctorPaused/);
  assert.match((await (await signedIn(d)).get('/en/dashboard')).body, /Online booking paused/);

  const admin = await createAdmin(h.db);
  const ac = await signedIn(admin);
  const list = await ac.get('/en/admin/strikes');
  assert.match(list.body, /Online booking paused for:/);
  const strikeId = (await h.db.query<{ id: string }>('select id from doctor_strikes where doctor_id = $1 limit 1', [d.id])).rows[0]!.id;
  assert.match((await ac.post(`/en/admin/strikes/${strikeId}/waive`, { note: '' })).location!, /error=admin\.noteRequired/);
  assert.match((await ac.post(`/en/admin/strikes/${strikeId}/waive`, { note: 'Family emergency, verified' })).location!, /ok=waived/);
  assert.equal((await ac.post(`/en/admin/strikes/${strikeId}/waive`, { note: 'again' })).status, 404);
  const slot = await firstSlotStart(pc, d.slug);
  assert.equal((await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' })).status, 303, 'booking works again');
  // Only admins see or waive strikes.
  assert.equal((await pc.get('/en/admin/strikes')).status, 403);
});

test('closing a day cancels its bookings, tells everyone, blocks the day, and is one strike', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const c = await signedIn(d);
  const tomorrow = addDays(todayIn(TZ, new Date()), 1);
  // Two bookings tomorrow (Cairo), one online and one walk-in.
  const base = new Date(`${tomorrow}T08:00:00Z`);
  for (const [i, walkIn] of [[0, false], [2, true]] as const) {
    const start = new Date(base.getTime() + i * 3600_000);
    await h.db.query(
      `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, fee_egp)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'new', 400)`,
      [d.id, d.clinicId, walkIn ? null : p.id, walkIn ? 'Walk In' : null, walkIn ? '+201088888888' : null, walkIn ? 'doctor' : 'patient', start, new Date(start.getTime() + 1800_000)],
    );
  }
  const page = await c.get(`/en/dashboard?date=${tomorrow}`);
  assert.match(page.body, /Cancel 2 booking\(s\) and close this day/);
  assert.match((await c.post('/en/dashboard/day-off', { date: tomorrow, reason: '' })).location!, /error=dayoff\.reasonRequired/);
  assert.match((await c.post('/en/dashboard/day-off', { date: addDays(tomorrow, -3), reason: 'Sick' })).location!, /error=dayoff\.dateInvalid/);
  const res = await c.post('/en/dashboard/day-off', { date: tomorrow, reason: 'Conference' });
  assert.match(res.location!, /ok=dayCancelled/);
  const left = await h.db.query<{ n: number }>(`select count(*)::int as n from appointments where doctor_id = $1 and status = 'confirmed'`, [d.id]);
  assert.equal(left.rows[0]!.n, 0);
  const texts = await h.db.query<{ n: number }>("select count(*)::int as n from notification_outbox where to_phone = any($1::text[])", [[p.phone, '+201088888888']]);
  assert.equal(texts.rows[0]!.n, 2);
  assert.equal(await strikeCount(d.id), 1);
  // Doing it again the same day adds no second strike; nothing is bookable that day.
  await c.post('/en/dashboard/day-off', { date: tomorrow, reason: 'Still away' });
  assert.equal(await strikeCount(d.id), 1);
  const slots = await c.get(`/en/dashboard/book?date=${tomorrow}`);
  assert.match(slots.body, /No free times on this day/);
});

test('patients report a visit problem; the admin resolves it, can waive a wrong no-show and strike the doctor', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const pc = await signedIn(p);
  const missed = await appt(d, { patientId: p.id, hoursFromNow: -26, status: 'no_show' });
  const old = await appt(d, { patientId: p.id, hoursFromNow: -24 * 5, status: 'completed' });
  const future = await appt(d, { patientId: p.id, hoursFromNow: 48 });

  const list = await pc.get('/en/appointments');
  assert.match(list.body, new RegExp(`/en/appointments/${missed}/issue`));
  assert.ok(!list.body.includes(`/en/appointments/${old}/issue`), 'too old');
  assert.ok(!list.body.includes(`/en/appointments/${future}/issue`), 'not yet');
  assert.match((await pc.get(`/en/appointments/${old}/issue`)).location!, /error=issue\.windowClosed/);

  const form = await pc.get(`/en/appointments/${missed}/issue`);
  assert.match(form.body, /I was marked as missed but I came/);
  const short = await pc.post(`/en/appointments/${missed}/issue`, { category: 'wrong_no_show', description: 'no' });
  assert.equal(short.status, 422);
  assert.match(short.body, /at least 10 characters/);
  assert.match((await pc.post(`/en/appointments/${missed}/issue`, { category: 'wrong_no_show', description: 'I was there at 5pm and waited in the reception.' })).location!, /ok=issueReported/);
  assert.match((await pc.post(`/en/appointments/${missed}/issue`, { category: 'other', description: 'Another report about it' })).location!, /error=issue\.alreadyOpen/);
  assert.match((await pc.get('/en/appointments')).body, /Problem reported/);
  // Someone else's visit is "not found".
  const other = await signedIn(await createPatient(h.db));
  assert.match((await other.get(`/en/appointments/${missed}/issue`)).location ?? String((await other.get(`/en/appointments/${missed}/issue`)).status), /404|error=/);
  assert.equal((await other.post(`/en/appointments/${missed}/issue`, { category: 'other', description: 'Pretending to be them' })).status, 404);

  const admin = await createAdmin(h.db);
  const ac = await signedIn(admin);
  assert.match((await ac.get('/en/admin')).body, /1 patient issue/);
  const page = await ac.get('/en/admin/issues');
  assert.match(page.body, /waited in the reception/);
  const issueId = (await h.db.query<{ id: string }>('select id from visit_issues where appointment_id = $1', [missed])).rows[0]!.id;
  const done = await ac.post(`/en/admin/issues/${issueId}/resolve`, { note: 'Clinic confirmed you attended. Sorry!', waiveNoShow: 'yes', strikeDoctor: 'yes' });
  assert.match(done.location!, /ok=resolved/);
  assert.equal((await h.db.query<{ w: boolean }>('select no_show_waived as w from appointments where id = $1', [missed])).rows[0]!.w, true);
  assert.equal(await strikeCount(d.id), 1);
  const mine = await pc.get('/en/appointments');
  assert.match(mine.body, /Clinic confirmed you attended/);
  // A waived no-show no longer counts towards pausing online booking.
  for (const hrs of [-50, -60]) await appt(d, { patientId: p.id, hoursFromNow: hrs, status: 'no_show' });
  const slot = await firstSlotStart(pc, d.slug);
  assert.equal((await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' })).status, 303, '2 counted no-shows, not 3');
});
