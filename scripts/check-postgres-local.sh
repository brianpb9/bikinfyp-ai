#!/usr/bin/env bash
set -euo pipefail

# Hermetic readiness check: this only accepts a loopback PostgreSQL endpoint.
# Docker is optional because the shared development machine runs PostgreSQL via
# pg_ctl. No schema, route, or production service is touched here.
if command -v docker >/dev/null 2>&1; then
  compose=(docker compose -f docker-compose.postgres.yml)
  if [[ -f .env.postgres ]]; then
    compose+=(--env-file .env.postgres)
  fi

  "${compose[@]}" up -d --wait postgres
  "${compose[@]}" exec -T postgres sh -ec 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database() AS database, current_user AS role;"'
  exit 0
fi

source scripts/postgres-local.sh
postgres_local_readiness_check
