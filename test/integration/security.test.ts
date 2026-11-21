import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, Client, createApprovedDoctor, createPatient, createAdmin, login, firstSlotStart, type Harness } from '../helpers.js';
import { book } from '../../src/services/booking.js';
import { DomainError } from '../../src/http/errors.js';
import type { SessionUser } from '../../src/auth/sessions.js';

let h: Harness;
before(async () => {
  h = await startHarness();
});
after(async () => {
  await h.close();
});

const asUser = (p: { id: string; phone: string }): SessionUser => ({ id: p.id, role: 'patient', fullName: 'P', phone: p.phone, phoneVerified: true, locale: 'en' });

test('double booking: 12 patients racing for one slot → exactly one wins', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const slot = await firstSlotStart(new Client(h.baseUrl), doctor.slug);
  const patients = await Promise.all(Array.from({ length: 12 }, () => createPatient(h.db)));
  const results = await Promise.allSettled(
    patients.map((p) => book(h.deps, asUser(p), { clinicId: slot.clinic, startsAt: new Date(slot.start), reason: '' }, '127.0.0.1')),
  );
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  assert.equal(won.length, 1);
  for (const l of lost) {
    assert.ok(l.reason instanceof DomainError, String(l.reason));
    assert.ok(['booking.slotTaken', 'booking.slotUnavailable'].includes((l.reason as DomainError).messageKey));
  }
  const { rows } = await h.db.query<{ n: number }>(`select count(*)::int as n from appointments where doctor_id = $1 and status <> 'cancelled'`, [doctor.id]);
  assert.equal(rows[0]!.n, 1);
});

test('database refuses overlapping appointments even if app code is bypassed', async () => {
  const doctor = await createApprovedDoctor(h.db);
  const p = await createPatient(h.db);
  const start = new Date(Date.now() + 48 * 3600_000);
  const insert = (s: Date, e: Date) =>
    h.db.query(
      `insert into appointments (doctor_id, clinic_id, patient_id, starts_at, ends_at, visit_type, fee_egp) values ($1, $2, $3, $4, $5, 'new', 100)`,
      [doctor.id, doctor.clinicId, p.id, s, e],
    );
  await insert(start, new Date(start.getTime() + 30 * 60000));
  await assert.rejects(insert(new Date(start.getTime() + 15 * 60000), new Date(start.getTime() + 45 * 60000)), /appointments_no_overlap/);
});

test('patient limit on active appointments', async () => {
  const p = await createPatient(h.db);
  const doctors = await Promise.all(Array.from({ length: 6 }, () => createApprovedDoctor(h.db)));
  const client = new Client(h.baseUrl);
  let lastError: unknown = null;
  for (const d of doctors) {
    const slot = await firstSlotStart(client, d.slug);
    try {
      await book(h.deps, asUser(p), { clinicId: slot.clinic, startsAt: new Date(slot.start), reason: '' }, 'ip');
    } catch (e) {
      lastError = e;
    }
  }
  assert.ok(lastError instanceof DomainError && lastError.messageKey === 'booking.tooManyActive');
});

test('access control: roles and ownership are enforced on the server', async () => {
  const doctorA = await createApprovedDoctor(h.db);
  const doctorB = await createApprovedDoctor(h.db);
  const patient = await createPatient(h.db);
  const other = await createPatient(h.db);
  const slot = await firstSlotStart(new Client(h.baseUrl), doctorA.slug);
  const apptId = await book(h.deps, asUser(patient), { clinicId: slot.clinic, startsAt: new Date(slot.start), reason: 'private' }, 'ip');

  // Doctor B cannot touch doctor A's appointment (looks like it does not exist).
  const b = new Client(h.baseUrl);
  await login(b, doctorB.phone, doctorB.password);
  await b.get('/en/dashboard');
  const res = await b.post(`/en/dashboard/appointments/${apptId}/status`, { to: 'cancelled' });
  assert.equal(res.status, 404);
  const day = await b.get('/en/dashboard');
  assert.ok(!day.body.includes('private'), 'reason for visit must not leak to another doctor');

  // Another patient cannot cancel it either.
  const o = new Client(h.baseUrl);
  await login(o, other.phone, other.password);
  await o.get('/en/appointments');
  assert.equal((await o.post(`/en/appointments/${apptId}/cancel`, {})).status, 404);

  // Patients cannot open the dashboard or admin; doctors cannot open admin.
  assert.equal((await o.get('/en/dashboard')).status, 403);
  assert.equal((await o.get('/en/admin')).status, 403);
  assert.equal((await b.get('/en/admin')).status, 403);

  // Doctor A sees it, including the reason.
  const a = new Client(h.baseUrl);
  await login(a, doctorA.phone, doctorA.password);
  const date = new Date(slot.start).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const own = await a.get(`/en/dashboard?date=${date}`);
  assert.match(own.body, /private/);
  assert.match(own.body, /Test Patient/);

  const status = await h.db.query<{ status: string }>('select status from appointments where id = $1', [apptId]);
  assert.equal(status.rows[0]!.status, 'confirmed');
});

