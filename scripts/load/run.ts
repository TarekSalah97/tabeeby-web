/**
 * Load test: simulated visitors, patients and clinic staff, in steps of more and more people at
 * once. Prints, per step: requests per second, response times (median, 95th, 99th percentile),
 * errors, and the server's CPU and memory. Run against a LOCAL copy only (docs/LOAD_TESTING.md).
 *
 *   SERVER_PID=$(pgrep -f dist/src/server.js) STAGES=10,25,50,100,200 STAGE_SECONDS=30 npx tsx scripts/load/run.ts
 */
import { readFileSync } from 'node:fs';
import { Visitor, percentile, loadDoctorPhone, loadPatientPhone, type Res } from './lib.js';

const STAGES = (process.env['STAGES'] ?? '10,25,50,100,200').split(',').map(Number);
const STAGE_SECONDS = Number(process.env['STAGE_SECONDS'] ?? 30);
/** Pause between a user's clicks. Real people take several seconds; shorter = harsher test. */
const THINK_MS = Number(process.env['THINK_MS'] ?? 1000);
const SERVER_PID = process.env['SERVER_PID'];
const DOCTORS = 500;
const PATIENT_FROM = 2001; // load patients 2001.. (conflict tests use 1001–1400)

interface Sample { route: string; ms: number; status: number }
let samples: Sample[] = [];
let running = true;

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(xs: T[]) => xs[rnd(xs.length)]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(THINK_MS * (0.5 + Math.random()));

async function hit(route: string, p: Promise<Res>): Promise<Res | null> {
  try {
    const r = await p;
    samples.push({ route, ms: r.ms, status: r.status });
    return r;
  } catch {
    samples.push({ route, ms: 0, status: 0 }); // connection refused / reset
    return null;
  }
}

const SPECIALTIES = ['cardiology', 'dentistry', 'orthopedics', 'pediatrics', 'dermatology', 'internal-medicine'];
const CITIES = ['alexandria', 'cairo', 'giza'];

