#!/usr/bin/env bash
# Genuine Redis verification only. It intentionally does not start Docker or
# install services: provide a running local Redis endpoint explicitly.
set -euo pipefail
url="${REDIS_URL:-redis://127.0.0.1:6380}"
node --input-type=module - "$url" <<'NODE'
const u = new URL(process.argv[2]);
if (!['redis:', 'rediss:'].includes(u.protocol) || !['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname)) {
  console.error('test:redis-queue hanya menerima REDIS_URL loopback lokal.'); process.exit(1);
}
NODE
host="$(node --input-type=module - "$url" <<'NODE'
const u=new URL(process.argv[2]); process.stdout.write(u.hostname.replace(/^\[|\]$/g,''));
NODE
)"
port="$(node --input-type=module - "$url" <<'NODE'
const u=new URL(process.argv[2]); process.stdout.write(u.port || '6379');
NODE
)"
if ! command -v redis-cli >/dev/null 2>&1 || ! redis-cli -h "$host" -p "$port" ping >/dev/null 2>&1; then
  echo "Redis lokal tidak siap di $host:$port. Jalankan redis-server dahulu lalu ulangi." >&2
  exit 1
fi
REDIS_URL="$url" RACUN_QUEUE_MODE=redis REDIS_QUEUE_NAME="racun-queue-proof-${RANDOM}-${RANDOM}" RACUN_NO_DOTENV=1 npx tsx scripts/verify-redis-queue.ts
