#!/usr/bin/env bash
# P0-B lifecycle audit — menjalankan gate konkurensi UANG di PostgreSQL NYATA,
# di database disposable, bukan URL arbitrer.
#
# Sebelum ini, `npm run test:pg`/`gate:uang` MENERIMA UJI_PG_URL apa pun dan
# langsung memasukkan data uji (users/products/jobs/ledger/events) ke
# dalamnya — TANPA penjaga loopback dan TANPA siklus create/migrate/drop.
# Kalau UJI_PG_URL kebetulan menunjuk database bersama/remote, gate ini
# mencemarinya secara diam-diam. Sebelas test di sini menjaga INVARIAN UANG
# (indeks terminal, capture ganda, refund, hold menggantung, grantBonus
# idempoten) — alat yang menjaga uang tidak boleh sendiri jadi risiko.
#
# Mengikuti konvensi scripts/test-postgres-product-truth-w1.sh: satu database
# sekali pakai per jalan, dibuat lalu di-DROP di trap EXIT. Nol data nyata
# tersentuh, dan hanya endpoint loopback yang diterima (postgres-local.sh
# menolak host lain).
set -euo pipefail
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_konkurensi_${RANDOM}_${RANDOM}"
cleanup() {
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
UJI_PG_URL="$test_url" RACUN_NO_DOTENV=1 SCRIPT_LLM=0 npx tsx --test tests/pg-konkurensi-kredit.test.ts
echo "PASS: sebelas invarian uang tervalidasi pada database disposable $database."
