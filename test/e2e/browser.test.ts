import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { startHarness, createApprovedDoctor, createPatient, type Harness } from '../helpers.js';

let h: Harness;
let browser: Browser;
before(async () => {
  h = await startHarness();
  browser = await chromium.launch(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {});
});
after(async () => {
  await browser.close();
  await h.close();
});

test('patient books through the Arabic UI: search → profile → sign in → confirm → my appointments', async () => {
  await createApprovedDoctor(h.db, { name: 'د. سلمى القلب', specialty: 'cardiology', district: 'smouha' });
  const patient = await createPatient(h.db);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(h.baseUrl + '/');
  await page.getByLabel('التخصص أو الحالة أو اسم الطبيب').fill('قلب');
  await page.getByRole('button', { name: 'بحث' }).first().click();
  await page.getByRole('link', { name: 'د. سلمى القلب' }).click();

  await page.locator('.booking-panel .slot').first().click();
  // Not signed in → sign-in page, then back to the confirm step.
  await page.waitForURL(/\/login\?next=/);
  await page.getByLabel('رقم الموبايل').fill('0' + patient.phone.slice(3));
  await page.getByLabel('كلمة المرور', { exact: true }).fill(patient.password);

  // Password visibility toggle (from the v1 checklist).
  const pw = page.getByLabel('كلمة المرور', { exact: true });
  assert.equal(await pw.getAttribute('type'), 'password');
  await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
  assert.equal(await pw.getAttribute('type'), 'text');

  await page.getByRole('button', { name: 'دخول' }).click();
  await page.waitForURL(/\/book\?/);
  await page.getByRole('radio', { name: 'متابعة' }).check();
  await page.getByLabel(/سبب الزيارة/).fill('متابعة ضغط');
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  await page.waitForURL(/\/appointments\?ok=booked/);
  assert.ok(await page.getByText('تم الحجز').isVisible());
  assert.ok(await page.getByText('د. سلمى القلب').first().isVisible());
  await page.close();
});

test('pages fit a phone screen without sideways scrolling', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  for (const path of ['/', '/en', '/search', `/doctors/${doctor.slug}`, '/for-doctors', '/for-doctors/join', '/signup']) {
    await page.goto(h.baseUrl + path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
  }
  await page.close();
});

test('no browser console errors and no CSP violations on key pages', async () => {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  for (const path of ['/', '/en/search', '/en/for-doctors', '/login']) await page.goto(h.baseUrl + path);
  assert.deepEqual(problems, []);
  await page.close();
});
