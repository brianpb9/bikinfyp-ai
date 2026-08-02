#!/usr/bin/env bash
set -euo pipefail
# Disposable proof that the PITR reconciliation is read-only and detects drift.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const u=new URL(process.argv[2]); u.pathname='/postgres'; u.search=''; process.stdout.write(u.toString());
NODE
)"
source_db="racun_pitr_source_${RANDOM}_${RANDOM}"
clone_db="racun_pitr_clone_${RANDOM}_${RANDOM}"
cleanup() {
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$source_db\" WITH (FORCE)" >/dev/null || true
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$clone_db\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$source_db\"" >/dev/null
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$clone_db\"" >/dev/null
url_for() { node --input-type=module - "$local_url" "$1" <<'NODE'
const u=new URL(process.argv[2]); u.pathname=`/${process.argv[3]}`; process.stdout.write(u.toString());
NODE
}
source_url="$(url_for "$source_db")"
clone_url="$(url_for "$clone_db")"
for url in "$source_url" "$clone_url"; do
  DATABASE_URL="$url" RACUN_DEPLOY_ENV=production RACUN_PRODUCTION_MIGRATION_CONFIRM=APPLY_PRODUCTION_MIGRATIONS node scripts/migrate-postgres-production.mjs >/dev/null
done
psql --dbname="$source_url" -v ON_ERROR_STOP=1 -c "INSERT INTO users (id,email,name,created_at) VALUES ('pitr-user','pitr@example.invalid','PITR Test','2026-01-01T00:00:00.000Z'); INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('pitr-ledger','pitr-user',17,'bonus','2026-01-01T00:00:00.000Z');" >/dev/null
psql --dbname="$clone_url" -v ON_ERROR_STOP=1 -c "INSERT INTO users (id,email,name,created_at) VALUES ('pitr-user','pitr@example.invalid','PITR Test','2026-01-01T00:00:00.000Z'); INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ('pitr-ledger','pitr-user',17,'bonus','2026-01-01T00:00:00.000Z');" >/dev/null
pass="$(SOURCE_DATABASE_URL="$source_url" RESTORED_DATABASE_URL="$clone_url" node scripts/verify-postgres-pitr-restore.mjs)"
[[ "$pass" == *'"status":"PASS"'* && "$pass" == *'"mismatched_users":0'* ]] || { echo "PITR reconciliation tidak menerima clone identik" >&2; exit 1; }
psql --dbname="$clone_url" -v ON_ERROR_STOP=1 -c "INSERT INTO audit_log (id,actor,action,entity,created_at) VALUES ('clone-only','test','drift','pitr','2026-01-01T00:00:00.000Z');" >/dev/null
if SOURCE_DATABASE_URL="$source_url" RESTORED_DATABASE_URL="$clone_url" node scripts/verify-postgres-pitr-restore.mjs >/dev/null 2>&1; then
  echo "PITR reconciliation gagal mendeteksi table-count drift" >&2; exit 1
fi
echo "PASS: reconciliation PITR menerima clone identik dan menolak table-count drift pada database disposable."
