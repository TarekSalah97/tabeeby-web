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

async function signIn(page: import('playwright').Page, phone: string, password: string) {
  await page.goto(h.baseUrl + '/en/login');
  await page.getByLabel('Mobile number').fill('0' + phone.slice(3));
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('load');
}

test('on a phone, the main buttons are on screen: patient tab bar, profile actions, the doctor’s next-step button, tap-to-rate stars', async () => {
  const doctor = await createApprovedDoctor(h.db, { name: 'Dr. Phone Check' });
  await h.db.query(`update clinics set phone_e164 = '+20341234567' where id = $1`, [doctor.clinicId]);
  const patient = await createPatient(h.db);
  // One visit later today (for the doctor's day view) and one completed visit (to rate).
  const soon = new Date(Date.now() + 60 * 60000);
  soon.setUTCMinutes(soon.getUTCMinutes() < 30 ? 30 : 60, 0, 0);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 400)`,
    [doctor.id, doctor.clinicId, patient.id, soon, new Date(soon.getTime() + 30 * 60000)],
  );
  const past = new Date(Date.now() - 3 * 86400_000);
  const done = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, status, fee_egp) values ($1, $2, $3, $4, $5, 'new', 'completed', 400) returning id`,
    [doctor.id, doctor.clinicId, patient.id, past, new Date(past.getTime() + 30 * 60000)],
  );

  const ctxP = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctxP.newPage();
  const problems: string[] = [];
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  page.on('pageerror', (e) => problems.push(e.message));
  await signIn(page, patient.phone, patient.password);
  for (const path of ['/', '/appointments', `/doctors/${doctor.slug}`, '/en/appointments', `/en/appointments/${done.rows[0]!.id}/review`]) {
    await page.goto(h.baseUrl + path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${path} overflows by ${overflow}px`);
    assert.ok(await page.locator('.tabbar').isVisible(), `${path} shows the tab bar`);
  }
  await page.goto(h.baseUrl + `/en/doctors/${doctor.slug}`);
  for (const name of ['Book', 'Call', 'Directions']) assert.ok(await page.locator('.sticky-actions').getByRole('link', { name }).isVisible(), `${name} is pinned on screen`);

  // Rate by tapping the 4th star.
  await page.goto(h.baseUrl + `/en/appointments/${done.rows[0]!.id}/review`);
  await page.locator('label[for="rating-4"]').click();
  await page.getByRole('button', { name: 'Save review' }).click();
  await page.waitForURL(/ok=reviewSaved/);
  assert.equal((await h.db.query<{ rating: number }>('select rating from reviews where appointment_id = $1', [done.rows[0]!.id])).rows[0]!.rating, 4);
  await page.screenshot({ path: '/tmp/shot-patient-appointments.png', fullPage: true });
  await ctxP.close();

  const ctxD = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const dpage = await ctxD.newPage();
  await signIn(dpage, doctor.phone, doctor.password);
  await dpage.goto(h.baseUrl + '/en/dashboard');
  const overflow = await dpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `dashboard overflows by ${overflow}px`);
  const arrived = dpage.getByRole('button', { name: 'Mark arrived' }).first();
  const box = await arrived.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375, 'the next-step button is fully on screen without sideways scrolling');
  assert.ok(box!.height >= 44, 'and large enough to tap');
  await dpage.screenshot({ path: '/tmp/shot-doctor-dashboard.png', fullPage: true });
  await ctxD.close();
  assert.deepEqual(problems, []);
});
