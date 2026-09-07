#!/usr/bin/env bash
# PEMANTAU SITUS — menangkap bukti untuk kegagalan yang tidak meninggalkan jejak.
#
# ---------------------------------------------------------------------------
# KENAPA ADA
# ---------------------------------------------------------------------------
# 7 Sep 2026 Brian melaporkan https://aiugc.id/onboarding menjawab 503. Saat
# diperiksa beberapa menit kemudian, SEMUANYA sehat: 40 dari 40 permintaan
# lewat Cloudflare berhasil, tunnel punya 4 koneksi siap, dan tidak ada satu
# pun 503 di access log nginx, di log aplikasi, maupun di log cloudflared.
#
# Artinya permintaan itu TIDAK PERNAH sampai ke server. Ia dijawab di tepi —
# oleh Cloudflare atau oleh cloudflared — dan kita tidak punya apa pun untuk
# dibaca. Menebak penyebabnya tanpa bukti hanya menghasilkan perbaikan yang
# tidak bisa dibuktikan benar.
#
# ---------------------------------------------------------------------------
# YANG DICATAT, DAN KENAPA TIGA-TIGANYA
# ---------------------------------------------------------------------------
# cf     : lewat Cloudflare — persis jalur yang dipakai pengguna.
# origin : langsung ke nginx, melewati Cloudflare.
# tunnel : jumlah koneksi siap milik cloudflared.
#
# Ketiganya bersama-sama langsung menunjuk siapa yang salah tanpa perlu
# menebak:
#   cf gagal + origin sehat + tunnel 4  -> masalah di tepi Cloudflare
#   cf gagal + origin sehat + tunnel 0  -> tunnel putus
#   cf gagal + origin gagal             -> masalah di server kita
#
# Hanya kegagalan yang ditulis, plus satu denyut per jam supaya terlihat bahwa
# pemantaunya sendiri masih hidup. Log yang penuh baris "semua baik" adalah log
# yang tidak akan dibaca siapa pun.
set -uo pipefail

LOG=/var/log/aiugc-pemantau.log
ORIGIN_IP=187.77.148.89
URL=https://aiugc.id/onboarding

cf=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" || echo 000)
origin=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 --resolve "aiugc.id:443:$ORIGIN_IP" "$URL" || echo 000)
tunnel=$(curl -s --max-time 5 http://127.0.0.1:20241/ready 2>/dev/null \
  | sed -n 's/.*"readyConnections":\([0-9]*\).*/\1/p')
tunnel=${tunnel:-?}

stempel=$(date -Is)
if [ "$cf" != "200" ] || [ "$origin" != "200" ]; then
  echo "$stempel GAGAL cf=$cf origin=$origin tunnel=$tunnel" >> "$LOG"
  # Log cloudflared di sekitar kejadian ikut disalin: ia hanya menyimpan galat,
  # dan galat itulah yang hilang kalau kita baru melihatnya besok.
  journalctl -u cloudflared --since "-3 min" --no-pager 2>/dev/null \
    | grep -iE "ERR|Unregistered|lost|Retrying" | tail -5 | sed "s/^/$stempel   /" >> "$LOG"
elif [ "$(date +%M)" = "00" ]; then
  echo "$stempel baik cf=$cf origin=$origin tunnel=$tunnel" >> "$LOG"
fi
