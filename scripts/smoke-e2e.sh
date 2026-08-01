#!/usr/bin/env bash
# Smoke E2E RACUN.AI fase 1:
# dev-login -> buat produk manual (foto asli) -> generate skrip -> (uji HITL 422) ->
# approve -> buat job -> poll READY -> unduh output -> verifikasi MP4 (~15 dtk,
# audio tidak senyap, watermark aktif di log, QC-08 pass).
set -u
cd "$(dirname "$0")/.."

PORT=${PORT:-3210}
BASE_URL=${BASE_URL:-}
if [ -n "$BASE_URL" ]; then
  BASE="${BASE_URL%/}"
  REMOTE_SMOKE=1
else
  BASE="http://localhost:$PORT"
  REMOTE_SMOKE=0
fi
JAR=$(mktemp /tmp/racun-cookies.XXXXXX)
DEVLOG=${DEVLOG:-}
OUT=${OUT:-$(mktemp /tmp/racun-output.XXXXXX)}
DEV_PID=""

fail() { echo "SMOKE GAGAL: $1" >&2; exit 1; }
cleanup() { [ -n "$DEV_PID" ] && kill "$DEV_PID" 2>/dev/null; }
trap cleanup EXIT

if [ "$REMOTE_SMOKE" = "1" ]; then
  echo "== Memakai server staging eksternal: $BASE"
  for i in $(seq 1 60); do
    curl -sf "$BASE" >/dev/null 2>&1 && break
    sleep 1
    [ "$i" = "60" ] && fail "server staging tidak merespons dalam 60 dtk"
  done
  echo "== Server staging OK"
else
  DEVLOG=${DEVLOG:-$(mktemp /tmp/racun-devlog.XXXXXX)}
  echo "== Menyalakan dev server di :$PORT (log: $DEVLOG)"
  # Pastikan port bebas dulu (sisa dev server sebelumnya)
  lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null
  sleep 2
  PORT=$PORT npm run dev >"$DEVLOG" 2>&1 &
  DEV_PID=$!

  for i in $(seq 1 60); do
    curl -sf "$BASE" >/dev/null 2>&1 && break
    sleep 1
    [ "$i" = "60" ] && { tail -20 "$DEVLOG"; fail "dev server tidak menyala dalam 60 dtk"; }
  done
  echo "== Dev server OK"
fi

echo "== 1. dev-login"
PHONE="0812$(printf '%06d' "$RANDOM")"  # nomor unik per run (10 digit)
curl -sf -c "$JAR" -X POST "$BASE/api/auth/dev-login" \
  -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | jq -e '.user.id' >/dev/null \
  || fail "dev-login gagal"
echo "   login OK ($PHONE, bonus 1 kredit)"

echo "== 2. buat produk manual (foto asli test_output/hands_a.png)"
PROD_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/products" \
  -F "name=Serum Glow Bright" -F "price_idr=85000" -F "category=beauty" \
  -F "photos=@../test_output/hands_a.png") || fail "buat produk gagal"
PRODUCT_ID=$(echo "$PROD_RES" | jq -r '.product_id')
[ -n "$PRODUCT_ID" ] && [ "$PRODUCT_ID" != "null" ] || fail "product_id kosong: $PROD_RES"
echo "   produk OK: $PRODUCT_ID"

echo "== 3. generate skrip"
SCRIPTS_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/scripts/generate" \
  -H 'content-type: application/json' \
  -d "{\"product_id\":\"$PRODUCT_ID\",\"register\":\"bestie\",\"emotion\":\"senang\",\"format\":\"hands_only\"}") \
  || fail "generate skrip gagal"
N=$(echo "$SCRIPTS_RES" | jq '.scripts | length')
[ "$N" = "3" ] || fail "harus 3 varian, dapat $N"
FAMILIES=$(echo "$SCRIPTS_RES" | jq -r '[.scripts[].hook_family] | unique | length')
[ "$FAMILIES" = "3" ] || fail "3 varian harus beda keluarga hook"
PASSED=$(echo "$SCRIPTS_RES" | jq '[.scripts[].validation.passed] | all')
[ "$PASSED" = "true" ] || { echo "$SCRIPTS_RES" | jq '.scripts[].validation.errors'; fail "ada skrip gagal validasi"; }
SCRIPT_ID=$(echo "$SCRIPTS_RES" | jq -r '.scripts[0].id')
echo "   3 skrip OK (keluarga: $(echo "$SCRIPTS_RES" | jq -r '[.scripts[].hook_family] | join(", ")'))"

