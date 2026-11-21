# Deploying Tabeeby

This runbook takes the app from this repository to a live HTTPS site on one server. It is sized for the Alexandria launch (hundreds of doctors, thousands of patients); see "Scaling later" for the next step.

## Free hosting: Render (app) + Neon (database)

`render.yaml` runs the app on Render's free plan in Frankfurt with:

- `SMS_PROVIDER=none` — no SMS provider yet: sign-up skips phone verification and no confirmations or reminders are sent. Switch to `http` with a gateway when you have one (verification then turns on automatically).
- Email (optional, recommended): add `BREVO_API_KEY` (secret) and `EMAIL_FROM` (a sender address confirmed in Brevo) in Render → Environment. Email then turns on by itself: visitors can book without an account using an emailed code, patients can sign in with an emailed code, and patients with a confirmed email get booking confirmations. Without them the site works as before (visitors sign in to book). Brevo's free plan sends up to 300 emails a day.
- `STORAGE_DRIVER=db` — syndicate cards are stored in PostgreSQL, because Render's free disk is wiped on every restart.
- The database is an external free Neon PostgreSQL project (choose the Frankfurt region). Use its **direct** (not pooled) connection string with `?sslmode=require`.

Steps: create a Neon project → copy the connection string → Render → **New → Blueprint** → choose this repository → paste `DATABASE_URL`, `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PASSWORD` (14+ characters) → **Apply**. The site appears at `https://tabeeby.onrender.com` (or similar). Every push to `main` redeploys.

Limits of the free setup: the app sleeps after ~15 idle minutes (first visit then takes about a minute); data is hosted outside Egypt; free tiers have no uptime guarantee. Move to the server setup below before real scale.

A public **demo** with fictional data is the same setup with `DEMO_MODE=true` (demo banner, hidden from search engines, sign-in codes on screen) and `node dist/scripts/seed-demo.js` added to the start command.

## 0. Decisions you must make first (blocking)

| Decision | Why it blocks | Who decides |
|---|---|---|
| **Where patient data is hosted** — a server in Egypt, or abroad with a transfer licence | Egypt's Personal Data Protection Law (enforced since 31 Oct 2026) requires a licence from the Personal Data Protection Centre to process personal data, and a separate licence/permit to transfer it outside Egypt. Health data is "sensitive". | You + data-protection lawyer |
| **PDPC licence** for Tabeeby as data controller | Required before processing patient data at scale | Lawyer |
| **Privacy Policy & Terms** text | Pages `/privacy` and `/terms` currently show a placeholder | Lawyer |
| **SMS gateway** (Egyptian provider with OTP/transactional route) | Patients can't verify phones without it; the app refuses to start in production with the console provider | You |
| **Domain name** | Needed for HTTPS certificates | You |

`docs/DATA_INVENTORY.md` lists every personal-data field, why it exists and how long it is kept — give it to the lawyer.

## 1. Server

- Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM / 60 GB SSD is enough for launch.
- Hosting location per decision above.
- Create a non-root sudo user, disable password SSH login (keys only), enable the firewall:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw enable
sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades
```

- Install Docker Engine + Compose plugin (docs.docker.com/engine/install/ubuntu).

## 2. DNS

Point `A` (and `AAAA` if you have IPv6) records for `tabeeby.example` and `www.tabeeby.example` to the server. Caddy obtains Let's Encrypt certificates automatically once DNS resolves.

## 3. Configure

```bash
sudo mkdir -p /opt/tabeeby && sudo chown $USER /opt/tabeeby
git clone <your repo> /opt/tabeeby && cd /opt/tabeeby
cp .env.example .env.production && chmod 600 .env.production
```

Edit `.env.production`:

```
NODE_ENV=production
PUBLIC_ORIGIN=https://tabeeby.example
DOMAIN=tabeeby.example
ACME_EMAIL=ops@tabeeby.example
POSTGRES_PASSWORD=<openssl rand -hex 24>      # hex only: it is placed inside a URL
SMS_PROVIDER=http
SMS_HTTP_URL=<gateway endpoint>
SMS_HTTP_TOKEN=<gateway token>
SMS_SENDER_ID=Tabeeby
# Optional: email (booking without an account, sign-in codes, confirmations). Off unless the key is set.
BREVO_API_KEY=<key from app.brevo.com → SMTP & API → API keys>   # secret
EMAIL_FROM=<sender address confirmed in Brevo>
EMAIL_FROM_NAME=Tabeeby طبيبي
# Optional: "Which specialist do I need?" (AI symptom checker). Hidden unless the key is set.
ANTHROPIC_API_KEY=<key from console.anthropic.com>   # secret
AI_MODEL=claude-haiku-5-5                            # default
AI_DAILY_LIMIT=500                                   # AI calls per day site-wide; keyword matching after that
```

`DATABASE_URL`, `UPLOAD_DIR` and `TRUST_PROXY` are set by the compose file. If your gateway's API is not `POST {to, sender, body}` with a bearer token, adapt `HttpSmsProvider` in `src/services/sms.ts` (one class) and add a test.

## 4. First deploy

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production ps     # all healthy?
curl -fsS https://tabeeby.example/healthz                                           # {"ok":true}
```

