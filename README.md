# Tabeeby (طبيبي)

Find, verify and book doctors and dentists in Egypt. Arabic-first, English under `/en`.

**v1 scope:** patient website (search by specialty / subspecialty / condition / district / insurance, doctor profiles, real availability, booking, my appointments), doctors landing page with pricing and sign-up (syndicate card upload, experience calculated from positions), doctor dashboard (daily schedule, clinics, working hours, time off, profile), admin verification panel, SMS confirmations and reminders.

**Since v1:** patient files with visits, prescriptions and lab orders (per-doctor switch), the AI symptom checker, verified reviews, a waitlist for fully booked days, one-tap rebooking, and phone-first quick actions for patients and doctors.

**Not built yet:** follow-up scheduling by type, messaging, online payments, receptionist accounts, lab/pharmacy accounts, mobile apps.

---

## Architecture

```
Browser ──HTTPS──▶ Caddy (TLS, gzip) ──▶ Node 22 app ──▶ PostgreSQL 16
                                          │   ├─ server-rendered HTML (SEO, works without JS)
                                          │   ├─ notification worker (outbox → SMS gateway)
                                          └── private uploads volume (syndicate cards)
```

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 22 + TypeScript (strict) | One language, typed end to end |
| HTTP | Small built-in router (`src/http`) | Few dependencies, small attack surface |
| Views | Auto-escaping `html``…`` templates | XSS-safe by default, fast SSR, indexable by Google |
| Database | PostgreSQL 16 | Constraints do the hard guarantees (see below) |
| Validation | zod (config), explicit domain validation | |
| Auth | Server-side sessions, scrypt hashes, SMS OTP | Revocable sessions; no JWTs to leak |

> **Why no framework / `pg` driver?** The build environment had no package-install access. The app depends only on `zod` at runtime. `src/db/pg.ts` is a small PostgreSQL client (parameterised queries, TLS, SCRAM). It mirrors `pg.Pool`'s shape, so moving to the standard `pg` package means changing `src/db/db.ts` only. **Recommended once installs are available.**

### Guarantees enforced by the database, not just code
- **No double booking:** `appointments_no_overlap` exclusion constraint — a doctor can never have two overlapping live appointments, across clinics, under any concurrency (tested with 12 parallel bookings).
- Phone numbers are valid Egyptian mobiles; months/fees/slot lengths are range-checked; every foreign key is declared.

### Security model
- Every dashboard/admin query is scoped by the signed-in user's id (`doctor_id = $session_user`) — no IDOR; other people's records return 404.
- CSRF: SameSite=Lax cookies + Origin check + per-browser token on every POST.
- Strict CSP (no inline scripts, no third-party origins — fonts are system fonts, so no visitor data goes to Google).
- Sessions: random 256-bit token, only its SHA-256 stored; staff sessions expire faster (admin: 1h idle).
- Passwords: scrypt (OWASP parameters), 9+ chars, common-password and name checks, constant-time verify, same response for unknown phone and wrong password.
- Rate limits (Postgres-backed, shared across instances) on login, sign-up, OTP, booking.
- Uploads: type detected from file content, random storage keys, never web-served; admin views are audited and served with `CSP: sandbox`.
- Audit log for logins, bookings, status changes, verification decisions, document views.
- Logs never contain names, phone numbers, reasons for visit or tokens.

## Run locally

Requirements: Node 22+, PostgreSQL 16 (with `btree_gist` and `citext`, both standard contrib).

```bash
cp .env.example .env            # edit DATABASE_URL
npm install
npm run migrate
npm run seed:demo               # fictional doctors + a demo patient (refuses in production)
ADMIN_NAME="Ops" ADMIN_PHONE=01000000301 ADMIN_PASSWORD='a-long-admin-passphrase' npm run create-admin
npm run dev                     # http://localhost:3000 (Arabic) and /en (English)
```

With `SMS_PROVIDER=console`, SMS codes are printed in the server log.

Demo logins (after `seed:demo`), password `demo-password-2026`: patient `01000000201`, doctors `01000000101`–`01000000106`.

## Tests

```bash
npm run typecheck
npm run test:unit                                   # 27 tests, no database needed
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm run test:integration   # 18 tests, creates/drops a temp DB per file
TEST_DATABASE_URL=… npm run test:e2e                # 3 browser tests (Playwright/Chromium)
```

Covered: phone parsing, experience overlap maths, availability incl. DST, status rules, password policy, escaping, multipart parsing, CSRF, open redirects, i18n completeness, full patient journey, doctor onboarding → admin approval → visit, double-booking race, access control between doctors/patients/admins, rate limiting, session handling, audited document access, mobile layout overflow, console/CSP errors.

## Project layout

```
src/
  app.ts, server.ts       request pipeline, process lifecycle
  config.ts               validated env config (refuses unsafe production settings)
  db/                     Postgres client, transactions, migrations runner
  http/                   router, body parsing, cookies, security headers, static files
  auth/                   passwords, sessions, CSRF, rate limits
  domain/                 pure business rules (phone, time zones, availability, experience, status)
  services/               use cases (accounts, doctors, search, booking, admin, outbox)
  routes/                 HTTP handlers (thin)
  views/                  templates (layout, components, pages)
  i18n/                   ar + en dictionaries (types enforce parity)
  jobs/worker.ts          reminders, SMS delivery, cleanup
migrations/               forward-only SQL (checksummed)
deploy/                   Docker Compose (Postgres + app + Caddy), backups
docs/                     DEPLOY.md, USER_STORIES.md, DATA_INVENTORY.md
```

See **docs/DEPLOY.md** to go live. The free setup (Render + Neon) is described in `render.yaml` and the same guide.
