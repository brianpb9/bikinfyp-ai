#!/usr/bin/env bash
set -euo pipefail

# Checkpoint 1C parity against a disposable loopback-only PostgreSQL database.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_product_persona_script_1c_${RANDOM}_${RANDOM}"
tmp_dir="$(mktemp -d)"
cleanup() { rm -rf "$tmp_dir"; psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true; }
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
DB_PATH="$tmp_dir/reference.db" STORAGE_DIR="$tmp_dir/storage" RACUN_NO_DOTENV=1 npx tsx scripts/verify-product-persona-script-parity.ts sqlite > "$tmp_dir/sqlite.json"
DATABASE_URL="$test_url" RACUN_NO_DOTENV=1 npx tsx scripts/verify-product-persona-script-parity.ts postgres > "$tmp_dir/postgres.json"
node --input-type=module - "$tmp_dir/sqlite.json" "$tmp_dir/postgres.json" <<'NODE'
import fs from "node:fs";
const sqlite = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); const postgres = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
if (JSON.stringify(sqlite) !== JSON.stringify(postgres)) { console.error("Parity product/persona/script gagal."); console.error(JSON.stringify({ sqlite, postgres }, null, 2)); process.exit(1); }
NODE
echo "PASS: PostgreSQL product/persona/script parity tervalidasi terhadap runtime SQLite pada database disposable $database."
