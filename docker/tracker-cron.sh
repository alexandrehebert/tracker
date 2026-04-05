#!/bin/sh
set -eu

TRACKER_CRON_URL="${TRACKER_CRON_URL:-http://tracker:4109/api/tracker/cron}"
TRACKER_CRON_INTERVAL_SECONDS="${TRACKER_CRON_INTERVAL_SECONDS:-900}"
TRACKER_CRON_STARTUP_DELAY_SECONDS="${TRACKER_CRON_STARTUP_DELAY_SECONDS:-20}"

log() {
  printf '[tracker-cron] %s %s\n' "$(date -Iseconds)" "$*"
}

if [ "$TRACKER_CRON_STARTUP_DELAY_SECONDS" -gt 0 ] 2>/dev/null; then
  log "waiting ${TRACKER_CRON_STARTUP_DELAY_SECONDS}s for the tracker service to settle"
  sleep "$TRACKER_CRON_STARTUP_DELAY_SECONDS"
fi

log "scheduler started for ${TRACKER_CRON_URL} every ${TRACKER_CRON_INTERVAL_SECONDS}s"

while true; do
  if [ -n "${CRON_SECRET:-}" ]; then
    if response=$(curl --fail --silent --show-error --max-time 60 \
      -H "Authorization: Bearer ${CRON_SECRET}" \
      "$TRACKER_CRON_URL"); then
      log "cron trigger succeeded: ${response}"
    else
      exit_code=$?
      log "cron trigger failed with exit code ${exit_code}"
    fi
  else
    if response=$(curl --fail --silent --show-error --max-time 60 "$TRACKER_CRON_URL"); then
      log "cron trigger succeeded: ${response}"
    else
      exit_code=$?
      log "cron trigger failed with exit code ${exit_code}"
    fi
  fi

  sleep "$TRACKER_CRON_INTERVAL_SECONDS"
done
