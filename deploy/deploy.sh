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

# ── PERGANTIAN WARNA (blue/green) ───────────────────────────────────────────
#
# KENAPA INI ADA. Sampai 4 Sep 2026 deploy membuat ulang kontainer di port yang
# ditembak nginx, jadi ada jeda ~6 detik tanpa backend dan siapa pun yang
# sedang memakai aplikasi menerima 502. Hari itu terjadi TIGA kali: dua kali
# memutus uji yang sedang berjalan, dan sekali menimpa Brian yang sedang
# menunggu videonya (job be16d8f3).
#
# Sekarang: warna yang tidak aktif dinyalakan lebih dulu, DITUNGGU sampai
# sehat, baru nginx dialihkan, baru warna lama dimatikan. Urutan itu yang
# penting — menukar nginx sebelum warna baru sehat hanya memindahkan jeda,
# bukan menghapusnya.
# Port hijau 3002, bukan 3001: mesin ini dipakai bersama aplikasi lain dan
# 3001 sudah dipegang l10-app.
AKTIF=$(ssh "$HOST" "grep -oE '127.0.0.1:(3000|3002)' /etc/nginx/conf.d/bikinfyp-upstream.conf | head -1 | cut -d: -f2")
if [ "$AKTIF" = "3000" ]; then
  WARNA_BARU="web-green"; PORT_BARU=3002; WARNA_LAMA="web"
else
  WARNA_BARU="web";       PORT_BARU=3000; WARNA_LAMA="web-green"
fi
log "warna aktif :$AKTIF -> menyalakan $WARNA_BARU di :$PORT_BARU"

ssh "$HOST" "cd $TUJUAN && $COMPOSE --profile green up -d $WARNA_BARU worker"

log "menunggu $WARNA_BARU sehat (nginx MASIH menunjuk :$AKTIF)"
for i in $(seq 1 40); do
  status=$(ssh "$HOST" "cd $TUJUAN && $COMPOSE --profile green ps --format '{{.Service}} {{.Status}}'" | grep "^$WARNA_BARU " || true)
  case "$status" in
    *healthy*) log "$WARNA_BARU sehat: $status"; break ;;
  esac
  if [ "$i" = 40 ]; then
    # Warna baru gagal: nginx TIDAK pernah dialihkan, jadi versi lama masih
    # melayani. Yang gagal adalah deploy, bukan situsnya.
    echo "BERHENTI: $WARNA_BARU tidak kunjung sehat — $status"
    echo "Situs TIDAK terganggu; nginx masih menunjuk :$AKTIF."
    ssh "$HOST" "cd $TUJUAN && $COMPOSE --profile green stop $WARNA_BARU" || true
    exit 1
  fi
  sleep 5
done

log "mengalihkan nginx ke :$PORT_BARU"
ssh "$HOST" "sudo tee /etc/nginx/conf.d/bikinfyp-upstream.conf >/dev/null <<UPS
# WARNA AKTIF — ditulis deploy/deploy.sh, jangan diedit tangan.
upstream bikinfyp_app {
    server 127.0.0.1:$PORT_BARU;
    keepalive 32;
}
UPS
sudo nginx -t" >/dev/null || { echo "BERHENTI: nginx menolak konfigurasi baru"; exit 1; }

# reload, BUKAN restart: pekerja lama menyelesaikan permintaan yang sedang
# berjalan sebelum berhenti. Tidak ada koneksi yang diputus di tengah.
ssh "$HOST" "sudo systemctl reload nginx"

log "memastikan situs menjawab lewat warna baru"
for i in $(seq 1 10); do
  kode=$(curl -s -o /dev/null -w '%{http_code}' https://bikinfyp.com/api/health || true)
  [ "$kode" = "200" ] && { log "situs sehat (HTTP 200)"; break; }
  [ "$i" = 10 ] && { echo "BERHENTI: situs tidak menjawab 200 setelah pergantian (HTTP $kode)"; exit 1; }
  sleep 2
done

# Warna lama baru dimatikan SESUDAH situs terbukti dilayani warna baru.
log "mematikan $WARNA_LAMA"
ssh "$HOST" "cd $TUJUAN && $COMPOSE --profile green stop $WARNA_LAMA" || true

log "selesai — tanpa jeda"
