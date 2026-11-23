import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, type Harness } from '../helpers.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const tabs = (body: string) => body.match(/<nav class="search-tabs"[\s\S]*?<\/nav>/)?.[0] ?? '';

test('doctors, pharmacies, labs and scan centres sit side by side wherever people search', async () => {
  const c = new Client(h.baseUrl);
  for (const [path, current] of [['/en/', '/en/search'], ['/en/search', '/en/search'], ['/en/pharmacies', '/en/pharmacies'], ['/en/labs', '/en/labs'], ['/en/scan-centres', '/en/scan-centres']] as const) {
    const nav = tabs((await c.get(path)).body);
    assert.ok(nav, `tabs on ${path}`);
    const links = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(links, ['/en/search', '/en/pharmacies', '/en/labs', '/en/scan-centres'], path);
    assert.match(nav, new RegExp(`href="${current}" aria-current="page"`), `${path} marks its own tab`);
  }
  const ar = tabs((await c.get('/')).body);
  for (const word of ['أطباء', 'صيدليات', 'معامل تحاليل', 'مراكز أشعة']) assert.match(ar, new RegExp(word));
});

test('the doctors page has no payment plans or free-trial offer for now', async () => {
  const c = new Client(h.baseUrl);
  for (const path of ['/en/for-doctors', '/for-doctors', '/en/', '/']) {
    const body = (await c.get(path)).body;
    assert.doesNotMatch(body, /id="pricing"|EGP \/ month|3 months|Start free|Most chosen|3 شهور|باقات|ج\.م \/ شهر/, path);
  }
});
