#!/usr/bin/env bash
# Production OTP-only smoke. It never calls checkout or creates a render job.
# Required: BASE_URL=https://<production-web>, TEST_EMAIL, OTP_CODE (read from
# the controlled inbox after request). Evidence deliberately redacts cookies
# and never writes the six-digit OTP to disk.
set -euo pipefail

: "${BASE_URL:?BASE_URL wajib diisi}"
: "${TEST_EMAIL:?TEST_EMAIL wajib diisi}"
: "${OTP_CODE:?OTP_CODE wajib diisi dari inbox uji terkendali}"
BASE_URL="${BASE_URL%/}"
OUT_DIR="${OUT_DIR:-test_output/production-auth-smoke-$(date +%Y%m%dT%H%M%SZ)}"
mkdir -p "$OUT_DIR"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

status="$(curl -sS -o "$OUT_DIR/dev-login.json" -w '%{http_code}' -X POST "$BASE_URL/api/auth/dev-login" -H 'content-type: application/json' --data '{"phone":"08123456789"}')"
[[ "$status" == "403" ]] || { echo "FAIL: dev-login harus 403, aktual $status" >&2; exit 1; }
jq -e '.code == "DEV_ROUTE_DISABLED"' "$OUT_DIR/dev-login.json" >/dev/null

status="$(curl -sS -o "$OUT_DIR/request-otp.json" -w '%{http_code}' -X POST "$BASE_URL/api/auth/request-otp" -H 'content-type: application/json' --data "$(jq -nc --arg email "$TEST_EMAIL" '{email:$email}')")"
[[ "$status" == "200" ]] || { echo "FAIL: request OTP harus 200, aktual $status" >&2; exit 1; }
jq -e '.mode == "live" and .email_live == true and (has("dev_hint") | not)' "$OUT_DIR/request-otp.json" >/dev/null

status="$(curl -sS -c "$JAR" -o "$OUT_DIR/verify-otp.json" -w '%{http_code}' -X POST "$BASE_URL/api/auth/verify-otp" -H 'content-type: application/json' --data "$(jq -nc --arg email "$TEST_EMAIL" --arg code "$OTP_CODE" '{email:$email,code:$code}')")"
[[ "$status" == "200" ]] || { echo "FAIL: verify OTP harus 200, aktual $status" >&2; exit 1; }

curl -fsS -b "$JAR" "$BASE_URL/api/health" > "$OUT_DIR/health.json"
jq -e '.ok == true and .intake == "open"' "$OUT_DIR/health.json" >/dev/null
printf 'PASS: OTP live, dev-login tertutup, dan health open. Cookie/OTP tidak disimpan.\n' | tee "$OUT_DIR/result.txt"
