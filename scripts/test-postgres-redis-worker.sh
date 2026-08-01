#!/usr/bin/env bash
set -euo pipefail

# This is an isolated, local-only proof of the real Redis consumer operating
# against PostgreSQL. No Render endpoint can be reached from this script.
source scripts/postgres-local.sh
postgres_local_readiness_check >/dev/null
local_url="$(postgres_local_url)"
database="racun_pg_redis_worker_${RANDOM}_${RANDOM}"
test_url="$(node --input-type=module - "$local_url" "$database" <<'NODE'
const url = new URL(process.argv[2]); url.pathname = `/${process.argv[3]}`; url.search = ""; process.stdout.write(url.toString());
NODE
)"

redis_url="${REDIS_URL:-redis://127.0.0.1:6380}"
host="$(node --input-type=module - "$redis_url" <<'NODE'
const url=new URL(process.argv[2]); if (!['redis:','rediss:'].includes(url.protocol) || !['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname)) process.exit(1); process.stdout.write(url.hostname.replace(/^\[|\]$/g,''));
NODE
)"
port="$(node --input-type=module - "$redis_url" <<'NODE'
const url=new URL(process.argv[2]); process.stdout.write(url.port || '6379');
NODE
)"
if ! command -v redis-cli >/dev/null 2>&1 || ! redis-cli -h "$host" -p "$port" ping >/dev/null 2>&1; then
  echo "Redis lokal tidak siap di $host:$port." >&2; exit 1
fi

cleanup() { PGPASSWORD="$(node --input-type=module - "$test_url" <<'NODE'
process.stdout.write(decodeURIComponent(new URL(process.argv[2]).password));
NODE
)" dropdb --if-exists --host="$host_pg" --port="$port_pg" --username="$user_pg" "$database" >/dev/null 2>&1 || true; }
host_pg="$(node --input-type=module - "$test_url" <<'NODE'
process.stdout.write(new URL(process.argv[2]).hostname)
NODE
)"
port_pg="$(node --input-type=module - "$test_url" <<'NODE'
process.stdout.write(new URL(process.argv[2]).port || '5432')
NODE
)"
user_pg="$(node --input-type=module - "$test_url" <<'NODE'
process.stdout.write(decodeURIComponent(new URL(process.argv[2]).username))
NODE
)"
trap cleanup EXIT
PGPASSWORD="$(node --input-type=module - "$test_url" <<'NODE'
process.stdout.write(decodeURIComponent(new URL(process.argv[2]).password));
NODE
)" createdb --host="$host_pg" --port="$port_pg" --username="$user_pg" "$database"
DATABASE_URL="$test_url" bash scripts/migrate-postgres.sh >/dev/null
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"; cleanup' EXIT
DATABASE_URL="$test_url" REDIS_URL="$redis_url" RACUN_DB_RUNTIME=postgres RACUN_QUEUE_MODE=redis REDIS_QUEUE_NAME="racun-pg-worker-proof-${RANDOM}-${RANDOM}" STORAGE_DIR="$tmp_dir/storage" PROVIDER_VIDEO=mock RACUN_WORKER_DETERMINISTIC=1 RACUN_NO_DOTENV=1 npx tsx scripts/verify-postgres-redis-worker.ts
