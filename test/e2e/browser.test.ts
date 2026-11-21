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
  // Not signed in → the booking page offers "already have an account? sign in", then comes back to confirm.
  await page.locator('.have-account a').click();
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
  assert.match(await page.content(), /سعر الكشف/);
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

test('admin pages fit a phone screen in Arabic and English and on desktop', async () => {
  const { createAdmin } = await import('../helpers.js');
  const admin = await createAdmin(h.db);
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp)
     values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 30 minutes', 'new', 400)`,
    [d.id, d.clinicId, p.id],
  );
  await h.db.query(
    `insert into notification_outbox (channel, to_phone, body, status, attempts, last_error)
     values ('sms', '+201011112222', 'x', 'failed', 6, 'gateway 500: upstream timed out while connecting to provider')`,
  );
  const shots = process.env['SHOTS_DIR'];
  for (const [w, hgt, name, lang] of [[1280, 900, 'desk', '/en'], [390, 844, 'phone', ''], [390, 844, 'phone-en', '/en']] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: hgt } });
    await page.goto(h.baseUrl + lang + '/login');
    await page.locator('input[name=phone]').fill('0' + admin.phone.slice(3));
    await page.locator('input[name=password]').fill(admin.password);
    await page.locator('form button[type=submit]').first().click();
    await page.waitForLoadState('load');
    for (const path of ['/admin', '/admin/accounts?q=a', '/admin/audit', '/admin/messages', '/admin/doctors', '/admin/reviews', `/admin/doctors/${d.id}`]) {
      await page.goto(h.baseUrl + lang + path);
      const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      assert.ok((overflow as number) <= 1, `${name} ${path} is ${String(overflow)}px too wide`);
      if (shots && (path === '/admin' || path === '/admin/messages')) {
        await page.screenshot({ path: `${shots}/admin-${name}${path.replace(/\//g, '-')}.png`, fullPage: true });
      }
    }
    await page.close();
  }
});

test('doctor adds a walk-in booking on a phone by tapping a time (Arabic)', async () => {
  const d = await createApprovedDoctor(h.db);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(h.baseUrl + '/login');
  await page.locator('input[name=phone]').fill('0' + d.phone.slice(3));
  await page.locator('input[name=password]').fill(d.password);
  await page.locator('form button[type=submit]').first().click();
  await page.waitForLoadState('load');
  await page.goto(h.baseUrl + '/dashboard');
  await page.getByRole('link', { name: 'إضافة حجز' }).click();
  await page.getByRole('link', { name: 'غدًا' }).click();
  const shots = process.env['SHOTS_DIR'];
  await page.locator('.slot-pick .slot').nth(3).click();
  await page.getByLabel('اسم المريض').fill('عمرو سعيد');
  await page.getByLabel('رقم الموبايل').fill('01012345678');
  if (shots) await page.screenshot({ path: `${shots}/clinic-book-phone.png`, fullPage: true });
  for (const path of ['/dashboard/book', '/dashboard/clinics']) {
    const p2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await p2.context().addCookies(await page.context().cookies());
    await p2.goto(h.baseUrl + path);
    const overflow = (await p2.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) as number;
    assert.ok(overflow <= 1, `${path} is ${overflow}px too wide`);
    await p2.close();
  }
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  await page.waitForLoadState('load');
  assert.match(await page.content(), /أُضيف الحجز إلى جدولك/);
  assert.match(await page.content(), /عمرو سعيد/);
  if (shots) await page.screenshot({ path: `${shots}/clinic-day-phone.png`, fullPage: true });
  await page.close();
});

test('patient and doctor exchange messages on phones (Arabic) without sideways scrolling', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  await h.db.query(`update doctors set messaging_enabled = true, messaging_days = '{0,1,2,3,4,5,6}', messaging_start = '00:00', messaging_end = '23:59' where user_id = $1`, [d.id]);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 30 minutes', 'new', 400)`,
    [d.id, d.clinicId, p.id],
  );
  const shots = process.env['SHOTS_DIR'];
  const signIn = async (who: { phone: string; password: string }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(h.baseUrl + '/login');
    await page.locator('input[name=phone]').fill('0' + who.phone.slice(3));
    await page.locator('input[name=password]').fill(who.password);
    await page.locator('form button[type=submit]').first().click();
    await page.waitForLoadState('load');
    return page;
  };
  const wide = async (page: import('playwright').Page) => (await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) as number;

  const pp = await signIn(p);
  await pp.goto(h.baseUrl + `/doctors/${d.slug}`);
  await pp.getByRole('link', { name: 'راسل الطبيب' }).first().click();
  await pp.getByLabel('اكتب رسالتك…').fill('هل أستمر على الدواء قبل الزيارة؟ ' + 'كلمة '.repeat(40));
  await pp.getByRole('button', { name: 'إرسال' }).click();
  await pp.waitForLoadState('load');
  assert.match(await pp.content(), /أُرسلت الرسالة/);
  assert.ok((await wide(pp)) <= 1, 'patient thread fits');

  const dp = await signIn(d);
  await dp.goto(h.baseUrl + '/dashboard/messages');
  assert.ok((await wide(dp)) <= 1, 'doctor inbox fits');
  await dp.locator('.inbox-row').first().click();
  await dp.getByLabel('اكتب رسالتك…').fill('نعم، استمر عليه كالمعتاد.');
  await dp.getByRole('button', { name: 'إرسال' }).click();
  await dp.waitForLoadState('load');
  assert.ok((await wide(dp)) <= 1, 'doctor thread fits');
  if (shots) await dp.screenshot({ path: `${shots}/msg-doctor-phone.png`, fullPage: true });

  await pp.goto(h.baseUrl + '/');
  assert.equal(await pp.locator('.tabbar .tab-badge').count(), 1);
  await pp.locator('.tabbar a[href="/messages"]').click();
  await pp.locator('.inbox-row').first().click();
  assert.match(await pp.content(), /استمر عليه كالمعتاد/);
  if (shots) await pp.screenshot({ path: `${shots}/msg-patient-phone.png`, fullPage: true });
  await pp.close();
  await dp.close();
});

