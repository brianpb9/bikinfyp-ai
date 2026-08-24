#!/bin/sh
set -eu

exec render psql "${STAGING_DATABASE_ID:?STAGING_DATABASE_ID is required}" \
  --command "SELECT count(*) AS applied_count, min(version) AS first_version, max(version) AS last_version FROM schema_migrations; SELECT version FROM schema_migrations ORDER BY version;" \
  --output text
