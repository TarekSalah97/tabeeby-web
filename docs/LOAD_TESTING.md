# Load and conflict testing

Run these against a **local copy** of the site, never the live one. The live site runs on free
plans (Render: 0.1 CPU, 512 MB; Neon free): load testing it would slow or stop it for real users,
trip its own rate limits, and use up Neon's free allowance. The scripts refuse a `LOAD_BASE` on
`onrender.com`, and the conflict script refuses a Neon/Render `DATABASE_URL`.

## 1. A production-like local copy

```sh
# PostgreSQL 16 with query statistics (to find slow queries)
pg_ctl -D <datadir> -o "-p 5433 -c shared_preload_libraries=pg_stat_statements -c max_connections=200" start
createdb -h 127.0.0.1 -p 5433 -U postgres loadtest
psql -h 127.0.0.1 -p 5433 -U postgres -d loadtest -c "create extension pg_stat_statements"

export DATABASE_URL=postgres://postgres:x@127.0.0.1:5433/loadtest
npx tsx scripts/migrate.ts
npx tsx scripts/seed-demo.ts                                   # demo accounts, used as templates
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/load/bulk.sql  # ~1 busy year: 500 doctors, 20k patients, 380k visits

npm run build
# Same settings as Render: production, 5 DB connections, one CPU core, ~400 MB heap.
NODE_ENV=production DEMO_MODE=false SMS_PROVIDER=none EMAIL_PROVIDER=none STORAGE_DRIVER=db TRUST_PROXY=true \
DATABASE_POOL_SIZE=5 PORT=4100 PUBLIC_ORIGIN=https://127.0.0.1:4100 LOG_LEVEL=warn \
taskset -c 0 node --max-old-space-size=400 dist/src/server.js
```

(`PUBLIC_ORIGIN` must be https in production; the scripts send that as the form origin.)
Load accounts use the demo password: doctors `011000000NN`, patients `012000NNNNN`.

## 2. Conflict tests (many people doing the same thing at once)

```sh
DATABASE_URL=… npx tsx scripts/load/conflicts.ts
```

Eleven scenarios: 40 patients booking one slot, one patient tapping Book 15 times, double
payments, "Arrived" vs "Didn't come", double-clicked patient file and visit saves, duplicate
reviews and sign-ups, overlapping working hours from two tabs, 30 parallel wrong passwords, and
patient and clinic cancelling together. Each checks the database outcome and that nobody saw a
server error. Exit code 0 means all passed.

## 3. Load test (speed as people increase)

```sh
SERVER_PID=$(pgrep -f dist/src/server.js) STAGES=10,25,50,100,200 STAGE_SECONDS=30 \
  taskset -c 1 npx tsx scripts/load/run.ts
```

Simulated mix: 60% visitors (home, search, doctor profile, a day's slots), 25% signed-in patients
(appointments, health record, medicines; some book and cancel), 15% doctors (schedule, patient
search, a patient file, income). `THINK_MS` is the pause between clicks (default 1 s; real people
take ~10 s, so each simulated person is about ten real ones). Per-page numbers go to
`/tmp/load/report.json`. Slowest queries:

```sql
select calls, round(mean_exec_time::numeric, 2) ms, left(query, 120)
  from pg_stat_statements order by total_exec_time desc limit 10;
```

To find what uses the CPU, start the server with `node --cpu-prof --cpu-prof-dir=/tmp/prof …`,
run a stage, stop the server with Ctrl-C, and open the `.cpuprofile` in Chrome DevTools.

## Results, 28 Nov 2026 (one CPU core, data above)

| People at once (1 click/s each) | Before fixes: p95 | After: p95 | CPU after |
|---|---|---|---|
| 50 | 86 ms | 15 ms | 15% |
| 100 | 724 ms | 35 ms | 30% |

Fixed in this round: server memory grew ~1 MB per page view (new date formatters on every
call) and would have crossed Render's 512 MB after a few thousand views; slot calculation used
~75% of CPU (time-zone conversion now remembered); the booked-times query read each doctor's whole
history (now uses the time-range index: 2.1 ms → 0.16 ms); double-clicked "Save patient file"
and "Save visit" showed error pages; the demo seed failed on a fresh database.

About 2.7 ms of CPU per page. On Render Free (0.1 CPU) that is roughly 35 pages a second at
most; at ~10 s between clicks, about 150–250 people actively using the site at the same moment
before it slows down. Render Starter (0.5 CPU, $7/month) is about five times that, and does not
sleep.
