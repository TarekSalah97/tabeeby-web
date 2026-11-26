import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, login, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

test('a doctor adds Facebook, Instagram and TikTok; patients see them on the profile', async () => {
  const d = await createApprovedDoctor(h.db, { name: 'Dr. Social Links' });
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const form = await dc.get('/en/dashboard/profile');
  assert.match(form.body, /name="facebook"/);
  assert.match(form.body, /name="instagram"/);
  assert.match(form.body, /name="tiktok"/);

  // A link to another site is refused and the typed value is kept.
  const bad = await dc.post('/en/dashboard/profile', { titleEn: '', titleAr: '', bio: 'Hi', facebook: 'https://evil.example/page', instagram: '@ok_name', tiktok: '' });
  assert.equal(bad.status, 422);
  assert.match(bad.body, /isn&#39;t a Facebook page link|isn't a Facebook page link/);
  assert.match(bad.body, /value="https:\/\/evil\.example\/page"/);

  const ok = await dc.post('/en/dashboard/profile', { titleEn: '', titleAr: '', bio: 'Hi', facebook: 'facebook.com/DrSocial', instagram: '@dr.social', tiktok: 'https://www.tiktok.com/@drsocial?lang=ar' });
  assert.equal(ok.status, 303);
  const row = (await h.db.query<{ facebook_url: string; instagram_url: string; tiktok_url: string }>('select facebook_url, instagram_url, tiktok_url from doctors where user_id = $1', [d.id])).rows[0]!;
  assert.deepEqual(row, { facebook_url: 'https://www.facebook.com/DrSocial', instagram_url: 'https://www.instagram.com/dr.social/', tiktok_url: 'https://www.tiktok.com/@drsocial' });

  const pub = await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`);
  assert.match(pub.body, /data-testid="social"/);
  assert.match(pub.body, /href="https:\/\/www\.instagram\.com\/dr\.social\/" target="_blank" rel="noopener noreferrer nofollow ugc"/);
  assert.match(pub.body, /"sameAs":\["https:\/\/www\.facebook\.com\/DrSocial"/);
  assert.match((await new Client(h.baseUrl).get(`/doctors/${d.slug}`)).body, /تابع الطبيب/);

  // Clearing a box removes that link.
  await dc.post('/en/dashboard/profile', { titleEn: '', titleAr: '', bio: 'Hi', facebook: '', instagram: '@dr.social', tiktok: '' });
  const after = await new Client(h.baseUrl).get(`/en/doctors/${d.slug}`);
  assert.doesNotMatch(after.body, /facebook\.com\/DrSocial/);
  assert.match(after.body, /instagram\.com\/dr\.social/);
});
