#!/usr/bin/env bash
set -euo pipefail

# Checkpoint 1D: source is the local SQLite development database only.  A new
# loopback PostgreSQL database is created, migrated, reconciled, and dropped.
# It cannot contact Render/staging/production because postgres-local.sh rejects
# non-loopback URLs.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null

source_db="${SQLITE_SOURCE_PATH:-$PWD/data/racun.db}"
if [[ ! -f "$source_db" ]]; then
  echo "SQLite sumber tidak ditemukan: $source_db" >&2
  exit 1
fi
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = "/postgres"; url.search = ""; process.stdout.write(url.toString());
NODE
)"
database="racun_data_rehearsal_1d_${RANDOM}_${RANDOM}"
rollback_db=""
cleanup() {
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true
  if [[ -n "$rollback_db" ]]; then psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$rollback_db\" WITH (FORCE)" >/dev/null || true; fi
}
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"

DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
report="$(SQLITE_SOURCE_PATH="$source_db" DATABASE_URL="$test_url" RACUN_NO_DOTENV=1 npx tsx scripts/rehearse-sqlite-to-postgres.ts)"
node --input-type=module - "$report" <<'NODE'
const report = JSON.parse(process.argv[2]);
for (const [table, result] of Object.entries(report.counts)) {
  if (result.sqlite !== result.postgres) throw new Error(`Count mismatch ${table}`);
}
if (report.sqlite_fk_orphans !== 0 || Object.values(report.postgres_fk_orphans).some(Boolean)) throw new Error("FK orphan ditemukan");
console.log(`PASS: rehearsal SQLite→PostgreSQL disposable; 10 tabel setara, ${report.balances_checked} saldo user setara, FK tanpa orphan.`);
console.log(JSON.stringify(report.counts));
NODE

# A second disposable database intentionally aborts after the first parent
# table.  The SQL transaction must leave every target table empty.
rollback_db="racun_data_rollback_1d_${RANDOM}_${RANDOM}"
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$rollback_db\"" >/dev/null
rollback_url="$(node --input-type=module - "$local_url" "$rollback_db" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$rollback_url" bash scripts/migrate-postgres.sh >/dev/null
if SQLITE_SOURCE_PATH="$source_db" DATABASE_URL="$rollback_url" REHEARSAL_FAIL_AFTER_TABLE=users RACUN_NO_DOTENV=1 npx tsx scripts/rehearse-sqlite-to-postgres.ts >/dev/null 2>&1; then
  echo "Probe rollback seharusnya gagal." >&2
  exit 1
fi
rollback_rows="$(psql --dbname="$rollback_url" -Atqc "SELECT count(*) FROM users")"
if [[ "$rollback_rows" != "0" ]]; then
  echo "Rollback gagal: $rollback_rows baris users tertinggal." >&2
  exit 1
fi
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE \"$rollback_db\" WITH (FORCE)" >/dev/null
rollback_db=""
echo "PASS: probe rollback transaksional tidak meninggalkan partial import."
