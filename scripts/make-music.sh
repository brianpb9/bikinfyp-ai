#!/usr/bin/env bash
# Buat aset musik latar placeholder (loop ambient lembut, bebas royalti karena
# disintesis sendiri) untuk mode Senyap+Teks.
# CARA MENGGANTI DENGAN TRACK ASLI: timpa assets/music/bg-loop.m4a dengan file
# m4a/mp3 berlisensi bebas (durasi bebas — compositor me-loop-nya).
set -eu
cd "$(dirname "$0")/.."
mkdir -p assets/music
FFMPEG=${FFMPEG_PATH:-/opt/homebrew/bin/ffmpeg}
"$FFMPEG" -y \
  -f lavfi -i "sine=frequency=261.63:duration=32" \
  -f lavfi -i "sine=frequency=329.63:duration=32" \
  -f lavfi -i "sine=frequency=392.00:duration=32" \
  -filter_complex "[0:a][1:a][2:a]amix=inputs=3:normalize=0,volume=0.12,tremolo=f=0.25:d=0.5,afade=t=in:st=0:d=2,afade=t=out:st=30:d=2,aformat=sample_rates=44100:channel_layouts=stereo" \
  -c:a aac -b:a 96k assets/music/bg-loop.m4a
echo "OK: assets/music/bg-loop.m4a ($(stat -f%z assets/music/bg-loop.m4a) bytes)"
