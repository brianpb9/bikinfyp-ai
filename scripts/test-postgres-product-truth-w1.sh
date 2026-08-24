#!/usr/bin/env bash
# P0-B4b — menjalankan kontrak W1 di PostgreSQL NYATA, di database disposable.
#
# Mengikuti konvensi scripts/test-postgres-jobs.sh: satu database sekali pakai
# per jalan, dibuat lalu di-DROP di trap EXIT. Nol data nyata tersentuh, dan
# hanya endpoint loopback yang diterima (postgres-local.sh menolak host lain).
set -euo pipefail
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_w1_truth_${RANDOM}_${RANDOM}"
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
DATABASE_URL="$test_url" UJI_PG_URL="$test_url" RACUN_NO_DOTENV=1 SCRIPT_LLM=0 npx tsx --test tests/pg-product-truth-w1.test.ts
echo "PASS: kontrak referensi W1 tervalidasi pada database disposable $database."
