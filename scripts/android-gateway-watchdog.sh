#!/bin/bash
# Watchdog: pings the Android SMS Gateway health endpoint to keep the app active.
# Runs every minute via cron. Logs to /tmp/android-gateway-watchdog.log.

ENV_FILE="$(dirname "$0")/../.env"

if [ -f "$ENV_FILE" ]; then
  GATEWAY_BASE_URL=$(grep '^GATEWAY_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)
  GATEWAY_LOGIN=$(grep '^GATEWAY_LOGIN=' "$ENV_FILE" | cut -d= -f2-)
  GATEWAY_PASSWORD=$(grep '^GATEWAY_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
fi

GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-$1}"

if [ -z "$GATEWAY_BASE_URL" ] || [ -z "$GATEWAY_LOGIN" ] || [ -z "$GATEWAY_PASSWORD" ]; then
  echo "[$(date -Iseconds)] ERROR: GATEWAY_BASE_URL, GATEWAY_LOGIN, GATEWAY_PASSWORD must be set in .env or environment"
  exit 1
fi

HEALTH_URL="${GATEWAY_BASE_URL%/}/3rdparty/v1/health"

if curl -sf -u "$GATEWAY_LOGIN:$GATEWAY_PASSWORD" --max-time 5 "$HEALTH_URL" > /dev/null; then
  exit 0
fi

echo "[$(date -Iseconds)] Gateway health check failed — phone may be idle"