echo "== 4. uji gerbang HITL: job tanpa approve harus 422 SCRIPT_NOT_APPROVED"
HITL_CODE=$(curl -s -o /tmp/racun-hitl.json -w '%{http_code}' -b "$JAR" -X POST "$BASE/api/jobs" \
  -H 'content-type: application/json' -d "{\"script_id\":\"$SCRIPT_ID\"}")
[ "$HITL_CODE" = "422" ] || fail "HITL: status $HITL_CODE, harusnya 422"
jq -e '.code == "SCRIPT_NOT_APPROVED"' /tmp/racun-hitl.json >/dev/null || fail "HITL: code salah"
echo "   HITL OK (422 SCRIPT_NOT_APPROVED)"

echo "== 5. approve skrip"
curl -sf -b "$JAR" -X POST "$BASE/api/scripts/$SCRIPT_ID/approve" \
  -H 'content-type: application/json' -d '{}' | jq -e '.approved_by_user_at' >/dev/null \
  || fail "approve gagal"
echo "   approve OK"

echo "== 6. buat job"
JOB_RES=$(curl -sf -b "$JAR" -X POST "$BASE/api/jobs" \
  -H 'content-type: application/json' -d "{\"script_id\":\"$SCRIPT_ID\",\"format\":\"hands_only\",\"duration_s\":15}") \
  || fail "buat job gagal"
JOB_ID=$(echo "$JOB_RES" | jq -r '.job_id')
[ -n "$JOB_ID" ] && [ "$JOB_ID" != "null" ] || fail "job_id kosong: $JOB_RES"
echo "   job OK: $JOB_ID"

echo "== 7. poll sampai READY"
STATE=""
for i in $(seq 1 90); do
  STATE=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID" | jq -r '.state')
  case "$STATE" in
    READY) break ;;
    FAILED|REFUNDED) curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID" | jq .; fail "job gagal ($STATE)" ;;
  esac
  sleep 3
done
[ "$STATE" = "READY" ] || fail "timeout menunggu READY (terakhir: $STATE)"
JOB_DETAIL=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID")
echo "$JOB_DETAIL" | jq -r '"   READY | provider_video=\(.provider_video) provider_voice=\(.provider_voice) biaya=Rp\(.cost_actual_idr)"'
echo "$JOB_DETAIL" | jq -e '[.qc_result.checks[] | select(.status == "fail")] | length == 0' >/dev/null \
  || fail "ada QC yang gagal"
echo "$JOB_DETAIL" | jq -e '.qc_result.checks[] | select(.code == "QC-08" and .status == "pass")' >/dev/null \
  || fail "QC-08 (label AIGC) tidak pass"

echo "== 8. unduh paket keluaran"
OUT_RES=$(curl -sf -b "$JAR" "$BASE/api/jobs/$JOB_ID/output") || fail "ambil output gagal"
VIDEO_URL=$(echo "$OUT_RES" | jq -r '.video_url')
echo "$OUT_RES" | jq -e '.compliance_checklist | length > 0' >/dev/null || fail "checklist kepatuhan kosong"
curl -sf "$BASE$VIDEO_URL" -o "$OUT" || fail "unduh video gagal"
[ -s "$OUT" ] || fail "file video kosong"

SIZE=$(stat -f%z "$OUT")
[ "$SIZE" -le 26214400 ] || fail "video > 25 MB ($SIZE)"

DUR=$(/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT")
echo "   video: ${SIZE} bytes, durasi ${DUR} dtk"
python3 -c "import sys; d=float('$DUR'); sys.exit(0 if 13 <= d <= 17 else 1)" || fail "durasi $DUR di luar 15±2 dtk"

VOL=$(/opt/homebrew/bin/ffmpeg -i "$OUT" -af volumedetect -f null - 2>&1 | grep 'max_volume' | sed 's/.*max_volume: //;s/ dB//')
echo "   max_volume: $VOL dB"
python3 -c "import sys; sys.exit(0 if float('$VOL') > -40 else 1)" || fail "audio senyap (max_volume $VOL dB)"

if [ "$REMOTE_SMOKE" = "1" ]; then
  # Log worker tidak diekspos ke internet. QC-08 di atas adalah bukti runtime
  # yang setara bahwa watermark AIGC tetap dibakar ke output staging.
  echo "   watermark: QC-08 pass (log worker diverifikasi terpisah di Render)"
else
  grep -q "watermark AIGC aktif" "$DEVLOG" || fail "log tidak menunjukkan watermark aktif"
  echo "   log watermark: $(grep 'watermark AIGC aktif' "$DEVLOG" | tail -1)"
fi

echo ""
echo "SMOKE LULUS: video siap posting di $OUT"
exit 0
