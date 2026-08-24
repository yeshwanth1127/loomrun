#!/usr/bin/env bash
# Scheduled logical backup of the loomrun Postgres database.
# Runs pg_dump against DATABASE_URL (from repo root .env), verifies the dump
# is actually readable, and keeps a tiered local retention (hourly + daily).
# Installed via cron — see `crontab -l` for schedule.
set -euo pipefail

BACKUP_DIR="/var/backups/loomrun-postgres"
DAILY_DIR="$BACKUP_DIR/daily"
HOURLY_RETENTION_HOURS=48
DAILY_RETENTION_DAYS=30
SIZE_DROP_ALERT_PCT=50   # if the new dump is this much smaller than the last one, treat as a possible wipe
LOG_FILE="/var/log/loomrun-db-backup.log"
STATUS_FILE="$BACKUP_DIR/LAST_STATUS"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/loomrun_${TIMESTAMP}.dump"

exec >> "$LOG_FILE" 2>&1
echo "[$(date -u +%FT%TZ)] Backup starting -> $BACKUP_FILE"

set -a
source /var/www/loomrun/.env
set +a

mkdir -p "$BACKUP_DIR" "$DAILY_DIR"
chmod 700 "$BACKUP_DIR" "$DAILY_DIR"

fail() {
  echo "[$(date -u +%FT%TZ)] FAILED: $1"
  echo "FAILED $(date -u +%FT%TZ) $1" > "$STATUS_FILE"
  rm -f "$BACKUP_FILE.tmp"
  exit 1
}

pg_dump "$DATABASE_URL" -Fc -f "$BACKUP_FILE.tmp" || fail "pg_dump exited non-zero"

# Integrity check — make sure the archive is actually readable before trusting it.
pg_restore --list "$BACKUP_FILE.tmp" > /dev/null || fail "pg_restore --list could not read the new dump — treating as corrupt"

mv "$BACKUP_FILE.tmp" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

SIZE_BYTES="$(stat -c%s "$BACKUP_FILE")"
SIZE_HUMAN="$(du -h "$BACKUP_FILE" | cut -f1)"
echo "[$(date -u +%FT%TZ)] Backup complete: $BACKUP_FILE ($SIZE_HUMAN)"

# --- Size-anomaly guard -------------------------------------------------
# Compare against the most recent previous hourly dump. A sudden large
# shrink can mean the DB was wiped or truncated — if so, skip rotation this
# run so we don't delete the last known-good backups out from under an
# active incident (this is what could have happened in the 2026-07-15
# data-loss case: 7-day retention would have quietly rotated away the last
# good dumps within a week of an unnoticed wipe).
PREV_FILE="$(ls -1t "$BACKUP_DIR"/loomrun_*.dump 2>/dev/null | grep -vF "$BACKUP_FILE" | head -1 || true)"
ANOMALY=0
DROP_PCT=0
if [[ -n "$PREV_FILE" ]]; then
  PREV_SIZE="$(stat -c%s "$PREV_FILE")"
  if [[ "$PREV_SIZE" -gt 0 ]]; then
    DROP_PCT=$(( (PREV_SIZE - SIZE_BYTES) * 100 / PREV_SIZE ))
    if [[ "$DROP_PCT" -ge "$SIZE_DROP_ALERT_PCT" ]]; then
      ANOMALY=1
      echo "[$(date -u +%FT%TZ)] ANOMALY: new dump is ${DROP_PCT}% smaller than previous ($PREV_SIZE -> $SIZE_BYTES bytes). Skipping rotation this run — investigate before old backups age out."
    fi
  fi
fi

# --- Promote the first backup of the UTC day into the daily/ tier ------
HOUR="$(date -u +%H)"
if [[ "$HOUR" == "00" ]]; then
  cp "$BACKUP_FILE" "$DAILY_DIR/"
  chmod 600 "$DAILY_DIR/$(basename "$BACKUP_FILE")"
fi

if [[ "$ANOMALY" -eq 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name "loomrun_*.dump" -mmin "+$((HOURLY_RETENTION_HOURS * 60))" -print -delete
  find "$DAILY_DIR" -name "loomrun_*.dump" -mtime "+${DAILY_RETENTION_DAYS}" -print -delete
  echo "OK $(date -u +%FT%TZ) size=${SIZE_BYTES}" > "$STATUS_FILE"
else
  echo "WARN $(date -u +%FT%TZ) size_drop_pct=${DROP_PCT} rotation_skipped=1" > "$STATUS_FILE"
fi

HOURLY_COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -name "loomrun_*.dump" | wc -l)"
DAILY_COUNT="$(find "$DAILY_DIR" -name "loomrun_*.dump" | wc -l)"
echo "[$(date -u +%FT%TZ)] Retention: ${HOURLY_COUNT} hourly dump(s) (${HOURLY_RETENTION_HOURS}h window), ${DAILY_COUNT} daily dump(s) (${DAILY_RETENTION_DAYS}d window) retained."
