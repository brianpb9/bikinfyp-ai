#!/bin/bash
#
# CADANGAN MALAM BIKINFYP — satu arsip per malam, retensi bergulir.
#
# ─────────────────────────────────────────────────────────────────────────────
# APA YANG DICADANGKAN
# ─────────────────────────────────────────────────────────────────────────────
#   postgres.sql.gz   seluruh database (pg_dump), termasuk skema
#   redis.tar.gz      volume Redis SESUDAH BGSAVE — antrean job yang menunggu
#   minio.tar.gz      volume MinIO — seluruh media pengguna
#   source.tar.gz     kode sumber yang berjalan, tanpa node_modules/.next
#   env.server        konfigurasi + kredensial partner
#   MANIFEST.txt      ukuran dan sha256 tiap bagian
#
# .env.server IKUT SENGAJA. Tanpa ia, arsip ini bisa memulihkan data tapi tidak
# bisa memulihkan LAYANAN — dan pemulihan yang butuh berburu kredensial ke
# vendor satu per satu bukan pemulihan. Karena itu arsipnya chmod 600 dan
# TIDAK boleh dipindahkan lewat jalur yang lebih longgar daripada .env itu
# sendiri.
#
# ─────────────────────────────────────────────────────────────────────────────
# YANG HARUS DIKATAKAN APA ADANYA
# ─────────────────────────────────────────────────────────────────────────────
# Arsip ini tersimpan DI SERVER YANG SAMA dengan datanya. Itu melindungi dari
# kesalahan manusia dan kerusakan data — bukan dari server yang hilang.
# Selama BACKUP_REMOTE_CMD belum diisi, ini BELUM cadangan yang sesungguhnya.
#
set -uo pipefail

DIR=/srv/bikinfyp
APP=$DIR/app
OUT=$DIR/backup
COMPOSE="docker compose -f $APP/docker-compose.server.yml"
SIMPAN_HARI=${BACKUP_RETENTION_DAYS:-7}
STAMP=$(date -u +%Y%m%d-%H%M)
TANGGAL=$(date -u +%Y-%m-%d)
KERJA=$(mktemp -d)
ARSIP=$OUT/bikinfyp-$TANGGAL.tar.gz

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
bersih() { rm -rf "$KERJA"; }
trap bersih EXIT

mkdir -p "$OUT"
cd "$APP" || { log "FATAL: $APP tidak ada"; exit 1; }

gagal=0

# ── 1. Postgres ──────────────────────────────────────────────────────────────
log "postgres: pg_dump"
if $COMPOSE exec -T postgres pg_dump -U bikinfyp -d bikinfyp | gzip -9 > "$KERJA/postgres.sql.gz"; then
  log "postgres: $(du -h "$KERJA/postgres.sql.gz" | cut -f1)"
else
  log "postgres: GAGAL"; gagal=1
fi

# ── 2. Redis ─────────────────────────────────────────────────────────────────
# BGSAVE dulu, baru salin. Menyalin volume tanpa itu berarti mengarsipkan
# keadaan yang mungkin tertinggal beberapa detik dari kenyataan.
log "redis: BGSAVE lalu salin volume"
$COMPOSE exec -T redis redis-cli BGSAVE >/dev/null 2>&1
sleep 3
if docker run --rm -v bikinfyp_redisdata:/d:ro -v "$KERJA":/out alpine \
     tar czf /out/redis.tar.gz -C /d . 2>/dev/null; then
  log "redis: $(du -h "$KERJA/redis.tar.gz" | cut -f1)"
else
  log "redis: GAGAL"; gagal=1
fi

# ── 3. MinIO (media pengguna) ────────────────────────────────────────────────
log "minio: salin volume"
if docker run --rm -v bikinfyp_miniodata:/d:ro -v "$KERJA":/out alpine \
     tar czf /out/minio.tar.gz -C /d . 2>/dev/null; then
  log "minio: $(du -h "$KERJA/minio.tar.gz" | cut -f1)"
else
  log "minio: GAGAL"; gagal=1
fi

# ── 4. Kode sumber ───────────────────────────────────────────────────────────
# node_modules dan .next dikecualikan: keduanya hasil BANGUNAN, bukan sumber.
# Mengarsipkannya menambah ratusan MB tiap malam untuk sesuatu yang dibuat
# ulang dengan satu perintah.
log "source: arsip kode"
if tar czf "$KERJA/source.tar.gz" \
     --exclude=node_modules --exclude=.next --exclude=storage --exclude='*.log' \
     -C "$DIR" app 2>/dev/null; then
  log "source: $(du -h "$KERJA/source.tar.gz" | cut -f1)"
else
  log "source: GAGAL"; gagal=1
fi

# ── 5. Konfigurasi ───────────────────────────────────────────────────────────
cp "$APP/.env.server" "$KERJA/env.server" 2>/dev/null && log "env.server: disalin" || { log "env.server: GAGAL"; gagal=1; }
cp "$APP/.env" "$KERJA/env.compose" 2>/dev/null

# ── 6. Manifest ──────────────────────────────────────────────────────────────
{
  echo "BikinFYP — cadangan $STAMP UTC"
  echo "host: $(hostname)"
  echo
  cd "$KERJA" && sha256sum ./* 2>/dev/null
  echo
  echo "ukuran:"
  du -h ./* 2>/dev/null
} > "$KERJA/MANIFEST.txt"

# ── 7. Satu arsip per malam ──────────────────────────────────────────────────
if tar czf "$ARSIP" -C "$KERJA" .; then
  chmod 600 "$ARSIP"
  log "arsip: $ARSIP ($(du -h "$ARSIP" | cut -f1))"
else
  log "arsip: GAGAL"; exit 1
fi

# ── 8. Retensi ───────────────────────────────────────────────────────────────
# Dihapus SESUDAH arsip baru berhasil dibuat, tidak sebelumnya. Menghapus lebih
# dulu berarti satu malam yang gagal meninggalkan lebih sedikit cadangan
# daripada sebelum skrip ini berjalan.
hapus=$(find "$OUT" -maxdepth 1 -name 'bikinfyp-*.tar.gz' -mtime +$SIMPAN_HARI -print -delete | wc -l)
log "retensi: $SIMPAN_HARI hari, $hapus arsip lama dihapus"

# ── 9. Salinan luar server ───────────────────────────────────────────────────
# BELUM DIISI = cadangan ini masih berada di mesin yang sama dengan datanya,
# jadi ia tidak melindungi dari server yang hilang. Isi BACKUP_REMOTE_CMD di
# /etc/default/bikinfyp-backup dengan perintah yang menerima path arsip.
if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
  log "salinan luar: menjalankan BACKUP_REMOTE_CMD"
  if $BACKUP_REMOTE_CMD "$ARSIP"; then log "salinan luar: OK"; else log "salinan luar: GAGAL"; gagal=1; fi
else
  log "salinan luar: BELUM DIATUR — arsip hanya ada di server ini"
fi

log "selesai dengan status $gagal"
exit $gagal
