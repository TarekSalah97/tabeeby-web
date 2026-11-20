#!/usr/bin/env bash
# Nightly backup of the database and private uploads, kept for 14 days locally.
# Copy the archives OFF the server too (see docs/DEPLOY.md, "Backups").
# Cron (as root on the server):  15 2 * * *  /opt/tabeeby/deploy/backup.sh >> /var/log/tabeeby-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tabeeby}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml --env-file .env.production"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Custom-format dump: compressed, restorable table by table with pg_restore.
$COMPOSE exec -T db pg_dump -U tabeeby -d tabeeby --format=custom --no-owner > "$BACKUP_DIR/db-$STAMP.dump"
$COMPOSE exec -T app tar -C /data -czf - uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

# Fail loudly on an empty or unreadable dump.
test -s "$BACKUP_DIR/db-$STAMP.dump"
$COMPOSE exec -T db pg_restore --list < "$BACKUP_DIR/db-$STAMP.dump" > /dev/null

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: db-$STAMP.dump uploads-$STAMP.tar.gz"
