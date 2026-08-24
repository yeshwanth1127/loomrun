#!/usr/bin/env bash
# Periodic restore verification for loomrun Postgres backups.
# Restores the most recent dump into a throw-away database on the same
# Postgres server and sanity-checks row counts, so a backup is only trusted
# once it's proven restorable — not just assumed good because pg_dump
# exited 0. Installed via cron — see `crontab -l` for schedule.
set -euo pipefail

BACKUP_DIR="/var/backups/loomrun-postgres"
LOG_FILE="/var/log/loomrun-db-backup-verify.log"
STATUS_FILE="$BACKUP_DIR/LAST_VERIFY_STATUS"
SCRATCH_DB="loomrun_restore_verify"
CHECK_TABLES=(users organizations leads quotations)

exec >> "$LOG_FILE" 2>&1
echo "[$(date -u +%FT%TZ)] Restore verification starting"

set -a
source /var/www/loomrun/.env
set +a

fail() {
  echo "[$(date -u +%FT%TZ)] VERIFY FAILED: $1"
  echo "FAILED $(date -u +%FT%TZ) $1" > "$STATUS_FILE"
  dropdb -h "${PG_HOST:-}" -p "${PG_PORT:-5432}" -U "${PG_USER:-}" --if-exists "$SCRATCH_DB" 2>/dev/null || true
  exit 1
}

LATEST="$(ls -1t "$BACKUP_DIR"/loomrun_*.dump 2>/dev/null | head -1 || true)"
[[ -n "$LATEST" ]] || fail "no backup files found in $BACKUP_DIR"
echo "[$(date -u +%FT%TZ)] Verifying $LATEST"

# Parse DATABASE_URL (host/port/user/password) so we hit the same server —
# the password may contain URL-encoded characters (e.g. %40 for '@'), so use
# Python's urllib rather than a fragile regex.
PG_ENV="$(python3 - <<'PYEOF'
import os, urllib.parse as u, shlex
p = u.urlparse(os.environ["DATABASE_URL"])
print(f'PG_HOST={shlex.quote(p.hostname or "")}')
print(f'PG_PORT={shlex.quote(str(p.port or 5432))}')
print(f'PG_USER={shlex.quote(p.username or "")}')
print(f'PG_PASSWORD={shlex.quote(u.unquote(p.password or ""))}')
PYEOF
)"
eval "$PG_ENV"
export PGPASSWORD="$PG_PASSWORD"

dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" --if-exists "$SCRATCH_DB" 2>/dev/null || true
createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$SCRATCH_DB" || fail "createdb failed"

pg_restore -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$SCRATCH_DB" "$LATEST" \
  || fail "pg_restore into scratch db failed"

for TABLE in "${CHECK_TABLES[@]}"; do
  COUNT="$(psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$SCRATCH_DB" -tAc "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null || echo ERR)"
  if [[ "$COUNT" == "ERR" ]]; then
    fail "could not query table '${TABLE}' in restored backup"
  fi
  echo "[$(date -u +%FT%TZ)] ${TABLE}: ${COUNT} rows in restored backup"
  if [[ "$TABLE" == "users" && "$COUNT" -eq 0 ]]; then
    fail "restored backup has 0 users — treating as empty/corrupt backup"
  fi
done

dropdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" --if-exists "$SCRATCH_DB"
echo "OK $(date -u +%FT%TZ) file=$(basename "$LATEST")" > "$STATUS_FILE"
echo "[$(date -u +%FT%TZ)] Restore verification passed."