test('pharmacy and lab pages fit a phone in Arabic; a lab owner saves prices by tapping', async () => {
  const { hashPassword } = await import('../../src/auth/password.js');
  const { testPhone } = await import('../helpers.js');
  const phone = testPhone();
  const { rows } = await h.db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('facility', 'Owner', $1, $2, now()) returning id`,
    [phone, await hashPassword('facility-password-1')],
  );
  const id = rows[0]!.id;
  await h.db.query(`insert into facilities (user_id, kind, slug, name, licence_number, description, home_service, verification_status, verified_at)
    values ($1, 'lab', 'alpha-labs-e2e', 'معامل ألفا Alpha Labs', 'LIC-9', 'تحاليل شاملة ونتائج في نفس اليوم.', true, 'approved', now())`, [id]);
  await h.db.query(`insert into facility_branches (facility_id, name, district_id, address, opens, closes) select $1, 'فرع سموحة', id, '١٤ ميدان فيكتور عمانويل، سموحة', '08:00', '02:00' from districts where slug = 'smouha'`, [id]);
  await h.db.query(`insert into facility_tests (facility_id, test_code, price_egp) values ($1, 'cbc', 150), ($1, 'hba1c', 300)`, [id]);
  const shots = process.env['SHOTS_DIR'];
  const wide = async (page: import('playwright').Page) => (await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) as number;

  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/labs', '/labs?tests=cbc,hba1c', '/labs/alpha-labs-e2e?tests=cbc,hba1c', '/pharmacies', '/scan-centres', '/facilities/join']) {
    await visitor.goto(h.baseUrl + path);
    assert.ok((await wide(visitor)) <= 1, `${path} is too wide`);
  }
  await visitor.goto(h.baseUrl + '/labs?tests=cbc,hba1c');
  if (shots) await visitor.screenshot({ path: `${shots}/labs-phone.png`, fullPage: true });
  await visitor.close();

  const owner = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await owner.goto(h.baseUrl + '/login');
  await owner.locator('input[name=phone]').fill('0' + phone.slice(3));
  await owner.locator('input[name=password]').fill('facility-password-1');
  await owner.locator('form button[type=submit]').first().click();
  await owner.waitForLoadState('load');
  assert.match(owner.url(), /\/facility$/);
  for (const path of ['/facility', '/facility/branches', '/facility/prices']) {
    await owner.goto(h.baseUrl + path);
    assert.ok((await wide(owner)) <= 1, `${path} is too wide`);
  }
  await owner.getByLabel('سكر صائم').fill('٧٠');
  await owner.getByRole('button', { name: 'حفظ' }).click();
  await owner.waitForLoadState('load');
  const saved = await h.db.query<{ price_egp: number }>("select price_egp from facility_tests where facility_id = $1 and test_code = 'fbs'", [id]);
  assert.equal(saved.rows[0]?.price_egp, 70);
  if (shots) await owner.screenshot({ path: `${shots}/lab-prices-phone.png` });
  await owner.close();
});

test('doctor records a payment on a phone (Arabic) and opens the income page', async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, fee_egp, status)
     values ($1, $2, 'منى سامي', '+201012345678', 'doctor', now() - interval '40 minutes', now() - interval '10 minutes', 'new', 450, 'completed')`,
    [d.id, d.clinicId],
  );
  const shots = process.env['SHOTS_DIR'];
  const wide = async (page: import('playwright').Page) => (await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')) as number;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(h.baseUrl + '/login');
  await page.locator('input[name=phone]').fill('0' + d.phone.slice(3));
  await page.locator('input[name=password]').fill(d.password);
  await page.locator('form button[type=submit]').first().click();
  await page.waitForLoadState('load');
  await page.goto(h.baseUrl + '/dashboard');
  assert.ok((await wide(page)) <= 1, 'day view fits');
  await page.locator('.pay-form select').selectOption('instapay');
  await page.getByRole('button', { name: 'تسجيل الدفع' }).click();
  await page.waitForLoadState('load');
  assert.match(await page.content(), /تم تسجيل الدفع/);
  assert.match(await page.content(), /إنستاباي/);
  if (shots) await page.screenshot({ path: `${shots}/pay-day-phone.png`, fullPage: true });
  await page.goto(h.baseUrl + '/dashboard/income');
  assert.ok((await wide(page)) <= 1, 'income page fits');
  if (shots) await page.screenshot({ path: `${shots}/income-phone.png`, fullPage: true });
  await page.close();
});
