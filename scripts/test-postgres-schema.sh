#!/usr/bin/env bash
set -euo pipefail

# Real parity/constraint test. It creates then removes one uniquely named
# database on the verified loopback server; no application database is changed.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null

local_url="$(postgres_local_url)"
admin_url="$(node --input-type=module - "$local_url" <<'NODE'
const url = new URL(process.argv[2]);
url.pathname = "/postgres";
url.search = "";
process.stdout.write(url.toString());
NODE
)"
database="racun_schema_1b_${RANDOM}_${RANDOM}"

cleanup() {
  psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$database\" WITH (FORCE)" >/dev/null || true
}
trap cleanup EXIT
psql --dbname="$admin_url" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database\"" >/dev/null
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]);
url.pathname = `/${process.argv[3]}`;
process.stdout.write(url.toString());
NODE
)"

DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh

table_count="$(psql --dbname="$test_url" -Atqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'")"
view_count="$(psql --dbname="$test_url" -Atqc "SELECT count(*) FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'v_credit_balance'")"
# SQLite schema lists nine explicit idx_* indexes. PostgreSQL additionally
# creates implementation indexes for UNIQUE constraints, which are validated
# separately below and must not inflate the parity count.
index_count="$(psql --dbname="$test_url" -Atqc "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname LIKE 'idx_%'")"
[[ "$table_count" == "10" ]] || { echo "Parity gagal: tabel=$table_count, harapannya 10" >&2; exit 1; }
[[ "$view_count" == "1" ]] || { echo "Parity gagal: view=$view_count, harapannya 1" >&2; exit 1; }
[[ "$index_count" == "9" ]] || { echo "Parity gagal: index=$index_count, harapannya 9" >&2; exit 1; }

psql --dbname="$test_url" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO users (id, email, created_at) VALUES ('u1', 'u1@example.test', '2026-08-01T00:00:00.000Z');
INSERT INTO credit_ledger (id, user_id, delta, type, created_at) VALUES
  ('ledger-a', 'u1', 10, 'topup', '2026-08-01T00:00:00.000Z'),
  ('ledger-b', 'u1', -3, 'hold', '2026-08-01T00:00:00.000Z');
DO $$
BEGIN
  IF (SELECT balance FROM v_credit_balance WHERE user_id = 'u1') <> 7 THEN
    RAISE EXCEPTION 'v_credit_balance tidak setara';
  END IF;
  IF (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_ledger_user') NOT LIKE '%created_at DESC, id DESC%' THEN
    RAISE EXCEPTION 'index pengganti rowid tidak deterministik';
  END IF;
END $$;
SQL

if psql --dbname="$test_url" -v ON_ERROR_STOP=1 -c "INSERT INTO credit_ledger (id, user_id, delta, type, created_at) VALUES ('bad-type', 'u1', 1, 'invalid', '2026-08-01T00:00:00.000Z')" >/dev/null 2>&1; then
  echo "Constraint type credit_ledger tidak aktif." >&2
  exit 1
fi
if psql --dbname="$test_url" -v ON_ERROR_STOP=1 -c "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, created_at) VALUES ('bad-fk', 'missing', 'midtrans', 'ref-1', 1, 1, '2026-08-01T00:00:00.000Z')" >/dev/null 2>&1; then
  echo "Foreign key payments.user_id tidak aktif." >&2
  exit 1
fi
if psql --dbname="$test_url" -v ON_ERROR_STOP=1 -c "INSERT INTO users (id, email, created_at) VALUES ('u2', 'u1@example.test', '2026-08-01T00:00:00.000Z')" >/dev/null 2>&1; then
  echo "Unique users.email tidak aktif." >&2
  exit 1
fi

echo "PASS: PostgreSQL schema parity (10 tables, 1 view, 9 indexes), ledger idempotency, dan constraints tervalidasi pada database disposable $database."
