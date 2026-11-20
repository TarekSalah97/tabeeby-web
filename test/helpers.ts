/**
 * Integration test harness: a fresh database per test file (migrated from
 * scratch), the real HTTP app on a random port, and a cookie-aware client.
 * Requires TEST_DATABASE_URL pointing at a server where the user may CREATE DATABASE.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createDb, type Db } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { loadConfig, type Config } from '../src/config.js';
import { createApp } from '../src/app.js';
import { ConsoleSmsProvider } from '../src/services/sms.js';
import { ConsoleEmailProvider } from '../src/services/email.js';
import { LocalFileStorage } from '../src/storage/files.js';
import type { Deps } from '../src/http/context.js';
import { hashPassword } from '../src/auth/password.js';
import { deliverPending } from '../src/services/outbox.js';
import { clearReferenceCache } from '../src/services/reference.js';
import { setLogLevel } from '../src/log.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export interface Harness {
  deps: Deps;
  db: Db;
  sms: ConsoleSmsProvider;
  email: ConsoleEmailProvider;
  baseUrl: string;
  close(): Promise<void>;
}

export async function startHarness(overrides: Partial<Record<keyof Config, string>> = {}): Promise<Harness> {
  setLogLevel('error');
  const adminUrl = process.env['TEST_DATABASE_URL'];
  if (!adminUrl) throw new Error('TEST_DATABASE_URL is not set');
  const name = `tabeeby_test_${crypto.randomBytes(5).toString('hex')}`;
  const admin = createDb({ DATABASE_URL: adminUrl, DATABASE_SSL: 'disable', DATABASE_POOL_SIZE: 1, DATABASE_SSL_CA_FILE: undefined });
  await admin.query(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-up-'));
  const cfg = loadConfig({ DATABASE_URL: url.toString(), NODE_ENV: 'test', UPLOAD_DIR: uploadDir, PUBLIC_ORIGIN: 'http://127.0.0.1', ...overrides });
  const db = createDb(cfg);
  await migrate(db, path.join(root, 'migrations'));
  clearReferenceCache();
  const sms = new ConsoleSmsProvider();
  (sms as unknown as { send: ConsoleSmsProvider['send'] }).send = async (to, body) => {
    sms.sent.push({ to, body });
  };
  const email = new ConsoleEmailProvider();
  (email as unknown as { send: ConsoleEmailProvider['send'] }).send = async (to, subject, text) => {
    email.sent.push({ to, subject, text });
  };
  const deps: Deps = { cfg, db, sms, email, storage: new LocalFileStorage(uploadDir), now: () => new Date() };
  const server: Server = createApp(deps, path.join(root, 'public'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  // Origin checks compare against PUBLIC_ORIGIN, so align it with the real port.
  deps.cfg.PUBLIC_ORIGIN = `http://127.0.0.1:${port}`;

  return {
    deps,
    db,
    sms,
    email,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      await db.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
      fs.rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

/** Minimal browser: keeps cookies, extracts the CSRF token from pages, never follows redirects. */
export class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(readonly base: string) {}

  /** Extra request headers, e.g. x-forwarded-for to look like a different visitor. */
  extraHeaders: Record<string, string> = {};

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const idx = pair!.indexOf('=');
      const k = pair!.slice(0, idx);
      const v = pair!.slice(idx + 1);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }

  async get(path: string): Promise<{ status: number; body: string; location: string | null; headers: Headers }> {
    const res = await fetch(this.base + path, { redirect: 'manual', headers: { ...this.extraHeaders, cookie: this.cookieHeader() } });
    this.absorb(res);
    const body = await res.text();
    const m = /name="_csrf" value="([^"]+)"/.exec(body);
    if (m) this.csrf = m[1]!;
    return { status: res.status, body, location: res.headers.get('location'), headers: res.headers };
  }

  async post(path: string, fields: Record<string, string | string[]>, opts: { csrf?: string | null; origin?: string | null } = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
    const token = opts.csrf === undefined ? this.csrf : opts.csrf;
    if (token !== null) params.set('_csrf', token);
    const headers: Record<string, string> = { ...this.extraHeaders, cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' };
    const origin = opts.origin === undefined ? this.base : opts.origin;
    if (origin !== null) headers['origin'] = origin;
    const res = await fetch(this.base + path, { method: 'POST', redirect: 'manual', headers, body: params.toString() });
    this.absorb(res);
    return { status: res.status, body: await res.text(), location: res.headers.get('location') };
  }

  async postMultipart(path: string, form: FormData) {
    form.set('_csrf', this.csrf);
    const res = await fetch(this.base + path, { method: 'POST', redirect: 'manual', headers: { cookie: this.cookieHeader(), origin: this.base }, body: form });
    this.absorb(res);
    return { status: res.status, body: await res.text(), location: res.headers.get('location') };
  }
}

