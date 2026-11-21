import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, login, type Harness } from '../helpers.js';
import { todayIn, zonedToUtc } from '../../src/domain/time.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const TZ = 'Africa/Cairo';
const MIN = 60_000;

/** A time "now-ish" that keeps every visit of the test inside today's Cairo date. */
function anchor(): Date {
  const day = todayIn(TZ, new Date());
  const lo = zonedToUtc(day, '02:00', TZ).getTime();
  const hi = zonedToUtc(day, '21:00', TZ).getTime();
  return new Date(Math.min(hi, Math.max(lo, Date.now())));
}

async function visit(d: { id: string; clinicId: string }, patientId: string, start: Date): Promise<string> {
  const { rows } = await h.db.query<{ id: string }>(
    `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp)
     values ($1, $2, $3, $4, $5, 'new', 400) returning id`,
    [d.id, d.clinicId, patientId, start, new Date(start.getTime() + 20 * MIN)],
  );
  return rows[0]!.id;
}

test('patient sees a live waiting time for today that follows the doctor\'s clinic', async () => {
  const d = await createApprovedDoctor(h.db);
  const dc = new Client(h.baseUrl);
  await login(dc, d.phone, d.password);
  const [p1, p2, me, stranger] = await Promise.all([createPatient(h.db), createPatient(h.db), createPatient(h.db), createPatient(h.db)]);
  const t = anchor();
  const a1 = await visit(d, p1.id, new Date(t.getTime() - 40 * MIN));
  const a2 = await visit(d, p2.id, new Date(t.getTime() - 20 * MIN));
  const mine = await visit(d, me.id, t);

  const status = async (id: string, to: string) => {
    await dc.get('/en/dashboard');
    const r = await dc.post(`/en/dashboard/appointments/${id}/status`, { to });
    assert.equal(r.status, 303);
  };
  await status(a1, 'arrived');
  await status(a1, 'in_consultation');
  await status(a1, 'completed');
  await status(a2, 'arrived');
  await status(a2, 'in_consultation');
  await status(mine, 'arrived');
  const times = (await h.db.query<{ arrived_at: Date | null; consult_started_at: Date | null; completed_at: Date | null }>(
    'select arrived_at, consult_started_at, completed_at from appointments where id = $1', [a1])).rows[0]!;
  assert.ok(times.arrived_at && times.consult_started_at && times.completed_at, 'each step time is recorded');

  const pc = new Client(h.baseUrl);
  await login(pc, me.phone, me.password);
  const list = await pc.get('/en/appointments');
  assert.match(list.body, /data-testid="queue-card"/);
  assert.match(list.body, new RegExp(`/en/appointments/${mine}/wait`));

  const page = await pc.get(`/en/appointments/${mine}/wait`);
  assert.equal(page.status, 200);
  assert.match(page.body, /patient ahead of you/);
  assert.match(page.body, /<li class="current" aria-current="step">.*Checked in/);
  assert.match(page.body, /\d+–\d+.*min/);
  assert.match(page.body, /data-autorefresh="60"/);
  assert.doesNotMatch(page.body, new RegExp(p2.phone.slice(-6)), 'never shows who is ahead');

  // Someone else's visit is invisible.
  const sc = new Client(h.baseUrl);
  await login(sc, stranger.phone, stranger.password);
  assert.equal((await sc.get(`/en/appointments/${mine}/wait`)).status, 404);
  assert.doesNotMatch((await sc.get('/en/appointments')).body, /queue-card/);

  // The doctor moves on: now it's my turn.
  await status(a2, 'completed');
  await status(mine, 'in_consultation');
  const inside = await pc.get(`/en/appointments/${mine}/wait`);
  assert.match(inside.body, /with the doctor now/);
  const ar = await pc.get(`/appointments/${mine}/wait`);
  assert.match(ar.body, /أنت مع الطبيب الآن/);
});

test('a visit on another day says tracking starts on the day', async () => {
  const d = await createApprovedDoctor(h.db);
  const me = await createPatient(h.db);
  const id = await visit(d, me.id, new Date(Date.now() + 3 * 86400_000));
  const pc = new Client(h.baseUrl);
  await login(pc, me.phone, me.password);
  const page = await pc.get(`/en/appointments/${id}/wait`);
  assert.match(page.body, /Live tracking starts on the day of your visit/);
  assert.doesNotMatch(page.body, /data-autorefresh/);
});
