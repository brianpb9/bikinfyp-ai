#!/bin/sh
set -eu

URL=${STAGING_HEALTH_URL:?STAGING_HEALTH_URL is required}
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT INT TERM HUP
STATUS=$(curl -sS -o "$TMP" -w '%{http_code}' "$URL")
HASH=$(shasum -a 256 "$TMP" | awk '{print $1}')
printf 'observed_at=%s\nurl=%s\nhttp_status=%s\nbody_sha256=%s\nbody_begin\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$URL" "$STATUS" "$HASH"
cat "$TMP"
printf '\nbody_end\n'
