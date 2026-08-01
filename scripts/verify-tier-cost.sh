#!/usr/bin/env bash
# Verifikasi COGS NYATA (bukan estimasi) untuk 1 tier bersuara via BytePlus asli.
# Pakai: bash scripts/verify-tier-cost.sh high_quality|super_hq
set -u
cd "$(dirname "$0")/.."

TIER="${1:-high_quality}"
case "$TIER" in
  high_quality) PKG="hq10" ;;
  super_hq) PKG="super5" ;;
  *) echo "tier harus high_quality atau super_hq"; exit 1 ;;
esac

OUT_DIR="../test_output/tier_cost_verify_${TIER}"
mkdir -p "$OUT_DIR"

set -a
[ -f .env.local ] && . ./.env.local
set +a
if [ -z "${BYTEPLUS_ARK_API_KEY:-}" ]; then
  echo "BYTEPLUS_ARK_API_KEY kosong — batal."; exit 1
fi

PORT=${PORT:-3299}
BASE="http://localhost:$PORT"
JAR=$(mktemp /tmp/racun-cookies.XXXXXX)
DEVLOG="$OUT_DIR/dev.log"
OUT="$OUT_DIR/output.mp4"
DEV_PID=""
fail() { echo "GAGAL: $1" >&2; exit 1; }
cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null; }
trap cleanup EXIT

echo "== [$TIER] Menyalakan dev server :$PORT (PROVIDER_VIDEO=byteplus)"
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null
sleep 2
PROVIDER_VIDEO=byteplus PORT=$PORT npm run dev >"$DEVLOG" 2>&1 &
DEV_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE" >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = "60" ] && { tail -30 "$DEVLOG"; fail "dev server tidak menyala"; }
done
echo "== Dev server OK"

PHONE="0813$(printf '%06d' "$RANDOM")"
curl -sf -c "$JAR" -X POST "$BASE/api/auth/dev-login" -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | jq -e '.user.id' >/dev/null || fail "dev-login"
echo "== login OK ($PHONE)"

TOPUP=$(curl -sf -b "$JAR" -X POST "$BASE/api/credits/topup" -H 'content-type: application/json' -d "{\"package_id\":\"$PKG\"}") || fail "topup"
echo "== topup OK: $(echo "$TOPUP" | jq -c '{amount_idr_added,balance}')"

PROD_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/products" -F "name=Serum Glow Bright" -F "price_idr=85000" -F "category=beauty" -F "photos=@../test_output/hands_a.png") || fail "buat produk"
PRODUCT_ID=$(echo "$PROD_RES" | jq -r '.product_id')
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "product_id kosong: $PROD_RES"
echo "== produk OK: $PRODUCT_ID"

SCRIPTS_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/scripts/generate" -H 'content-type: application/json' \
  -d "{\"product_id\":\"$PRODUCT_ID\",\"register\":\"bestie\",\"emotion\":\"senang\",\"quality_tier\":\"$TIER\"}") || fail "generate skrip"
PASSED=$(echo "$SCRIPTS_RES" | jq '[.scripts[].validation.passed] | all')
[ "$PASSED" = "true" ] || { echo "$SCRIPTS_RES" | jq '.scripts[].validation.errors'; fail "skrip gagal validasi"; }
SCRIPT_ID=$(echo "$SCRIPTS_RES" | jq -r '.scripts[0].id')
echo "== skrip OK: $SCRIPT_ID (tier=$TIER)"

curl -sf -b "$JAR" -X POST "$BASE/api/scripts/$SCRIPT_ID/approve" -H 'content-type: application/json' -d '{}' | jq -e '.approved_by_user_at' >/dev/null || fail "approve"
echo "== approve OK"

JOB_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/jobs" -H 'content-type: application/json' \
  -d "{\"script_id\":\"$SCRIPT_ID\",\"format\":\"hands_only\",\"duration_s\":15,\"quality_tier\":\"$TIER\"}") || fail "buat job"
JOB_ID=$(echo "$JOB_RES" | jq -r '.job_id')
[ -n "$JOB_ID" ] && [ "$JOB_ID" != "null" ] || fail "job_id kosong: $JOB_RES"
echo "== job OK: $JOB_ID — polling (render bersuara bisa 5-45 menit)..."

STATE=""
for i in $(seq 1 600); do
  STATE=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID" | jq -r '.state')
  case "$STATE" in
    READY) break ;;
    FAILED|REFUNDED) curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID" | jq . > "$OUT_DIR/job-failed.json"; fail "job $STATE — lihat $OUT_DIR/job-failed.json" ;;
  esac
  sleep 5
done
[ "$STATE" = "READY" ] || fail "timeout menunggu READY (terakhir: $STATE)"

JOB_DETAIL=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID")
echo "$JOB_DETAIL" > "$OUT_DIR/job-detail.json"
COST=$(echo "$JOB_DETAIL" | jq -r '.cost_actual_idr')
echo "== READY | biaya aktual: Rp$COST"

OUT_RES=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID/output") || fail "ambil output"
VIDEO_URL=$(echo "$OUT_RES" | jq -r '.video_url')
curl -sf "$BASE$VIDEO_URL" -o "$OUT" || fail "unduh video"
[ -s "$OUT" ] || fail "video kosong"

grep -E "\[byteplus\]|\[job " "$DEVLOG" > "$OUT_DIR/byteplus-events.log" 2>/dev/null || true

{
  echo "# VERIFIKASI COGS NYATA — tier: $TIER"
  echo ""
  echo "Tanggal: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Job: $JOB_ID · Biaya aktual dari DB (ledger): Rp$COST"
  echo ""
  echo "## Peristiwa provider (submit -> selesai, biaya per shot aktual/estimasi)"
  echo '```'
  cat "$OUT_DIR/byteplus-events.log"
  echo '```'
} > "$OUT_DIR/RINGKASAN.md"
cat "$OUT_DIR/RINGKASAN.md"
echo "SELESAI: $TIER — video di $OUT"
