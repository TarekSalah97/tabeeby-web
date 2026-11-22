import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, type Harness } from '../helpers.js';

let h: Harness;
let limited: Harness;
before(async () => {
  [h, limited] = await Promise.all([
    startHarness(),
    startHarness({ RATE_LIMIT_PAGES_PER_MIN: '5', RATE_LIMIT_POSTS_PER_MIN: '2', TRUST_PROXY: 'true' }),
  ]);
});
after(async () => {
  await Promise.all([h.close(), limited.close()]);
});

test('contact page: both numbers with call and WhatsApp links, in both languages, linked from every page', async () => {
  const c = new Client(h.baseUrl);
  const en = await c.get('/en/contact');
  assert.equal(en.status, 200);
  for (const n of ['201017609775', '201004704221']) {
    assert.match(en.body, new RegExp(`href="tel:\\+${n}"`));
    assert.match(en.body, new RegExp(`href="https://wa.me/${n}"`));
  }
  assert.match(en.body, /010 1760 9775/);
  assert.match(en.body, /Call 123/);
  const ar = await c.get('/contact');
  assert.match(ar.body, /تواصل معنا/);
  assert.match((await c.get('/en')).body, /href="\/en\/contact"/);
});

test('attack probes get an empty 404 without touching the app', async () => {
  const c = new Client(h.baseUrl);
  for (const p of ['/wp-login.php', '/.env', '/.git/config', '/en/%2e%2e%2f%2e%2e%2fetc/passwd', '/phpmyadmin/index.php']) {
    const r = await c.get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.body, '', p);
  }
});

test('security.txt and a robots.txt that hides private pages', async () => {
  const c = new Client(h.baseUrl);
  const sec = await c.get('/.well-known/security.txt');
  assert.match(sec.body, /^Contact: .*\/en\/contact$/m);
  assert.match(sec.body, /^Expires: \d{4}-/m);
  const robots = await c.get('/robots.txt');
  for (const p of ['/admin', '/dashboard', '/health-record', '/results', '/en/results']) assert.match(robots.body, new RegExp(`Disallow: ${p}\\n`));
});

test('per-visitor request budget: too many requests get 429, other visitors are fine, faked addresses do not help', async () => {
  const a = new Client(limited.baseUrl);
  a.extraHeaders = { 'x-forwarded-for': '41.0.0.1' };
  for (let i = 0; i < 5; i++) assert.equal((await a.get('/en/contact')).status, 200);
  const blocked = await a.get('/en/contact');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body, /Too many requests/);
  // Faking a new first address does not reset the budget: the proxy's last entry is used.
  const sneaky = new Client(limited.baseUrl);
  sneaky.extraHeaders = { 'x-forwarded-for': '9.9.9.9, 41.0.0.1' };
  assert.equal((await sneaky.get('/en/contact')).status, 429);
  const b = new Client(limited.baseUrl);
  b.extraHeaders = { 'x-forwarded-for': '41.0.0.2' };
  assert.equal((await b.get('/en/contact')).status, 200);
  // Static files and the health check are never limited.
  assert.notEqual((await a.get('/healthz')).status, 429);
});
