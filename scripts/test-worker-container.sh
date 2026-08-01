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
need "opencv-python-headless==4.10.0.84"
need "FFMPEG_PATH=/usr/bin/ffmpeg"
need "FFPROBE_PATH=/usr/bin/ffprobe"
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
  command -v ffmpeg
  command -v ffprobe
  python3 -c "import PIL, cv2; print(\"PIL+OpenCV\", cv2.__version__)"
  python3 -c "import cv2; m=\"/srv/app/assets/models/face_detection_yunet_2023mar.onnx\"; d=cv2.FaceDetectorYN_create(m, \"\", (320,320), 0.9, 0.3, 5000); assert d is not None; print(\"YuNet loader OK\")"
  test -f /srv/app/assets/fonts/Poppins-ExtraBold.ttf
  test -f /srv/app/assets/models/face_detection_yunet_2023mar.onnx
  test -f /srv/app/assets/music/bg-loop.m4a
  test -w /srv/app/storage/jobs
'
echo "[worker-container] PASS image runtime: FFmpeg, Python PIL/OpenCV, assets, dan user non-root."
