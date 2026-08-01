#!/usr/bin/env bash
set -euo pipefail
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_jobs_1c_${RANDOM}_${RANDOM}"
tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true; }
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
DB_PATH="$tmp_dir/reference.db" STORAGE_DIR="$tmp_dir/storage" RACUN_NO_DOTENV=1 npx tsx scripts/verify-jobs-parity.ts sqlite > "$tmp_dir/sqlite.json"
DATABASE_URL="$test_url" RACUN_NO_DOTENV=1 npx tsx scripts/verify-jobs-parity.ts postgres > "$tmp_dir/postgres.json"
node --input-type=module - "$tmp_dir/sqlite.json" "$tmp_dir/postgres.json" <<'NODE'
import fs from "node:fs";
const sqlite=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const postgres=JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
for (const key of Object.keys(sqlite)) if (sqlite[key] !== postgres[key]) throw new Error(`Parity jobs gagal pada ${key}: ${sqlite[key]} != ${postgres[key]}`);
NODE
echo "PASS: PostgreSQL jobs parity, terminal race, stale timeout/refund, output ownership/upsert, dan FK rollback tervalidasi pada database disposable $database."
