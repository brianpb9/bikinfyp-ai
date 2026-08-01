#!/usr/bin/env bash
# Harness verifikasi BytePlus — siap jalan begitu BYTEPLUS_ARK_API_KEY terisi.
# Menjalankan 1 job nyata end-to-end (PROVIDER_VIDEO=byteplus) lewat jalur smoke-e2e,
# lalu menyimpan video + log + ringkasan ke test_output/byteplus_verify/.
# Tanpa key: exit bersih dengan pesan jelas (bukan crash). Error mentah TIDAK disembunyikan.
set -u
cd "$(dirname "$0")/.."

OUT_DIR="../test_output/byteplus_verify"
mkdir -p "$OUT_DIR"

# Muat .env.local (Next membaca file ini otomatis; shell script tidak)
set -a
[ -f .env.local ] && . ./.env.local
set +a

if [ -z "${BYTEPLUS_ARK_API_KEY:-}" ]; then
  echo "BYTEPLUS_ARK_API_KEY belum diisi — verifikasi dilewati."
  echo "Isi key di .env.local atau export dulu, lalu jalankan ulang: bash scripts/verify-byteplus.sh"
  exit 0
fi

echo "== Verifikasi BytePlus ModelArk"
echo "   model: ${BYTEPLUS_ARK_MODEL:-seedance-1-0-pro-fast-251015} · resolusi: ${BYTEPLUS_ARK_RESOLUTION:-480p}"
START=$(date +%s)

export PROVIDER_VIDEO=byteplus
export PORT=${PORT:-3216}
export DEVLOG="$OUT_DIR/dev.log"
export OUT="$OUT_DIR/output.mp4"

set +e
bash scripts/smoke-e2e.sh 2>&1 | tee "$OUT_DIR/smoke-output.log"
SMOKE_EXIT=${PIPESTATUS[0]}
set -e

END=$(date +%s)
TOTAL=$((END - START))

# Kumpulkan log byteplus (submit -> selesai per shot, biaya) — apa adanya, termasuk error mentah.
grep -E "\[byteplus\]|\[failover\]|\[job " "$OUT_DIR/dev.log" > "$OUT_DIR/byteplus-events.log" 2>/dev/null || true

{
  echo "# RINGKASAN VERIFIKASI BYTEPLUS — RACUN.AI"
  echo ""
  echo "Tanggal: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Model: ${BYTEPLUS_ARK_MODEL:-seedance-1-0-pro-fast-251015} · Resolusi: ${BYTEPLUS_ARK_RESOLUTION:-480p}"
  echo "Total waktu harness: ${TOTAL} dtk"
  echo "Status smoke: $([ "$SMOKE_EXIT" = "0" ] && echo LULUS || echo GAGAL)"
  echo ""
  echo "## Peristiwa provider (submit -> selesai per shot, biaya aktual/estimasi)"
  echo '```'
  cat "$OUT_DIR/byteplus-events.log"
  echo '```'
  echo ""
  echo "## Artefak"
  echo "- Video: byteplus_verify/output.mp4 (bila job READY)"
  echo "- Log dev server: byteplus_verify/dev.log"
  echo "- Log smoke: byteplus_verify/smoke-output.log"
} > "$OUT_DIR/RINGKASAN.md"

echo ""
cat "$OUT_DIR/RINGKASAN.md"
exit "$SMOKE_EXIT"
