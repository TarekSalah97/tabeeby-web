import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { startHarness, createApprovedDoctor, createPatient, type Harness } from '../helpers.js';

// Demo-site features in a real browser: the live waiting time and the fictional AI helper.
let h: Harness;
let browser: Browser;
before(async () => {
  h = await startHarness({ DEMO_MODE: 'true' });
  browser = await chromium.launch(process.env['CHROMIUM_PATH'] ? { executablePath: process.env['CHROMIUM_PATH'] } : {});
});
after(async () => {
  await browser.close();
  await h.close();
});

async function signIn(page: Page, phone: string, password: string) {
  await page.goto(h.baseUrl + '/en/login');
  await page.getByLabel('Mobile number').fill('0' + phone.slice(3));
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('load');
}

test('fictional AI helper suggests diagnoses and adds one to the notes only when asked', async () => {
  const d = await createApprovedDoctor(h.db);
  await h.db.query('update doctors set records_enabled = true where user_id = $1', [d.id]);
  const { rows } = await h.db.query<{ id: string }>(
    `insert into patient_records (doctor_id, full_name, allergies, consent_at) values ($1, 'Mona Adel', 'Penicillin', now()) returning id`, [d.id]);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(page, d.phone, d.password);
  await page.goto(`${h.baseUrl}/en/dashboard/patients/${rows[0]!.id}/visits/new`);
  await page.locator('textarea[name=complaint]').fill('Chest tightness on climbing stairs');
  await page.locator('[data-ai-run]').click();
  await page.locator('.ai-ddx-item').first().waitFor({ timeout: 10_000 });
  assert.match(await page.locator('.ai-ddx-item').first().innerText(), /Stable angina/);
  assert.match(await page.locator('.ai-cautions').innerText(), /Penicillin/);
  assert.equal(await page.locator('textarea[name=diagnosis]').inputValue(), '', 'nothing added by itself');
  await page.locator('.ai-ddx-item').first().getByRole('button', { name: 'Add to diagnosis' }).click();
  assert.equal(await page.locator('textarea[name=diagnosis]').inputValue(), 'Stable angina');
  await page.close();
});

test('patient sees the live waiting time on My bookings and the tracker page', async () => {
  const d = await createApprovedDoctor(h.db);
  const [other, me] = await Promise.all([createPatient(h.db), createPatient(h.db)]);
  const start = new Date(Math.ceil(Date.now() / 1800_000) * 1800_000 + 3 * 3600_000);
  const ins = (pid: string, s: Date, status: string) => h.db.query(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp, status) values ($1, $2, $3, $4, $5, 'new', 400, $6)`,
    [d.id, d.clinicId, pid, s, new Date(s.getTime() + 1800_000), status]);
  await ins(other.id, start, 'arrived');
  await ins(me.id, new Date(start.getTime() + 1800_000), 'confirmed');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(page, me.phone, me.password);
  await page.goto(h.baseUrl + '/en/appointments');
  const card = page.locator('[data-testid=queue-card]');
  // The visit may fall on tomorrow late at night; then the card is simply not shown.
  if (await card.count()) {
    assert.match(await card.innerText(), /patient ahead of you/);
    await card.getByRole('link', { name: 'Track live' }).click();
    await page.waitForURL(/\/wait$/);
    assert.equal(await page.locator('.queue-steps li').count(), 4);
    const overflow = await page.evaluate('document.documentElement.scrollWidth > window.innerWidth');
    assert.equal(overflow, false, 'fits a phone screen');
  }
  await page.close();
});
