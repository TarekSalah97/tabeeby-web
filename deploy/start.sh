#!/bin/sh
# Container entrypoint: apply migrations (advisory-locked, safe on every start),
# create/refresh the admin when ADMIN_* are set, then run the web server.
set -e
node dist/scripts/migrate.js
if [ -n "${ADMIN_PHONE:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  node dist/scripts/create-admin.js || echo "admin not created (check ADMIN_NAME / ADMIN_PHONE / ADMIN_PASSWORD)"
fi
# Separate TEST website only: load the fictional demo doctors, patients and visit history (safe to repeat).
if [ "${DEMO_MODE:-}" = "true" ] && [ "${SEED_DEMO:-}" = "true" ]; then
  node dist/scripts/seed-demo.js || echo "demo data not loaded"
fi
exec node dist/src/server.js
