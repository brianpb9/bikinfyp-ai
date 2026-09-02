#!/bin/bash
#
# DEPLOY KE SERVER PRODUKSI — dijalankan dari mesin pengembang, bukan di server.
#
# ─────────────────────────────────────────────────────────────────────────────
# KENAPA SKRIP INI ADA
# ─────────────────────────────────────────────────────────────────────────────
# Deploy sebelumnya dilakukan dengan rsync yang diketik langsung di terminal.
# Pada 2 Sep 2026 rsync itu dijalankan dengan --delete tanpa mengecualikan
# .env — dan karena .env dan .env.server memang tidak ada di repo (gitignore),
# rsync menganggap keduanya "berlebih di tujuan" lalu MENGHAPUSNYA. Seluruh
# kredensial produksi hilang dalam satu perintah; yang menyelamatkan hanyalah
# arsip malam.
#
# Perintah yang benar tidak boleh hidup di ingatan seseorang. Ia hidup di sini.
#
set -euo pipefail

HOST=${DEPLOY_HOST:-bikinfyp-server}
TUJUAN=${DEPLOY_PATH:-/srv/bikinfyp/app}
COMPOSE="docker compose -f $TUJUAN/docker-compose.server.yml"
ASAL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ── Pagar 1: berkas rahasia TIDAK PERNAH ikut disalin maupun dihapus ─────────
# .env* ada di dua sisi pagar sekaligus: tidak dikirim dari sini (isinya
# kredensial pengembangan) dan tidak dihapus di sana (isinya kredensial
# produksi yang tidak ada salinannya di repo).
KECUALI=(
  --exclude '.env' --exclude '.env.*' --exclude '!.env.example'
  --exclude node_modules --exclude .next --exclude .git
  --exclude storage --exclude data --exclude '*.log'
)

log "memeriksa kredensial di server SEBELUM menyentuh apa pun"
ssh "$HOST" "test -s $TUJUAN/.env && test -s $TUJUAN/.env.server" || {
  echo "BERHENTI: $TUJUAN/.env atau .env.server tidak ada / kosong di server."
  echo "Pulihkan dulu dari arsip malam sebelum deploy:"
  echo "  tar xzf /srv/bikinfyp/backup/bikinfyp-<tanggal>.tar.gz -C /tmp ./env.server ./env.compose"
  exit 1
}

log "menyalin kode ke $HOST:$TUJUAN"
rsync -az --delete "${KECUALI[@]}" "$ASAL/" "$HOST:$TUJUAN/"

log "memastikan kredensial masih ada SESUDAH penyalinan"
ssh "$HOST" "test -s $TUJUAN/.env && test -s $TUJUAN/.env.server" || {
  echo "BERHENTI: kredensial hilang saat penyalinan. JANGAN build — pulihkan dulu dari arsip."
  exit 1
}

log "membangun ulang web & worker"
ssh "$HOST" "cd $TUJUAN && $COMPOSE build web worker"

log "menyalakan ulang"
ssh "$HOST" "cd $TUJUAN && $COMPOSE up -d web worker"

log "menunggu web sehat"
for i in $(seq 1 30); do
  status=$(ssh "$HOST" "cd $TUJUAN && $COMPOSE ps --format '{{.Service}} {{.Status}}'" | grep '^web ' || true)
  case "$status" in
    *healthy*) log "web sehat: $status"; break ;;
  esac
  [ "$i" = 30 ] && { echo "BERHENTI: web tidak kunjung sehat — $status"; exit 1; }
  sleep 5
done

log "selesai"