async function visitorLoop(): Promise<void> {
  const v = new Visitor();
  while (running) {
    await hit('home', v.get('/en'));
    await think();
    await hit('search', v.get(`/en/search?city=${pick(CITIES)}&specialty=${pick(SPECIALTIES)}`));
    await think();
    const n = 1 + rnd(DOCTORS);
    await hit('doctor profile', v.get(`/en/doctors/load-doctor-${n}`));
    await think();
    const date = new Date(Date.now() + (1 + rnd(5)) * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    await hit('doctor slots day', v.get(`/en/doctors/load-doctor-${n}?date=${date}`));
    await think();
    if (Math.random() < 0.3) await hit('pharmacies list', v.get('/en/pharmacies'));
  }
}

async function patientLoop(i: number): Promise<void> {
  const v = new Visitor();
  try {
    await v.login(loadPatientPhone(PATIENT_FROM + i));
  } catch {
    samples.push({ route: 'login', ms: 0, status: 0 });
    return;
  }
  while (running) {
    await hit('my appointments', v.get('/en/appointments'));
    await think();
    await hit('health record', v.get('/en/health-record'));
    await think();
    await hit('medicines', v.get('/en/medicines'));
    await think();
    if (Math.random() < 0.15) {
      // Book a real slot (a write), then cancel it so the patient never hits the 5-visit limit.
      const n = 1 + rnd(DOCTORS);
      const date = new Date(Date.now() + (2 + rnd(5)) * 86400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
      const day = await hit('doctor slots day', v.get(`/en/doctors/load-doctor-${n}?date=${date}`));
      const m = day && /book\?doctor=[^&"]+&(?:amp;)?clinic=([0-9a-f-]{36})&(?:amp;)?start=([^"&]+)/.exec(day.body);
      if (m) {
        const start = decodeURIComponent(m[2]!);
        await hit('booking page', v.get(`/en/book?clinic=${m[1]}&start=${encodeURIComponent(start)}`));
        const r = await hit('book (write)', v.post('/en/book', { clinic: m[1]!, start, reason: '', pay: 'cash' }));
        const list = r && /ok=/.test(r.location ?? '') ? await hit('my appointments', v.get('/en/appointments')) : null;
        const id = list && /appointments\/([0-9a-f-]{36})\/cancel/.exec(list.body)?.[1];
        if (id) await hit('cancel (write)', v.post(`/en/appointments/${id}/cancel`, {}));
      }
      await think();
    }
  }
}

async function staffLoop(i: number): Promise<void> {
  const v = new Visitor();
  try {
    await v.login(loadDoctorPhone(100 + (i % 400)));
  } catch {
    samples.push({ route: 'login', ms: 0, status: 0 });
    return;
  }
  while (running) {
    await hit('dashboard day', v.get('/en/dashboard'));
    await think();
    const list = await hit('patients search', v.get(`/en/dashboard/patients?q=Load+Patient+${1 + rnd(9)}`));
    await think();
    const rec = list && /dashboard\/patients\/([0-9a-f-]{36})/.exec(list.body)?.[1];
    if (rec) await hit('patient file', v.get(`/en/dashboard/patients/${rec}`));
    await think();
    if (Math.random() < 0.3) await hit('income', v.get('/en/dashboard/income'));
  }
}

function serverStats(): { cpuTicks: number; rssMb: number } | null {
  if (!SERVER_PID) return null;
  try {
    const stat = readFileSync(`/proc/${SERVER_PID}/stat`, 'utf8').split(') ')[1]!.split(' ');
    const status = readFileSync(`/proc/${SERVER_PID}/status`, 'utf8');
    const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
    return { cpuTicks: Number(stat[11]) + Number(stat[12]), rssMb: Math.round(rss / 1024) };
  } catch {
    return null;
  }
}

const fmt = (n: number) => String(Math.round(n)).padStart(6);
console.log(`steps ${STAGES.join(' → ')} people, ${STAGE_SECONDS}s each, pause between clicks ~${THINK_MS} ms\n`);
console.log(' people   req/s  median    p95    p99  slowest  errors   cpu%  memMB');
const report: Record<string, unknown>[] = [];
let users = 0;
const loops: Promise<void>[] = [];
for (const target of STAGES) {
  while (users < target) {
    const k = users++;
    const kind = k % 20;
    loops.push(kind < 12 ? visitorLoop() : kind < 17 ? patientLoop(k) : staffLoop(k));
  }
  await sleep(3000); // let new users sign in before measuring
  samples = [];
  const s0 = serverStats();
  let peakRss = s0?.rssMb ?? 0;
  const t0 = Date.now();
  while (Date.now() - t0 < STAGE_SECONDS * 1000) {
    await sleep(1000);
    peakRss = Math.max(peakRss, serverStats()?.rssMb ?? 0);
  }
  const s1 = serverStats();
  const secs = (Date.now() - t0) / 1000;
  const ok = samples.filter((x) => x.status > 0);
  const ms = ok.map((x) => x.ms).sort((a, b) => a - b);
  const errors = samples.filter((x) => x.status === 0 || x.status >= 500 || x.status === 429).length;
  const cpu = s0 && s1 ? ((s1.cpuTicks - s0.cpuTicks) / 100 / secs) * 100 : 0;
  console.log(`${fmt(target)}  ${fmt(samples.length / secs)}  ${fmt(percentile(ms, 50))} ${fmt(percentile(ms, 95))} ${fmt(percentile(ms, 99))}   ${fmt(ms[ms.length - 1] ?? 0)}  ${fmt(errors)}  ${fmt(cpu)}  ${fmt(peakRss)}`);
  const byRoute: Record<string, { n: number; p50: number; p95: number; errors: number }> = {};
  for (const route of [...new Set(samples.map((x) => x.route))]) {
    const rs = samples.filter((x) => x.route === route);
    const rms = rs.filter((x) => x.status > 0).map((x) => x.ms).sort((a, b) => a - b);
    byRoute[route] = { n: rs.length, p50: Math.round(percentile(rms, 50)), p95: Math.round(percentile(rms, 95)), errors: rs.filter((x) => x.status === 0 || x.status >= 500 || x.status === 429).length };
  }
  const statuses: Record<string, number> = {};
  for (const x of samples) statuses[x.status] = (statuses[x.status] ?? 0) + 1;
  report.push({ people: target, reqPerSec: +(samples.length / secs).toFixed(1), p50: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99), errors, cpu: Math.round(cpu), peakRssMb: peakRss, statuses, byRoute });
}
running = false;
await Promise.race([Promise.all(loops), sleep(15000)]);
const out = process.env['REPORT'] ?? '/tmp/load/report.json';
await import('node:fs').then((fs) => fs.writeFileSync(out, JSON.stringify(report, null, 2)));
console.log(`\nper-page details: ${out}`);
process.exit(0);
