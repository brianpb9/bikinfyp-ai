#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

./node_modules/.bin/tsx scripts/web-container-contract.ts
./node_modules/.bin/tsx --test tests/web-container-contract.test.ts

if ! command -v docker >/dev/null 2>&1; then
  echo "[web-container] PASS static; Docker engine unavailable, image execution NOT CLAIMED."
  exit 0
fi

IMAGE="racun-web:container-check"
docker build --target runtime -t "$IMAGE" -f Dockerfile.web .
docker run --rm --entrypoint sh "$IMAGE" -ec '
  test "$(id -u)" = "10001"
  command -v ffmpeg
  command -v ffprobe
  command -v tesseract
  tesseract --list-langs | grep -qx eng
  test -f /srv/app/assets/probe/probe-teks.png
  test -f /srv/app/migrations/postgres/0035_job_product_snapshot.sql
  test -f /srv/app/scripts/migrate-postgres-runtime.mjs
  test -f /srv/app/.next/BUILD_ID
  test -f /srv/app/public/manifest.json
  test -f /srv/app/knowledge/rules/modes.md
  test -w /srv/app/.next/cache
  test -w /srv/app/storage/jobs
  test -w /srv/app/storage/uploads
  node -e "for (const p of [\"next\",\"pg\",\"sharp\",\"better-sqlite3\"]) require.resolve(p);"
'
echo "[web-container] PASS executed image contract."
