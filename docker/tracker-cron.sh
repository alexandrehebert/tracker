#!/bin/sh
set -eu

TRACKER_CRON_URL=${TRACKER_CRON_URL:-http://tracker:4109/api/tracker/cron}
TRACKER_CRON_INTERVAL_SECONDS=${TRACKER_CRON_INTERVAL_SECONDS:-900}
TRACKER_CRON_STARTUP_DELAY_SECONDS=${TRACKER_CRON_STARTUP_DELAY_SECONDS:-20}

case "$TRACKER_CRON_INTERVAL_SECONDS" in
  ''|*[!0-9]*) TRACKER_CRON_INTERVAL_SECONDS=900 ;;
esac

case "$TRACKER_CRON_STARTUP_DELAY_SECONDS" in
  ''|*[!0-9]*) TRACKER_CRON_STARTUP_DELAY_SECONDS=20 ;;
esac

log() {
  printf '[tracker-cron] %s\n' "$1"
}

if [ "$TRACKER_CRON_STARTUP_DELAY_SECONDS" -gt 0 ] 2>/dev/null; then
  log "waiting ${TRACKER_CRON_STARTUP_DELAY_SECONDS}s before first run"
  sleep "$TRACKER_CRON_STARTUP_DELAY_SECONDS"
fi

while :; do
  if [ -n "${CRON_SECRET:-}" ]; then
    if curl --fail --silent --show-error --max-time 30 \
      -H "Authorization: Bearer ${CRON_SECRET}" \
      "$TRACKER_CRON_URL" >/dev/null; then
      log "cron request succeeded"
    else
      log "cron request failed"
    fi
  else
    if curl --fail --silent --show-error --max-time 30 \
      "$TRACKER_CRON_URL" >/dev/null; then
      log "cron request succeeded"
    else
      log "cron request failed"
    fi
  fi

  sleep "$TRACKER_CRON_INTERVAL_SECONDS"
done
