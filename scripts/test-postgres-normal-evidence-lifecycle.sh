#!/usr/bin/env bash
set -euo pipefail
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url=new URL(process.argv[2]);url.pathname="/postgres";url.search="";process.stdout.write(url.toString());
NODE
)"
database="racun_normal_evidence_${RANDOM}_${RANDOM}"
cleanup(){ psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true; }
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url=new URL(process.argv[2]);url.pathname=`/${process.argv[3]}`;process.stdout.write(url.toString());
NODE
)"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
DATABASE_URL="$test_url" UJI_PG_URL="$test_url" RACUN_NO_DOTENV=1 npx tsx --test tests/pg-normal-evidence-lifecycle.test.ts
echo "PASS: migrated private evidence schema permits pending review and requires digest-bound redaction attestation."