test('CSRF: missing token, wrong token or foreign origin are rejected', async () => {
  const patient = await createPatient(h.db);
  const c = new Client(h.baseUrl);
  await login(c, patient.phone, patient.password);
  await c.get('/en/appointments');
  assert.equal((await c.post('/en/logout', {}, { csrf: null })).status, 403);
  assert.equal((await c.post('/en/logout', {}, { csrf: 'x'.repeat(43) })).status, 403);
  assert.equal((await c.post('/en/logout', {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await c.post('/en/logout', {})).status, 303);
});

test('session cookie is HttpOnly + SameSite and replaced on login; logout ends the session', async () => {
  const patient = await createPatient(h.db);
  const c = new Client(h.baseUrl);
  await c.get('/en/login');
  const res = await fetch(h.baseUrl + '/en/login', {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; '), origin: h.baseUrl, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: c.csrf, phone: '0' + patient.phone.slice(3), password: patient.password }).toString(),
  });
  const cookie = res.headers.getSetCookie().find((x) => x.startsWith('tb_session='))!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = cookie.split(';')[0]!.split('=')[1]!;
  const { rows } = await h.db.query<{ n: number }>('select count(*)::int as n from sessions where user_id = $1', [patient.id]);
  assert.equal(rows[0]!.n, 1);
  const stored = await h.db.query<{ token_hash: string }>('select token_hash from sessions where user_id = $1', [patient.id]);
  assert.ok(!String(stored.rows[0]!.token_hash).includes(token), 'only a hash of the token is stored');

  c.cookies.set('tb_session', token);
  await c.get('/en/appointments');
  await c.post('/en/logout', {});
  const after = await h.db.query<{ n: number }>('select count(*)::int as n from sessions where user_id = $1', [patient.id]);
  assert.equal(after.rows[0]!.n, 0);
});

test('security headers are sent on every page', async () => {
  const res = await fetch(h.baseUrl + '/en');
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('login is rate limited per phone', async () => {
  const patient = await createPatient(h.db);
  let last = 0;
  for (let i = 0; i < 10; i++) last = (await login(new Client(h.baseUrl), patient.phone, 'wrong-password-x')).status;
  assert.equal(last, 429);
});

test('admin documents: only admins, every view audited', async () => {
  const admin = await createAdmin(h.db);
  const doctor = await createApprovedDoctor(h.db);
  const key = await h.deps.storage.put(Buffer.from('%PDF-1.4 card'), 'pdf');
  const { rows } = await h.db.query<{ id: string }>(
    `insert into verification_documents (doctor_id, kind, storage_key, mime_type, size_bytes, sha256) values ($1, 'syndicate_card', $2, 'application/pdf', 13, 'x') returning id`,
    [doctor.id, key],
  );
  const docId = rows[0]!.id;
  const doc = new Client(h.baseUrl);
  await login(doc, doctor.phone, doctor.password);
  assert.equal((await doc.get(`/en/admin/documents/${docId}`)).status, 403);

  const a = new Client(h.baseUrl);
  await login(a, admin.phone, admin.password);
  const res = await a.get(`/en/admin/documents/${docId}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  const audit = await h.db.query<{ n: number }>(`select count(*)::int as n from audit_log where action = 'document.view' and entity_id = $1 and actor_user_id = $2`, [docId, admin.id]);
  assert.equal(audit.rows[0]!.n, 1);
});
