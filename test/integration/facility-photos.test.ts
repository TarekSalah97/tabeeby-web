import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startHarness, Client, createAdmin, login, testPhone, type Harness } from '../helpers.js';
import { jpegWithGps } from '../fixtures/images.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function newPharmacy() {
  const phone = testPhone();
  const c = new Client(h.baseUrl);
  await c.get('/en/facilities/join');
  const f = new FormData();
  for (const [k, v] of Object.entries({
    kind: 'pharmacy', name: `Sabry Pharmacy ${crypto.randomBytes(2).toString('hex')}`, licenceNumber: '42', contactName: 'Sabry',
    phone: '0' + phone.slice(3), email: `s${crypto.randomBytes(3).toString('hex')}@example.com`, password: 'Corniche-tulip-lantern-81', consent: 'yes',
  })) f.append(k, v);
  const res = await c.postMultipart('/en/facilities/join', f);
  assert.equal(res.status, 303, (res.body.match(/class="field-error"[^<]*<[^>]*>[^<]*|field-error[^<]*/g) ?? []).join(' | '));
  const id = (await h.db.query<{ user_id: string; slug: string }>('select f.user_id, f.slug from facilities f join users u on u.id = f.user_id where u.phone_e164 = $1', [phone])).rows[0]!;
  return { c, id: id.user_id, slug: id.slug };
}
const photoForm = (field: string, blobs: Blob[]) => {
  const f = new FormData();
  for (const [i, b] of blobs.entries()) f.append(field, b, `p${i}.jpg`);
  return f;
};
const JPG = () => new Blob([new Uint8Array(jpegWithGps())], { type: 'image/jpeg' });

test('a pharmacy adds a logo and photos; they are cleaned, public after approval, and the admin can hide one', async () => {
  const { c, id, slug } = await newPharmacy();
  assert.equal((await c.get('/en/facility/photos')).location, '/en/facility#photos');
  assert.match((await c.get('/en/facility')).body, /id="photos"/);
  assert.doesNotMatch((await c.get('/en/facility')).body, /href="\/en\/facility\/photos"/);
  assert.equal((await c.postMultipart('/en/facility/photos?kind=logo', photoForm('logo', [JPG()]))).location, '/en/facility?ok=facilityPhotosAdded#photos');
  const mixed = await c.postMultipart('/en/facility/photos?kind=photo', photoForm('photos', [JPG(), JPG(), new Blob(['<svg onload=alert(1)>'], { type: 'image/jpeg' })]));
  assert.equal(mixed.location, '/en/facility?ok=facilityPhotosAddedSome#photos');
  // A second logo replaces the first.
  await c.postMultipart('/en/facility/photos?kind=logo', photoForm('logo', [JPG()]));
  const rows = (await h.db.query<{ id: string; kind: string; storage_key: string }>('select id, kind, storage_key from facility_photos where facility_id = $1 order by kind', [id])).rows;
  assert.deepEqual(rows.map((r) => r.kind), ['logo', 'photo', 'photo']);

  // GPS data is gone from what is served.
  const own = await c.get(`/en/photos/facilities/${rows[1]!.id}`);
  assert.equal(own.status, 200);
  assert.doesNotMatch(own.body, /Exif/);

  // Before approval only the place (and admins) can see the photos.
  assert.equal((await new Client(h.baseUrl).get(`/en/photos/facilities/${rows[1]!.id}`)).status, 404);
  await h.db.query("update facilities set verification_status = 'approved', verified_at = now() where user_id = $1", [id]);
  await h.db.query(
    `insert into facility_branches (facility_id, name, district_id, address, open_24h, opens, closes) select $1, 'Main', id, '5 Fouad Street', true, '00:00', '23:59' from districts where slug = 'smouha'`, [id],
  );
  const visitor = new Client(h.baseUrl);
  const pub = await visitor.get(`/en/pharmacies/${slug}`);
  assert.match(pub.body, /data-testid="place-photos"/);
  assert.match(pub.body, /5 Fouad Street/);
  assert.match(pub.body, new RegExp(`/en/photos/facilities/${rows[0]!.id}`)); // logo
  assert.equal((await visitor.get(`/en/photos/facilities/${rows[1]!.id}`)).status, 200);

  // Another place cannot delete it.
  const other = await newPharmacy();
  assert.equal((await other.c.post(`/en/facility/photos/${rows[1]!.id}/delete`, {})).status, 404);

  // Admin hides a photo: gone from the public page and its link, still visible to the owner.
  const admin = await createAdmin(h.db);
  const ac = new Client(h.baseUrl);
  await login(ac, admin.phone, admin.password);
  assert.match((await ac.get(`/en/admin/facilities/${id}`)).body, /Public photos/);
  assert.equal((await visitor.post(`/en/admin/facility-photos/${rows[1]!.id}/hide`, {})).status === 303, false);
  assert.equal((await ac.post(`/en/admin/facility-photos/${rows[1]!.id}/hide`, {})).status, 303);
  assert.equal((await visitor.get(`/en/photos/facilities/${rows[1]!.id}`)).status, 404);
  assert.doesNotMatch((await visitor.get(`/en/pharmacies/${slug}`)).body, new RegExp(rows[1]!.id));
  assert.match((await c.get('/en/facility')).body, /Hidden by our team/);
  await ac.post(`/en/admin/facility-photos/${rows[1]!.id}/show`, {});
  assert.equal((await visitor.get(`/en/photos/facilities/${rows[1]!.id}`)).status, 200);

  // The owner removes a photo.
  assert.equal((await c.post(`/en/facility/photos/${rows[2]!.id}/delete`, {})).status, 303);
  assert.equal(Number((await h.db.query<{ n: string }>('select count(*) n from facility_photos where facility_id = $1', [id])).rows[0]!.n), 2);
});

