#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOCKERFILE="$ROOT/Dockerfile.worker"

fail() { echo "[worker-container] FAIL: $*" >&2; exit 1; }
need() { grep -Fq -- "$1" "$DOCKERFILE" || fail "Dockerfile.worker missing: $1"; }

test -f "$DOCKERFILE" || fail "Dockerfile.worker tidak ditemukan"
test -f "$ROOT/assets/fonts/Poppins-ExtraBold.ttf" || fail "font Poppins tidak ada"
test -f "$ROOT/assets/models/face_detection_yunet_2023mar.onnx" || fail "model YuNet tidak ada"
test -f "$ROOT/assets/music/bg-loop.m4a" || fail "asset musik tidak ada"

need "FROM node:22-bookworm-slim AS dependencies"
need "FROM node:22-bookworm-slim AS runtime"
need "ffmpeg python3 python3-pil python3-pip"
need "tesseract-ocr tesseract-ocr-eng"
need "opencv-python-headless==4.10.0.84"
need "FFMPEG_PATH=/usr/bin/ffmpeg"
need "FFPROBE_PATH=/usr/bin/ffprobe"
need "NODE_OPTIONS=--max-old-space-size=256"
need "COPY --chown=racun:racun knowledge ./knowledge"
need "COPY --chown=racun:racun assets/fonts ./assets/fonts"
need "COPY --chown=racun:racun assets/models ./assets/models"
need "USER racun"
need 'CMD ["npm", "run", "worker"]'

if ! command -v docker >/dev/null 2>&1; then
  echo "[worker-container] PASS static: Docker tidak tersedia; build runtime dilewati."
  exit 0
fi

IMAGE="racun-worker:container-check"
docker build --target runtime -t "$IMAGE" -f "$DOCKERFILE" "$ROOT"
docker run --rm --entrypoint sh "$IMAGE" -ec '
  test "$(id -u)" = "10001"
  test "$NODE_OPTIONS" = "--max-old-space-size=256"
  command -v ffmpeg
  command -v ffprobe
  command -v tesseract
  tesseract --list-langs | grep -qx eng
  python3 -c "import PIL, cv2; print(\"PIL+OpenCV\", cv2.__version__)"
  python3 -c "import cv2; m=\"/srv/app/assets/models/face_detection_yunet_2023mar.onnx\"; d=cv2.FaceDetectorYN_create(m, \"\", (320,320), 0.9, 0.3, 5000); assert d is not None; print(\"YuNet loader OK\")"
  test -f /srv/app/assets/fonts/Poppins-ExtraBold.ttf
  test -f /srv/app/assets/models/face_detection_yunet_2023mar.onnx
  test -f /srv/app/assets/music/bg-loop.m4a
  test -f /srv/app/knowledge/rules/modes.md
  test -w /srv/app/storage/jobs
'

# SUMBU MODE HIDUP DI DALAM IMAGE — bukan sekadar berkasnya ada.
#
# Cek berkas saja tidak cukup: modul memuat modes.md relatif terhadap cwd
# proses, jadi berkas yang ada tapi tidak terbaca dari WORKDIR tetap
# menghasilkan tabel kosong — dan tabel kosong TIDAK melempar, ia hanya
# membuat prompt keluar tanpa kontrak kamera. Persis kegagalan diam-diam yang
# lolos sampai 19 Agu karena knowledge/ memang tidak pernah ikut ke image.
docker run --rm --entrypoint sh "$IMAGE" -ec '
  ./node_modules/.bin/tsx -e "import(\"/srv/app/lib/media/mode-kamera\").then((m) => {
    if (m.MODE_KAMERA.length !== 14) { console.error(\"sumbu mode MATI di image: \" + m.MODE_KAMERA.length + \" mode\"); process.exit(1); }
    console.log(\"sumbu mode OK di image: \" + m.MODE_KAMERA.length + \" mode\");
  })"
' || fail "sumbu mode tidak hidup di dalam image worker (knowledge/rules/modes.md tidak terbaca dari WORKDIR)"
echo "[worker-container] PASS image runtime: FFmpeg, Tesseract OCR, Python PIL/OpenCV, assets, knowledge/ (sumbu mode 14), dan user non-root."
