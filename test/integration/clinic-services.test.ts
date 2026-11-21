import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, firstSlotStart, type Harness } from '../helpers.js';
import { addDays, todayIn } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const slotValues = (body: string) => [...body.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1]!);

async function doctorClient(opts: Parameters<typeof createApprovedDoctor>[1] = {}) {
  const d = await createApprovedDoctor(h.db, opts);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard/clinics');
  return { d, c };
}

const serviceId = async (clinicId: string, name: string) =>
  (await h.db.query<{ id: string }>('select id from clinic_services where clinic_id = $1 and name = $2', [clinicId, name])).rows[0]!.id;

test('a doctor adds, renames, re-prices and hides services; checks and suggestions', async () => {
  const { d, c } = await doctorClient({ specialty: 'dermatology' });
  const page = await c.get('/en/dashboard/clinics');
  assert.match(page.body, /Other services/);
  assert.match(page.body, /<option value="Laser hair removal session">/, 'suggestions for the specialty');

  assert.equal((await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'Laser session', servicePrice: '800' })).status, 303);
  const dup = await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: '  laser   SESSION ', servicePrice: '500' });
  assert.equal(dup.status, 422);
  assert.match(dup.body, /already has a service with this name/);
  assert.equal((await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'X', servicePrice: '100' })).status, 422);
  assert.equal((await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'Botox', servicePrice: 'free' })).status, 422);
  assert.equal((await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'جلسة بلازما', servicePrice: '١٢٠٠' })).status, 303, 'Arabic digits');
  assert.equal((await h.db.query('select price_egp from clinic_services where clinic_id = $1 and name = $2', [d.clinicId, 'جلسة بلازما'])).rows[0]!.price_egp, 1200);

  const laser = await serviceId(d.clinicId, 'Laser session');
  assert.equal((await c.post(`/en/dashboard/services/${laser}`, { serviceName: 'Laser session (full legs)', servicePrice: '950', active: 'yes' })).status, 303);
  const row = (await h.db.query<{ name: string; price_egp: number }>('select name, price_egp from clinic_services where id = $1', [laser])).rows[0]!;
  assert.deepEqual(row, { name: 'Laser session (full legs)', price_egp: 950 });

  // Another doctor cannot add to my clinic or change my service.
  const other = await doctorClient();
  assert.equal((await other.c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'Hack', servicePrice: '1' })).status, 404);
  assert.equal((await other.c.post(`/en/dashboard/services/${laser}`, { serviceName: 'Hack', servicePrice: '1', active: 'yes' })).status, 404);
  assert.equal((await h.db.query('select price_egp from clinic_services where id = $1', [laser])).rows[0]!.price_egp, 950);

  // Hidden services leave the profile.
  await c.post(`/en/dashboard/services/${laser}`, { serviceName: 'Laser session (full legs)', servicePrice: '950' });
  const profile = await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`);
  assert.doesNotMatch(profile.body, /Laser session/);
  assert.match(profile.body, /جلسة بلازما/);
});

test('a patient books a service: price from the doctor\'s list, name kept on the visit everywhere', async () => {
  const { d, c } = await doctorClient();
  await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'Echocardiography', servicePrice: '700' });
  const echo = await serviceId(d.clinicId, 'Echocardiography');
  const p = await createPatient(h.db);
  const pc = new Client(h.baseUrl);
  await login(pc, p.phone, p.password);

  const profile = await pc.get(`/en/doctors/${d.slug}`);
  assert.match(profile.body, /Other services \(1\)/);
  assert.match(profile.body, /Echocardiography/);
  const slot = await firstSlotStart(pc, d.slug);
  const confirm = await pc.get(`/en/book?clinic=${slot.clinic}&start=${encodeURIComponent(slot.start)}`);
  assert.match(confirm.body, /What is the visit for\?/);
  assert.match(confirm.body, new RegExp(`name="service" value="${echo}"`));

  // A service of another clinic, or a made-up id, is refused and nothing is booked.
  const elsewhere = await doctorClient();
  await elsewhere.c.post(`/en/dashboard/clinics/${elsewhere.d.clinicId}/services`, { serviceName: 'Cheap thing', servicePrice: '1' });
  const foreign = await serviceId(elsewhere.d.clinicId, 'Cheap thing');
  const bad = await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, service: foreign });
  assert.equal(bad.status, 409);
  assert.match(bad.body, /no longer offered/);
  assert.equal((await h.db.query('select 1 from appointments where patient_id = $1', [p.id])).rows.length, 0);

  assert.equal((await pc.post('/en/book', { clinic: slot.clinic, start: slot.start, service: echo, fee_egp: '1' })).status, 303);
  const appt = (await h.db.query<{ id: string; visit_type: string; fee_egp: number; service_name: string }>(
    'select id, visit_type, fee_egp, service_name from appointments where patient_id = $1', [p.id])).rows[0]!;
  assert.deepEqual({ ...appt, id: undefined }, { id: undefined, visit_type: 'service', fee_egp: 700, service_name: 'Echocardiography' });

  // A later price change does not change the booked visit.
  await c.post(`/en/dashboard/services/${echo}`, { serviceName: 'Echo', servicePrice: '900', active: 'yes' });
  assert.equal((await h.db.query('select fee_egp from appointments where id = $1', [appt.id])).rows[0]!.fee_egp, 700);
  assert.match((await pc.get('/en/appointments')).body, /Echocardiography/);
  const day = todayIn('Africa/Cairo', new Date(slot.start));
  assert.match((await c.get(`/en/dashboard?date=${day}`)).body, /Echocardiography/);

  // Without a service it is a normal consultation.
  const p2 = await createPatient(h.db);
  const pc2 = new Client(h.baseUrl);
  await login(pc2, p2.phone, p2.password);
  const slot2 = await firstSlotStart(pc2, d.slug);
  await pc2.get(`/en/book?clinic=${slot2.clinic}&start=${encodeURIComponent(slot2.start)}`);
  await pc2.post('/en/book', { clinic: slot2.clinic, start: slot2.start, service: '' });
  assert.equal((await h.db.query('select visit_type from appointments where patient_id = $1', [p2.id])).rows[0]!.visit_type, 'new');
});

test('the clinic books a service by phone at the doctor\'s price', async () => {
  const { d, c } = await doctorClient();
  await c.post(`/en/dashboard/clinics/${d.clinicId}/services`, { serviceName: 'Scaling and polishing', servicePrice: '450' });
  const svc = await serviceId(d.clinicId, 'Scaling and polishing');
  const day = addDays(todayIn('Africa/Cairo', new Date()), 1);
  const page = await c.get(`/en/dashboard/book?date=${day}`);
  assert.match(page.body, new RegExp(`value="svc:${svc}"`));
  const start = slotValues(page.body)[0]!;
  const r = await c.post('/en/dashboard/book', { clinic: d.clinicId, date: day, start, name: 'Mona Walk-in', phone: '01012345679', visitType: `svc:${svc}` });
  assert.equal(r.status, 303);
  const a = (await h.db.query<{ visit_type: string; fee_egp: number; service_name: string }>(
    "select visit_type, fee_egp, service_name from appointments where walk_in_name = 'Mona Walk-in'")).rows[0]!;
  assert.deepEqual(a, { visit_type: 'service', fee_egp: 450, service_name: 'Scaling and polishing' });
});
