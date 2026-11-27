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

/** A clinic booking at today's HH:MM (Cairo) for a walk-in with this name and number. */
async function visit(d: { id: string; clinicId: string }, hhmm: string, name: string, phone: string, status: string) {
  await h.db.query(
    `insert into appointments (doctor_id, clinic_id, booked_by, walk_in_name, walk_in_phone, starts_at, ends_at, visit_type, fee_egp, status,
                               arrived_at, consult_started_at, completed_at)
     select $1, $2, 'doctor', $3, $4, t, t + interval '30 minutes', 'new', 300, $6,
            case when $6 in ('arrived', 'in_consultation', 'completed') then t end,
            case when $6 in ('in_consultation', 'completed') then t end,
            case when $6 = 'completed' then least(t + interval '20 minutes', now() - interval '1 hour') end
       from (select ((now() at time zone 'Africa/Cairo')::date + $5::time) at time zone 'Africa/Cairo' as t) x`,
    [d.id, d.clinicId, name, phone, hhmm, status],
  );
}

test('the schedule puts finished visits last, filters by the count boxes and searches only this day', async () => {
  const d = await createApprovedDoctor(h.db);
  await visit(d, '09:00', 'Karim Done', '+201011110001', 'completed');
  await visit(d, '09:30', 'Salma Cancelled', '+201011110002', 'cancelled');
  await visit(d, '10:00', 'Omar Waiting', '+201011110003', 'arrived');
  await visit(d, '10:30', 'منة الله سامي', '+201011110004', 'in_consultation');
  await visit(d, '11:00', 'Hoda Later', '+201011110005', 'confirmed');
  await visit(d, '08:30', 'Nabil Done', '+201011110006', 'completed');
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);

  const all = (await c.get('/en/dashboard')).body;
  const order = ['منة الله سامي', 'Omar Waiting', 'Hoda Later', 'Nabil Done', 'Karim Done', 'Salma Cancelled'].map((n) => all.indexOf(n));
  assert.ok(order.every((i) => i > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'with the doctor, then waiting/booked by time, then finished, cancelled last');
  assert.match(all, /data-testid="kpi-completed"[^>]*href|href="\/en\/dashboard\?show=completed"/);

  // "Completed" shows only today's finished visits.
  const done = (await c.get('/en/dashboard?show=completed')).body;
  assert.match(done, /Completed \(2\)/);
  assert.ok(done.includes('Karim Done') && done.includes('Nabil Done'));
  for (const other of ['Omar Waiting', 'Hoda Later', 'Salma Cancelled', 'منة الله سامي']) assert.ok(!done.includes(`>${other}<`), other);

  const waiting = (await c.get('/en/dashboard?show=waiting')).body;
  assert.ok(waiting.includes('Omar Waiting') && !waiting.includes('>Hoda Later<'));

  // Search: names (Arabic spelling variants) and numbers, only within this day's list.
  const byName = (await c.get('/en/dashboard?q=' + encodeURIComponent('منه'))).body;
  assert.ok(byName.includes('منة الله سامي') && !byName.includes('>Omar Waiting<'));
  const byPhone = (await c.get('/en/dashboard?q=0003')).body;
  assert.ok(byPhone.includes('Omar Waiting') && !byPhone.includes('>Karim Done<'));
  const nobody = (await c.get('/en/dashboard?q=Zeinab')).body;
  assert.match(nobody, /No one on this day/);
  // Another day's patient isn't found from today.
  await h.db.query(`update appointments set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where walk_in_name = 'Hoda Later' and doctor_id = $1`, [d.id]);
  assert.match((await c.get('/en/dashboard?q=Hoda')).body, /No one on this day/);
  // Bad view values fall back to everything.
  assert.equal((await c.get('/en/dashboard?show=<script>')).status, 200);
});

test('after Finish, the visit stays on top for 3 minutes with a follow-up button, then goes to the end', async () => {
  const d = await createApprovedDoctor(h.db);
  await visit(d, '00:00', 'Early Done', '+201011110011', 'completed');
  await visit(d, '00:30', 'Rana Now', '+201011110012', 'in_consultation');
  await visit(d, '01:00', 'Next Waiting', '+201011110013', 'arrived');
  const id = (await h.db.query<{ id: string }>(`select id from appointments where walk_in_name = 'Rana Now'`)).rows[0]!.id;
  const c = new Client(h.baseUrl);
  await login(c, d.phone, d.password);
  await c.get('/en/dashboard');
  const fin = await c.post(`/en/dashboard/appointments/${id}/status`, { to: 'completed' });
  assert.equal(fin.status, 303, fin.body.slice(0, 200));

  const page = (await c.get('/en/dashboard')).body;
  const order = ['Rana Now', 'Next Waiting', 'Early Done'].map((n) => page.indexOf(n));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'just finished on top');
  assert.match(page, /data-testid="just-finished"/);
  assert.match(page, /Just finished · book a follow-up\?/);
  assert.match(page, new RegExp(`/en/dashboard/book\\?from=${id}`));
  const secs = Number(/data-reorder-in="(\d+)"/.exec(page)![1]);
  assert.ok(secs > 150 && secs <= 181, String(secs));

  // Three minutes later it is just another finished visit at the end.
  await h.db.query(`update appointments set completed_at = now() - interval '3 minutes 1 second' where id = $1`, [id]);
  const later = (await c.get('/en/dashboard')).body;
  assert.ok(later.indexOf('Next Waiting') < later.indexOf('Rana Now'));
  assert.doesNotMatch(later, /just-finished|data-reorder-in/);
    await h.db.query(`update appointments set completed_at = now() where id = $1`, [id]);
  assert.match((await c.get('/dashboard')).body, /خلص الكشف · تحجز متابعة؟/);
});
