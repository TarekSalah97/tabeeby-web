import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';
import { jpegWithGps, pngWithGps } from '../fixtures/images.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const form = (data: Buffer | string, type: string) => {
  const f = new FormData();
  f.append('photo', new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type }), 'me.jpg');
  return f;
};

test('a doctor uploads a photo: location data removed, shown on profile and search, can be changed and removed', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Photo Test' });
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard/profile');
  assert.match((await c.postMultipart('/en/dashboard/photo', form('<svg onload=alert(1)>', 'image/png'))).body, /must be a JPG or PNG/);
  assert.match((await c.postMultipart('/en/dashboard/photo', form(Buffer.alloc(3 * 1024 * 1024 + 10, 0xff), 'image/jpeg'))).body, /3 MB or smaller/);

  const ok = await c.postMultipart('/en/dashboard/photo', form(jpegWithGps(), 'image/jpeg'));
  assert.equal(ok.location, '/en/dashboard/profile?ok=photoSaved');
  const profile = await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`);
  const src = /<img class="avatar xl photo" src="([^"]+)"/.exec(profile.body)?.[1];
  assert.ok(src, 'photo on the profile');
  assert.match((await new Client(h.baseUrl).get('/en/search?q=Photo%20Test')).body, /<img class="avatar photo"/);

  const img = await fetch(h.baseUrl + src!.replace(/&amp;/g, '&'));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  const bytes = Buffer.from(await img.arrayBuffer());
  assert.ok(!bytes.includes('GPSLatitude'), 'hidden location removed');

  // Changing replaces the stored file; removing goes back to initials.
  await c.postMultipart('/en/dashboard/photo', form(pngWithGps(), 'image/png'));
  const replaced = await fetch(`${h.baseUrl}/photos/doctors/${d.slug}`);
  assert.equal(replaced.headers.get('content-type'), 'image/png');
  assert.equal((await c.post('/en/dashboard/photo/delete', {})).location, '/en/dashboard/profile?ok=photoRemoved');
  assert.equal((await fetch(`${h.baseUrl}/photos/doctors/${d.slug}`)).status, 404);
  assert.ok(!(await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`)).body.includes('avatar xl photo'));
  const audit = await h.db.query<{ n: number }>("select count(*)::int as n from audit_log where actor_user_id = $1 and action like 'doctor.photo%'", [d.id]);
  assert.equal(audit.rows[0]!.n, 3);
});

test('photos of doctors not yet approved are not public; only doctors can upload', async () => {
  const d = await createApprovedDoctor(h.db);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard/profile');
  await c.postMultipart('/en/dashboard/photo', form(jpegWithGps(), 'image/jpeg'));
  await h.db.query("update doctors set verification_status = 'pending' where user_id = $1", [d.id]);
  assert.equal((await fetch(`${h.baseUrl}/photos/doctors/${d.slug}`)).status, 404);
  const p = new Client(h.baseUrl);
  const patient = await createPatient(h.db);
  await login(p, patient.phone, patient.password);
  await p.get('/en/appointments');
  assert.equal((await p.postMultipart('/en/dashboard/photo', form(jpegWithGps(), 'image/jpeg'))).status, 403);
});

test('a doctor viewing their own public page gets a back-to-dashboard button; others do not', async () => {
  const d = await createApprovedDoctor(h.db);
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  const own = await c.get(`/en/doctors/${d.slug}`);
  assert.match(own.body, /This is how patients see your page/);
  assert.match(own.body, /href="\/en\/dashboard"[^>]*>[\s\S]*?Back to dashboard/);
  assert.ok(!(await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`)).body.includes('Back to dashboard'));
});