test('at most 8 photos', async () => {
  const { c, id } = await newPharmacy();
  await c.postMultipart('/en/facility/photos?kind=photo', photoForm('photos', Array.from({ length: 6 }, JPG)));
  const over = await c.postMultipart('/en/facility/photos?kind=photo', photoForm('photos', Array.from({ length: 3 }, JPG)));
  assert.match(over.location ?? '', /fphoto\.err\.full/);
  assert.equal(Number((await h.db.query<{ n: string }>('select count(*) n from facility_photos where facility_id = $1', [id])).rows[0]!.n), 6);
});

test('address: shown on the profile, a Google Maps pin is used for directions, other links are refused; Documents hides once approved', async () => {
  const { c, id, slug } = await newPharmacy();
  const prof = await c.get('/en/facility');
  assert.match(prof.body, /Add your address and hours/);
  assert.match(prof.body, /Documents/);
  const district = (await h.db.query<{ id: number }>("select id from districts where slug = 'smouha'")).rows[0]!.id;
  const base = { name: 'Main branch', district: String(district), address: '14 Victor Emmanuel Square, next to the bank', phone: '', days: ['0', '1', '2', '3', '4', '5', '6'], opens: '09:00', closes: '23:00', active: 'yes' };
  const bad = await c.post('/en/facility/branches', { ...base, mapsUrl: 'https://evil.example/maps' });
  assert.equal(bad.status, 422);
  assert.match(bad.body, /Paste a Google Maps link/);
  assert.equal((await c.post('/en/facility/branches', { ...base, mapsUrl: 'maps.app.goo.gl/Xy12Ab' })).status, 303);
  const prof2 = await c.get('/en/facility');
  assert.match(prof2.body, /14 Victor Emmanuel Square/);
  assert.match(prof2.body, /https:\/\/maps\.app\.goo\.gl\/Xy12Ab/);

  await h.db.query("update facilities set verification_status = 'approved', verified_at = now() where user_id = $1", [id]);
  const pub = await new Client(h.baseUrl).get(`/en/pharmacies/${slug}`);
  assert.match(pub.body, /data-testid="place-address"/);
  assert.match(pub.body, /href="https:\/\/maps\.app\.goo\.gl\/Xy12Ab"/);
  const after = await c.get('/en/facility');
  assert.doesNotMatch(after.body, /href="\/en\/facility\/documents"/);
  assert.equal((await c.get('/en/facility/documents')).location, '/en/facility');
});
