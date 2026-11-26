import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, firstSlotStart, login, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function signedIn(phone: string, password: string) {
  const c = new Client(h.baseUrl);
  await login(c, phone, password);
  return c;
}

test('a doctor can leave the prices empty: patients see "Price at the clinic", booking and payments still work', async () => {
  const d = await createApprovedDoctor(h.db);
  const dc = await signedIn(d.phone, d.password);
  const form = await dc.get('/en/dashboard/clinics');
  assert.match(form.body, /Consultation fee \(EGP, optional\)/);
  const district = (await h.db.query<{ district_id: number }>('select district_id from clinics where id = $1', [d.clinicId])).rows[0]!.district_id;
  const saved = await dc.post(`/en/dashboard/clinics/${d.clinicId}`, { name: 'Test Clinic', district: String(district), address: 'Test street 1', fee: '', followUpFee: '', followUpDays: '14', phone: '', active: 'yes' });
  assert.equal(saved.status, 303, saved.body.slice(0, 300));
  assert.equal((await h.db.query<{ fee_egp: number | null }>('select fee_egp from clinics where id = $1', [d.clinicId])).rows[0]!.fee_egp, null);
  // A typo is still caught.
  assert.equal((await dc.post(`/en/dashboard/clinics/${d.clinicId}`, { name: 'Test Clinic', district: String(district), address: 'Test street 1', fee: 'abc', followUpDays: '14', active: 'yes' })).status, 422);

  const visitor = new Client(h.baseUrl);
  const profile = await visitor.get(`/en/doctors/${d.slug}`);
  assert.equal(profile.status, 200);
  assert.match(profile.body, /Price at the clinic/);
  assert.doesNotMatch(profile.body, /"priceRange"/);

  // InstaPay needs an amount, so it isn't offered (or accepted) without a price.
  await h.db.query("update doctors set instapay_address = 'drtest@instapay' where user_id = $1", [d.id]);
  const p = await createPatient(h.db);
  const pc = await signedIn(p.phone, p.password);
  const slot = await firstSlotStart(pc, d.slug);
  const book = await pc.get(`/en/book?doctor=${d.slug}&clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(book.body, /Price at the clinic/);
  assert.doesNotMatch(book.body, /value="instapay"/);
  assert.equal((await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '', pay: 'instapay' })).status, 409);
  const booked = await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, reason: '' });
  assert.equal(booked.status, 303, booked.body.slice(0, 300));
  const a = (await h.db.query<{ id: string; fee_egp: number | null }>('select id, fee_egp from appointments where patient_id = $1', [p.id])).rows[0]!;
  assert.equal(a.fee_egp, null);
  assert.match((await pc.get('/en/appointments')).body, /Price at the clinic|\d/);

  // The doctor sees the visit and must type the amount when marking it paid.
  assert.equal((await dc.get('/en/dashboard')).status, 200);
  await h.db.query("update appointments set status = 'completed' where id = $1", [a.id]);
  const noAmount = await dc.post(`/en/dashboard/appointments/${a.id}/pay`, { method: 'cash', amount: '' });
  assert.match(noAmount.location ?? '', /pay\.amountRequired/);
  const paid = await dc.post(`/en/dashboard/appointments/${a.id}/pay`, { method: 'cash', amount: '350' });
  assert.doesNotMatch(paid.location ?? '', /error=/);
  assert.equal((await h.db.query<{ amount_egp: number }>('select amount_egp from payments where appointment_id = $1', [a.id])).rows[0]!.amount_egp, 350);
  assert.equal((await dc.get('/en/dashboard/income')).status, 200);
});

test('search still lists a doctor without prices', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Noprice Hassan' });
  await h.db.query('update clinics set fee_egp = null where doctor_id = $1', [d.id]);
  const res = await new Client(h.baseUrl).get('/en/search?q=Noprice');
  assert.equal(res.status, 200);
  assert.match(res.body, /Noprice/);
});