The `migrate` service runs all pending migrations before the app starts (advisory-locked, so two deploys can't race).

Create the first admin (credentials via environment, never on the command line history):

```bash
read -s ADMIN_PASSWORD && export ADMIN_PASSWORD
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production run --rm \
  -e ADMIN_NAME="Your Name" -e ADMIN_PHONE=010XXXXXXXX -e ADMIN_PASSWORD app node dist/scripts/create-admin.js
unset ADMIN_PASSWORD
```

**Do not run `seed:demo` in production** (it refuses anyway).

Add your real insurers list (there is no admin UI for reference data in v1):

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production exec db \
  psql -U tabeeby -c "insert into insurers (slug, name_en, name_ar) values ('example', 'Example Insurance', 'مثال للتأمين');"
```

Districts, specialties and condition keywords are seeded by `migrations/002_reference_data.sql`; have a doctor review them. Changes go in a **new** migration file (applied files are checksummed and must not be edited).

## 5. Smoke test after every deploy

1. `/` (Arabic) and `/en` load over HTTPS; padlock valid.
2. Sign up as a patient with a real phone → SMS code arrives → verify.
3. Join as a doctor with a test card → verify phone → add clinic + hours.
4. Admin: approve the test doctor → doctor appears in search.
5. Book as the patient → confirmation SMS → appears in doctor dashboard → mark arrived / finish.
6. Admin: suspend the test doctor afterwards.

## 6. Backups (do this before launch)

```bash
sudo crontab -e
15 2 * * * /opt/tabeeby/deploy/backup.sh >> /var/log/tabeeby-backup.log 2>&1
```

`backup.sh` writes a verified `pg_dump` and an uploads archive to `/var/backups/tabeeby`, keeping 14 days. **Also copy them off the server** daily (e.g. `rclone` to encrypted object storage in an approved location). A backup on the same disk is not a backup.

**Restore drill (monthly):**

```bash
docker compose ... exec -T db createdb -U tabeeby restore_check
docker compose ... exec -T db pg_restore -U tabeeby -d restore_check --no-owner < /var/backups/tabeeby/db-<stamp>.dump
docker compose ... exec -T db psql -U tabeeby -d restore_check -c "select count(*) from appointments;"
docker compose ... exec -T db dropdb -U tabeeby restore_check
```

## 7. Updating

```bash
cd /opt/tabeeby && git pull
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations are forward-only. To roll back code, check out the previous commit and rebuild; write new migrations so the previous release still works with the new schema (add columns first, remove later).

## 8. Monitoring

- Uptime monitor on `https://tabeeby.example/healthz` (checks the database too), alert by SMS/email.
- Logs: `docker compose ... logs -f app` — JSON lines with route, status and duration, no personal data. Ship them to a log service when you have one.
- Watch `notification_outbox` for `status = 'failed'` (SMS gateway problems):
  `select count(*) from notification_outbox where status = 'failed' and created_at > now() - interval '1 day';`
- Add error tracking (e.g. Sentry) when package installs are available; hook it into `log.error`.

## 9. Security checklist before launch

- [ ] `.env.production` is mode 600 and not in git
- [ ] PostgreSQL port is not published (compose keeps it internal)
- [ ] SSH keys only, firewall on, unattended upgrades on
- [ ] Admin accounts use long unique passwords; one account per person (audit log is per user)
- [ ] Backups run, are copied off-server, and a restore was tested
- [ ] Privacy Policy and Terms published; PDPC licence obtained
- [ ] An external penetration test before public launch
- [ ] Replace `src/db/pg.ts` with the `pg` package and add `argon2` when installs are available (both are drop-in)

## Scaling later

- Run the worker separately: set `RUN_WORKER=false` on web replicas and start one container with `RUN_WORKER=true`. Outbox delivery uses `SKIP LOCKED`, so several workers are also safe.
- Move PostgreSQL to a managed service in an approved location (`DATABASE_SSL=require`), with point-in-time recovery.
- Move uploads to private object storage with server-side encryption (implement `FileStorage`).
- Several app replicas behind Caddy/a load balancer: sessions and rate limits are already in Postgres, so the app is stateless.


### Optional: no-show protection

`NO_SHOW_LIMIT` (default 3) and `NO_SHOW_WINDOW_DAYS` (default 180): after that many missed appointments in the window, a patient can no longer book online until an admin allows it again. The defaults need no setting.
