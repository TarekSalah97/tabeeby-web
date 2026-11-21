import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';
import { todayIn } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

async function signedIn(person: { phone: string; password: string }) {
  const c = new Client(h.baseUrl);
  await login(c, person.phone, person.password);
  return c;
}

/** A visit today (started 1 hour ago) with the given status. */
async function visit(d: { id: string; clinicId: string }, o: { patientId?: string; walkIn?: string; status?: string; fee?: number; minutesAgo?: number }) {
  const start = new Date(Date.now() - (o.minutesAgo ?? 60) * 60_000);
  const { rows } = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, walk_in_name, walk_in_phone, booked_by, starts_at, ends_at, visit_type, fee_egp, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'new', $9, $10) returning id`,
    [d.id, d.clinicId, o.patientId ?? null, o.walkIn ?? null, o.walkIn ? '+201012345678' : null, o.walkIn ? 'doctor' : 'patient',
      start, new Date(start.getTime() + 30 * 60_000), o.fee ?? 400, o.status ?? 'completed'],
  );
  return rows[0]!.id;
}

test('the clinic records a payment on the day view; one per visit; totals and receipts follow', async () => {
  const d = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const c = await signedIn(d);
  const done = await visit(d, { patientId: p.id, status: 'completed' });
  const cancelled = await visit(d, { patientId: p.id, status: 'cancelled', minutesAgo: 300 });

  const day = await c.get('/en/dashboard');
  assert.match(day.body, new RegExp(`/en/dashboard/appointments/${done}/pay`));
  // Empty amount = the visit price; cash by default.
  const res = await c.post(`/en/dashboard/appointments/${done}/pay`, { method: 'cash', amount: '', date: todayIn('Africa/Cairo', new Date()) });
  assert.match(res.location!, /ok=paid/);
  const row = (await h.db.query<{ amount_egp: number; method: string; recorded_by: string }>('select amount_egp, method, recorded_by from payments where appointment_id = $1', [done])).rows[0]!;
  assert.deepEqual(row, { amount_egp: 400, method: 'cash', recorded_by: d.id });
  const after = await c.get(res.location!);
  assert.match(after.body, /Payment recorded/);
  assert.match(after.body, /Paid · /);
  assert.match(after.body, /Collected \(paid\)<\/span><strong>[^<]*400/);

  assert.match((await c.post(`/en/dashboard/appointments/${done}/pay`, { method: 'card' })).location!, /error=pay\.alreadyPaid/);
  assert.match((await c.post(`/en/dashboard/appointments/${cancelled}/pay`, { method: 'cash' })).location!, /error=pay\.notPayable/);
  assert.match((await c.post(`/en/dashboard/appointments/${cancelled}/pay`, { method: 'bitcoin' })).location!, /error=pay\.methodInvalid/);

  // Patient sees it and can open their receipt; another patient cannot.
  const pc = await signedIn(p);
  const mine = await pc.get('/en/appointments');
  assert.match(mine.body, new RegExp(`/en/appointments/${done}/receipt`));
  const receipt = await pc.get(`/en/appointments/${done}/receipt`);
  assert.equal(receipt.status, 200);
  assert.match(receipt.body, /Payment receipt/);
  assert.match(receipt.body, /Cash/);
  const other = await signedIn(await createPatient(h.db));
  assert.equal((await other.get(`/en/appointments/${done}/receipt`)).status, 404);
  assert.equal((await c.get(`/en/dashboard/appointments/${done}/receipt`)).status, 200);
});

test('another doctor cannot record or refund payments on my visits; payments cannot be deleted', async () => {
  const d = await createApprovedDoctor(h.db);
  const id = await visit(d, { walkIn: 'Walk In' });
  const c = await signedIn(d);
  await c.get('/en/dashboard');
  await c.post(`/en/dashboard/appointments/${id}/pay`, { method: 'cash', amount: '300' });
  const payId = (await h.db.query<{ id: string }>('select id from payments where appointment_id = $1', [id])).rows[0]!.id;

  const intruder = await signedIn(await createApprovedDoctor(h.db));
  await intruder.get('/en/dashboard');
  assert.equal((await intruder.post(`/en/dashboard/appointments/${id}/pay`, { method: 'cash' })).status, 404);
  const ref = await intruder.post(`/en/dashboard/payments/${payId}/refund`, { reason: 'Steal it' });
  assert.equal(ref.status, 404);
  assert.equal((await intruder.get(`/en/dashboard/appointments/${id}/receipt`)).status, 404);
  await assert.rejects(h.db.query('delete from payments where id = $1', [payId]));
});

test('income page: totals by method, unpaid visits, refund with a reason, then pay again; spreadsheet download', async () => {
  const d = await createApprovedDoctor(h.db);
  const c = await signedIn(d);
  const a = await visit(d, { walkIn: '=HYPERLINK("http://evil","click")', fee: 400 });
  const b = await visit(d, { walkIn: 'Mona', fee: 250, minutesAgo: 120 });
  const unpaid = await visit(d, { walkIn: 'Unpaid Person', fee: 300, minutesAgo: 180 });
  await c.get('/en/dashboard');
  await c.post(`/en/dashboard/appointments/${a}/pay`, { method: 'cash' });
  await c.post(`/en/dashboard/appointments/${b}/pay`, { method: 'instapay', amount: '٢٠٠' });

  const page = await c.get('/en/dashboard/income');
  assert.equal(page.status, 200);
  assert.match(page.body, /Total received<\/span><strong>[^<]*600/);
  assert.match(page.body, /Cash \(1\)/);
  assert.match(page.body, /InstaPay \(1\)/);
  assert.match(page.body, /Not paid yet \(1\)/);
  assert.match(page.body, /Unpaid Person/);
  assert.match(page.body, /&lt;|=HYPERLINK\(&quot;/, 'names are escaped');

  // Pay the unpaid one from the income page; it returns there.
  const fromIncome = await c.post(`/en/dashboard/appointments/${unpaid}/pay`, { method: 'wallet', back: 'income', from: '2020-01-01', to: '2099-12-31' });
  assert.match(fromIncome.location!, /^\/en\/dashboard\/income\?from=2020-01-01&to=2099-12-31&ok=paid/);

  const payB = (await h.db.query<{ id: string }>("select id from payments where appointment_id = $1 and status = 'paid'", [b])).rows[0]!.id;
  assert.match((await c.post(`/en/dashboard/payments/${payB}/refund`, { reason: '' })).location!, /error=pay\.reasonRequired/);
  assert.match((await c.post(`/en/dashboard/payments/${payB}/refund`, { reason: 'Charged twice' })).location!, /ok=refunded/);
  assert.equal((await c.post(`/en/dashboard/payments/${payB}/refund`, { reason: 'Again' })).status, 404, 'already refunded');
  assert.match((await c.post(`/en/dashboard/appointments/${b}/pay`, { method: 'cash', amount: '250' })).location!, /ok=paid/);
  const statuses = (await h.db.query<{ status: string }>('select status from payments where appointment_id = $1 order by created_at', [b])).rows.map((r) => r.status);
  assert.deepEqual(statuses, ['refunded', 'paid']);
  const audit = await h.db.query<{ n: number }>(`select count(*)::int as n from audit_log where actor_user_id = $1 and action like 'payment.%'`, [d.id]);
  assert.equal(audit.rows[0]!.n, 5);

  const csv = await fetch(`${h.baseUrl}/en/dashboard/income.csv`, { headers: { cookie: (c as unknown as { cookieHeader(): string }).cookieHeader() } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  assert.match(csv.headers.get('content-disposition')!, /attachment; filename="tabeeby-income-/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'starts with the UTF-8 marker Excel needs for Arabic');
  const text = bytes.toString('utf8');
  assert.match(text, /"'=HYPERLINK\(""http:\/\/evil""/, 'formula neutralised');
  assert.match(text, /Charged twice/);
  // Patients and signed-out visitors cannot download it.
  const pc = await signedIn(await createPatient(h.db));
  assert.equal((await pc.get('/en/dashboard/income.csv')).status, 403);
  assert.equal((await new Client(h.baseUrl).get('/en/dashboard/income')).status, 303);
});
