/**
 * Shared helpers for the load and conflict tests (scripts/load). These run against a LOCAL
 * production-like copy of the site, never the live one. See docs/LOAD_TESTING.md.
 */
import { performance } from 'node:perf_hooks';

export const BASE = process.env['LOAD_BASE'] ?? 'http://127.0.0.1:4100';
/** What the server believes its own address is (PUBLIC_ORIGIN); sent as Origin on forms. */
export const ORIGIN = process.env['LOAD_ORIGIN'] ?? 'https://127.0.0.1:4100';
export const PASSWORD = process.env['LOAD_PASSWORD'] ?? 'demo-password-2026';

if (/onrender\.com|tabeeby\./i.test(BASE)) {
  console.error('Refusing to load-test a hosted site. Point LOAD_BASE at a local copy (see docs/LOAD_TESTING.md).');
  process.exit(1);
}

export interface Res {
  status: number;
  body: string;
  location: string | null;
  ms: number;
}

let ipCounter = 0;
/** A different made-up visitor address per client, so per-address limits behave like real traffic. */
function nextIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** A browser-like visitor: keeps its cookies and the latest form token. */
export class Visitor {
  cookies = new Map<string, string>();
  csrf = '';
  readonly ip: string;
  constructor(ip?: string) {
    this.ip = ip ?? nextIp();
  }

  private absorb(res: Response): void {
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(';')[0]!;
      const i = pair.indexOf('=');
      if (/Max-Age=0/i.test(c)) this.cookies.delete(pair.slice(0, i));
      else this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-forwarded-for': this.ip, cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), ...extra };
  }

  async get(path: string): Promise<Res> {
    const t = performance.now();
    const res = await fetch(BASE + path, { redirect: 'manual', headers: this.headers() });
    this.absorb(res);
    const body = await res.text();
    const m = /name="_csrf" value="([^"]+)"/.exec(body);
    if (m) this.csrf = m[1]!;
    return { status: res.status, body, location: res.headers.get('location'), ms: performance.now() - t };
  }

  async post(path: string, fields: Record<string, string | string[]>): Promise<Res> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
    params.set('_csrf', this.csrf);
    const t = performance.now();
    const res = await fetch(BASE + path, {
      method: 'POST',
      redirect: 'manual',
      headers: this.headers({ 'content-type': 'application/x-www-form-urlencoded', origin: ORIGIN }),
      body: params.toString(),
    });
    this.absorb(res);
    return { status: res.status, body: await res.text(), location: res.headers.get('location'), ms: performance.now() - t };
  }

  /** Signs in with a local-format mobile number (e.g. 01100000001). Throws if it fails. */
  async login(phone: string, password = PASSWORD): Promise<this> {
    await this.get('/en/login');
    const r = await this.post('/en/login', { phone, password });
    if (r.status !== 303 || /login/.test(r.location ?? '')) throw new Error(`login failed for ${phone}: ${r.status} ${r.location ?? ''}`);
    return this;
  }
}

/** Load-data accounts made by scripts/load/bulk.sql. */
export const loadDoctorPhone = (n: number) => `011${String(n).padStart(8, '0')}`;
export const loadPatientPhone = (n: number) => `012${String(n).padStart(8, '0')}`;

/** Runs every task at the same moment (as close as one process allows). */
export async function together<T>(n: number, task: (i: number) => Promise<T>): Promise<T[]> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const runs = Array.from({ length: n }, (_, i) => gate.then(() => task(i)));
  release();
  return Promise.all(runs);
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

export function countBy<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
