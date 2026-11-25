import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, login, type Harness } from '../helpers.js';
import { clearReferenceCache, getReference } from '../../src/services/reference.js';

let h: Harness;
before(async () => {
  h = await startHarness();
  clearReferenceCache();
});
after(async () => {
  await h.close();
});

test('all 27 governorates with their districts; district web names are unique across Egypt', async () => {
  const ref = await getReference(h.db);
  assert.equal(ref.governorates.length, 27);
  assert.equal(ref.governorates[0]!.slug, 'alexandria', 'launch city first');
  assert.ok(ref.governorates.every((g) => g.districts.length >= 5), 'every governorate has districts');
  assert.equal(new Set(ref.districts.map((d) => d.slug)).size, ref.districts.length);
  assert.ok(ref.districts.length >= 350);
  // The original Alexandria links keep working.
  assert.equal(ref.districts.find((d) => d.slug === 'smouha')?.governorate_en, 'Alexandria');
  assert.equal(ref.districts.find((d) => d.slug === 'nasr-city')?.governorate_ar, 'القاهرة');
  // Same name in two cities: both kept, told apart by their city.
  const gamaliya = ref.districts.filter((d) => d.name_en === 'El Gamaliya').map((d) => d.governorate_en).sort();
  assert.deepEqual(gamaliya, ['Cairo', 'Dakahlia']);
});

test('fetal medicine and many more subspecialties under each specialty', async () => {
  const ref = await getReference(h.db);
  const obgyn = ref.specialties.find((s) => s.slug === 'obgyn')!;
  const fetal = obgyn.subspecialties.find((s) => s.slug === 'fetal-medicine');
  assert.equal(fetal?.name_ar, 'طب الأجنة');
  for (const s of ref.specialties) assert.ok(s.subspecialties.length >= 7, `${s.slug} has ${s.subspecialties.length}`);
  // Search words reach it.
  const c = new Client(h.baseUrl);
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Fetal Test', specialty: 'obgyn' });
  await h.db.query('insert into doctor_subspecialties (doctor_id, subspecialty_id) values ($1, $2)', [d.id, fetal!.id]);
  assert.match((await c.get(`/search?q=${encodeURIComponent('سونار الجنين')}`)).body, /Dr\. Fetal Test/);
  assert.match((await c.get('/en/search?specialty=obgyn&sub=fetal-medicine')).body, /Dr\. Fetal Test/);
});

test('search by city: only doctors with a clinic in that governorate; district still narrows; pages show the city', async () => {
  const cairo = await createApprovedDoctor(h.db, { name: 'Dr. Cairo Place', specialty: 'dermatology', district: 'nasr-city' });
  await createApprovedDoctor(h.db, { name: 'Dr. Alex Place', specialty: 'dermatology', district: 'smouha' });
  const c = new Client(h.baseUrl);
  const byCity = await c.get('/en/search?specialty=dermatology&city=cairo');
  assert.match(byCity.body, /Dr\. Cairo Place/);
  assert.doesNotMatch(byCity.body, /Dr\. Alex Place/);
  assert.match(byCity.body, /<h1>Dermatology · Cairo<\/h1>/);
  const byDistrict = await c.get('/en/search?specialty=dermatology&district=smouha');
  assert.match(byDistrict.body, /Dr\. Alex Place/);
  assert.doesNotMatch(byDistrict.body, /Dr\. Cairo Place/);
  // Unknown city is ignored, not an error.
  assert.equal((await c.get('/en/search?city=atlantis')).status, 200);
  // The profile shows district and city.
  assert.match((await c.get(`/en/doctors/${cairo.slug}`)).body, /Nasr City, Cairo/);
  assert.match((await c.get(`/doctors/${cairo.slug}`)).body, /مدينة نصر، القاهرة/);
  // Home page lists governorates; the search lists are grouped by city.
  const home = await c.get('/');
  assert.match(home.body, /href="\/search\?city=aswan"/);
  assert.match(home.body, /<optgroup label="أسوان">/);
});

test('a doctor can put a clinic in any governorate', async () => {
  const d = await createApprovedDoctor(h.db);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const page = await dc.get('/en/dashboard/clinics');
  assert.match(page.body, /<optgroup label="Luxor">/);
  const luxor = (await h.db.query<{ id: number }>(`select id from districts where slug = 'esna'`)).rows[0]!.id;
  const res = await dc.post('/en/dashboard/clinics', { name: 'Esna Clinic', district: String(luxor), address: 'Main street', fee: '300', followUpDays: '14', active: 'yes', city: 'luxor' });
  assert.equal(res.status, 303, res.body.slice(0, 300));
  assert.equal((await h.db.query(`select 1 from clinics where doctor_id = $1 and district_id = $2`, [d.id, luxor])).rows.length, 1);
});