let phoneCounter = 0;
export function testPhone(): string {
  phoneCounter++;
  return `+20100${String(process.pid % 1000).padStart(3, '0')}${String(phoneCounter).padStart(4, '0')}`;
}

/** An approved doctor working 00:00–23:30 every day, so slots always exist. */
export async function createApprovedDoctor(db: Db, opts: { name?: string; specialty?: string; district?: string } = {}) {
  const hash = await hashPassword('doctor-password-1');
  const phone = testPhone();
  const { rows } = await db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('doctor', $1, $2, $3, now()) returning id`,
    [opts.name ?? 'Dr. Test Doctor', phone, hash],
  );
  const id = rows[0]!.id;
  const slug = `dr-test-${crypto.randomBytes(3).toString('hex')}`;
  await db.query(
    `insert into doctors (user_id, slug, kind, specialty_id, graduation_year, verification_status, verified_at)
     select $1, $2, 'medical', id, 2010, 'approved', now() from specialties where slug = $3`,
    [id, slug, opts.specialty ?? 'cardiology'],
  );
  const clinic = await db.query<{ id: string }>(
    `insert into clinics (doctor_id, name, district_id, address, fee_egp) select $1, 'Test Clinic', id, 'Test street 1', 400 from districts where slug = $2 returning id`,
    [id, opts.district ?? 'smouha'],
  );
  const clinicId = clinic.rows[0]!.id;
  for (let d = 0; d < 7; d++) {
    await db.query(`insert into schedule_rules (clinic_id, weekday, start_time, end_time, slot_minutes) values ($1, $2, '00:00', '23:30', 30)`, [clinicId, d]);
  }
  return { id, slug, clinicId, phone, password: 'doctor-password-1' };
}

export async function createPatient(db: Db, verified = true) {
  const hash = await hashPassword('patient-password-1');
  const phone = testPhone();
  const { rows } = await db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('patient', 'Test Patient', $1, $2, $3) returning id`,
    [phone, hash, verified ? new Date() : null],
  );
  return { id: rows[0]!.id, phone, password: 'patient-password-1' };
}

export async function createAdmin(db: Db) {
  const hash = await hashPassword('admin-password-long-1');
  const phone = testPhone();
  const { rows } = await db.query<{ id: string }>(
    `insert into users (role, full_name, phone_e164, password_hash, phone_verified_at) values ('admin', 'Test Admin', $1, $2, now()) returning id`,
    [phone, hash],
  );
  return { id: rows[0]!.id, phone, password: 'admin-password-long-1' };
}

export async function login(client: Client, phone: string, password: string) {
  await client.get('/en/login');
  return client.post('/en/login', { phone: '0' + phone.slice(3), password });
}

/** Sends queued SMS and returns the last OTP sent to a phone. */
export async function lastOtp(h: Harness, phone: string): Promise<string> {
  await deliverPending(h.db, h.sms, 20, h.email);
  const msg = [...h.sms.sent].reverse().find((m) => m.to === phone && /\d{6}/.test(m.body));
  if (!msg) throw new Error('no OTP sent');
  return /(\d{6})/.exec(msg.body)![1]!;
}

/**
 * A bookable slot from the public profile page links, at least `minHoursAhead`
 * away (so the patient is still allowed to cancel it). Looks at the next days too.
 */
export async function firstSlotStart(client: Client, slug: string, minHoursAhead = 3): Promise<{ clinic: string; start: string }> {
  const re = /href="\/en\/book\?doctor=[^&]+&amp;clinic=([0-9a-f-]+)&amp;start=([^"]+)"/g;
  const earliest = Date.now() + minHoursAhead * 3600_000;
  const profile = await client.get(`/en/doctors/${slug}`);
  const dates = [...profile.body.matchAll(/[?&]amp;date=(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]!);
  for (const page of [profile.body, ...(await Promise.all(dates.slice(0, 2).map((d) => client.get(`/en/doctors/${slug}?date=${d}`).then((r) => r.body))))]) {
    for (const m of page.matchAll(re)) {
      const start = decodeURIComponent(m[2]!);
      if (new Date(start).getTime() >= earliest) return { clinic: m[1]!, start };
    }
  }
  throw new Error('no suitable slot link on profile page');
}

/** Sends queued messages and returns the last 6-digit code emailed to an address. */
export async function lastEmailCode(h: Harness, email: string): Promise<string> {
  await deliverPending(h.db, h.sms, 20, h.email);
  const msg = [...h.email.sent].reverse().find((m) => m.to.toLowerCase() === email.toLowerCase() && /\d{6}/.test(m.text));
  if (!msg) throw new Error('no code emailed');
  return /(\d{6})/.exec(msg.text)![1]!;
}
