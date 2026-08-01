#!/usr/bin/env bash
# Checkpoint 1E only.  It creates a disposable loopback database, migrates it,
# and runs the existing HTTP smoke with the narrowly-gated PostgreSQL runtime.
set -euo pipefail
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_runtime_smoke_1e_${RANDOM}_${RANDOM}"
tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir"
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
DATABASE_URL="$test_url" RACUN_POSTGRES_SMOKE=1 RACUN_NO_DOTENV=1 ALLOW_DEV_LOGIN=1 DB_PATH="$tmp_dir/unused-sqlite.db" STORAGE_DIR="$tmp_dir/storage" PORT="${PORT:-3210}" bash scripts/smoke-e2e.sh
echo "PASS: HTTP smoke PostgreSQL disposable $database (auth -> product -> script -> HITL -> job -> deterministic worker fixture -> output)."
