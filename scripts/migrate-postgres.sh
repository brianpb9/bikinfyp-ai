#!/usr/bin/env bash
set -euo pipefail

# Applies only versioned SQL to a loopback PostgreSQL URL. This runner is for
# checkpoint 1B validation; the application still uses SQLite until 1C.
source scripts/postgres-local.sh

if ! command -v psql >/dev/null 2>&1; then
  echo "psql diperlukan untuk menjalankan migrasi PostgreSQL lokal." >&2
  exit 1
fi

database_url="$(postgres_local_url)"
psql --dbname="$database_url" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

shopt -s nullglob
files=(migrations/postgres/*.sql)
if ((${#files[@]} == 0)); then
  echo "Tidak ada migration SQL PostgreSQL." >&2
  exit 1
fi

for file in "${files[@]}"; do
  filename="$(basename "$file")"
  version="${filename%.sql}"
  if [[ ! "$version" =~ ^[0-9]{4}_[a-z0-9_]+$ ]]; then
    echo "Nama migrasi tidak valid: $filename" >&2
    exit 1
  fi
  checksum="$(shasum -a 256 "$file" | awk '{print $1}')"
  existing="$(psql --dbname="$database_url" -v ON_ERROR_STOP=1 -Atqc "SELECT checksum FROM schema_migrations WHERE version = '$version'")"
  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      echo "Checksum migrasi berubah setelah diterapkan: $filename" >&2
      exit 1
    fi
    echo "skip $filename (sudah diterapkan)"
    continue
  fi

  # Migration + ledger insert share one server session and one transaction.
  psql --dbname="$database_url" -v ON_ERROR_STOP=1 \
    -c "BEGIN" \
    -f "$file" \
    -c "INSERT INTO schema_migrations (version, checksum) VALUES ('$version', '$checksum')" \
    -c "COMMIT"
  echo "applied $filename"
done
