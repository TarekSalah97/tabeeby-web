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

test('Create account asks patient or doctor, then opens the right form', async () => {
  const c = new Client(h.baseUrl);
  const home = await c.get('/en/');
  assert.match(home.body, /href="\/en\/join"[^>]*>Create account/);
  const page = await c.get('/en/join?next=%2Fen%2Fappointments');
  assert.equal(page.status, 200);
  assert.match(page.body, /href="\/en\/signup\?next=%2Fen%2Fappointments"/);
  assert.match(page.body, /href="\/en\/for-doctors\/join"/);
  assert.match(page.body, /href="\/en\/facilities\/join"/);
  assert.match((await c.get('/join')).body, /أنا مريض/);
  const evil = (await c.get('/en/join?next=https%3A%2F%2Fevil.example')).body;
  assert.ok(!/href="\/en\/(signup|login)[^"]*evil/.test(evil), 'sign-up and sign-in links never carry an outside address');
});
