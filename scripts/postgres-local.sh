#!/usr/bin/env bash
# Shared guard for checkpoints that are allowed to contact only the isolated
# local PostgreSQL instance. It deliberately rejects all non-loopback hosts.

postgres_load_local_env() {
  # Explicit shell configuration wins. This lets the schema test redirect the
  # runner to its disposable database even if a developer has .env.postgres.
  if [[ -z "${DATABASE_URL:-}" && -z "${PGHOST:-}" && -z "${PGPORT:-}" && -z "${PGDATABASE:-}" && -f .env.postgres ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env.postgres
    set +a
  fi
}

postgres_local_url() {
  postgres_load_local_env
  local candidate="${DATABASE_URL:-}"
  if [[ -z "$candidate" ]]; then
    local user="${PGUSER:-${POSTGRES_USER:-racun}}"
    local password="${PGPASSWORD:-${POSTGRES_PASSWORD:-racun_local_only}}"
    local host="${PGHOST:-localhost}"
    local port="${PGPORT:-${POSTGRES_PORT:-54329}}"
    local database="${PGDATABASE:-${POSTGRES_DB:-racun_local}}"
    candidate="postgresql://${user}:${password}@${host}:${port}/${database}"
  fi

  node --input-type=module - "$candidate" <<'NODE'
const candidate = process.argv[2];
let url;
try {
  url = new URL(candidate);
} catch {
  console.error("DATABASE_URL PostgreSQL lokal tidak valid.");
  process.exit(1);
}
if (!["postgres:", "postgresql:"].includes(url.protocol)) {
  console.error("DATABASE_URL harus memakai postgres:// atau postgresql://.");
  process.exit(1);
}
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
  console.error(`Menolak database non-lokal (${url.hostname || "tanpa host"}).`);
  process.exit(1);
}
process.stdout.write(url.toString());
NODE
}

postgres_local_readiness_check() {
  if ! command -v pg_isready >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
    echo "Docker tidak tersedia; pg_isready dan psql diperlukan untuk fallback PostgreSQL lokal." >&2
    return 1
  fi
  local url
  url="$(postgres_local_url)"
  pg_isready --dbname="$url"
  psql --dbname="$url" -v ON_ERROR_STOP=1 -c "SELECT current_database() AS database, current_user AS role;"
}
