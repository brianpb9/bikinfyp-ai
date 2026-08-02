#!/usr/bin/env bash
set -euo pipefail
# Disposable proof of the production runner: creates then removes a local DB.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const u=new URL(process.argv[2]); u.pathname='/postgres'; u.search=''; process.stdout.write(u.toString());
NODE
)"
database="racun_production_runner_${RANDOM}_${RANDOM}"
cleanup() { psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true; }
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const u=new URL(process.argv[2]); u.pathname=`/${process.argv[3]}`; process.stdout.write(u.toString());
NODE
)"
dry="$(DATABASE_URL="$test_url" RACUN_DEPLOY_ENV=production node scripts/migrate-postgres-production.mjs --dry-run)"
[[ "$dry" == *'"status":"DRY_RUN"'* && "$dry" == *'"schema_migrations":"absent"'* ]] || { echo "Dry-run production tidak aman" >&2; exit 1; }
[[ "$(psql --dbname="$test_url" -Atqc "SELECT to_regclass('public.schema_migrations') IS NULL")" == "t" ]] || { echo "Dry-run menulis database" >&2; exit 1; }
if DATABASE_URL="$test_url" RACUN_DEPLOY_ENV=production node scripts/migrate-postgres-production.mjs >/dev/null 2>&1; then echo "Apply tanpa confirmation tidak ditolak" >&2; exit 1; fi
apply="$(DATABASE_URL="$test_url" RACUN_DEPLOY_ENV=production RACUN_PRODUCTION_MIGRATION_CONFIRM=APPLY_PRODUCTION_MIGRATIONS node scripts/migrate-postgres-production.mjs)"
[[ "$apply" == *'"status":"PASS"'* ]] || { echo "Apply production gagal" >&2; exit 1; }
repeat="$(DATABASE_URL="$test_url" RACUN_DEPLOY_ENV=production node scripts/migrate-postgres-production.mjs --dry-run)"
[[ "$repeat" == *'"would_apply":[]'* ]] || { echo "Checksum/idempotensi production gagal" >&2; exit 1; }
verified="$(DATABASE_URL="$test_url" RACUN_DEPLOY_ENV=production node scripts/migrate-postgres-production.mjs)"
[[ "$verified" == *'"status":"PASS"'* && "$verified" == *'"applied":[]'* ]] || { echo "Verifikasi tanpa token setelah semua migrasi tidak lolos" >&2; exit 1; }
echo "PASS: runner production dry-run non-mutating, confirmation eksplisit hanya untuk perubahan, checksum, dan idempotensi terbukti pada database disposable $database."
