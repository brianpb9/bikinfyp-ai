#!/usr/bin/env python3
"""Foto referensi aman-orang untuk BytePlus r2v (kebijakan "may contain real
person", insiden lab 2026-08-07: SEMUA foto e-commerce fashion memakai model
sehingga render ditolak).

Aturan (keputusan Brian: "jangan pake real person — biar AI yang bikin
orangnya"): foto tanpa wajah dipakai apa adanya; foto berwajah di-crop
otomatis ke area DI BAWAH wajah terbawah (kain/produk saja), lalu dicek ulang
tidak ada wajah tersisa. Crop terlalu kecil (<300px) = foto dibuang.

Pemakaian: python3 person_safe_crop.py <model.onnx> <outDir> <img1> [img2 ...]
Output: JSON [{"file": ..., "safe": <path|null>, "cropped": bool, "reason": ...}]
"""
import json
import os
import sys

import cv2

MIN_SIDE = 300  # provider menolak sisi < 300px


def detect_faces(det, img):
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(img)
    return [] if faces is None else list(faces)


def main() -> None:
    model, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    det = cv2.FaceDetectorYN_create(model, "", (320, 320), score_threshold=0.6)
    results = []
    for idx, src in enumerate(sys.argv[3:]):
        img = cv2.imread(src)
        if img is None:
            results.append({"file": src, "safe": None, "cropped": False, "reason": "unreadable"})
            continue
        h, w = img.shape[:2]
        faces = detect_faces(det, img)
        if not faces:
            results.append({"file": src, "safe": src, "cropped": False})
            continue
        # Crop di bawah wajah TERBAWAH + margin 5% tinggi (leher/bahu ikut
        # terpotong) — menyisakan kain/produk.
        lowest_bottom = max(int(f[1] + f[3]) for f in faces)
        top = min(h - 1, lowest_bottom + int(h * 0.05))
        crop = img[top:h, 0:w]
        ch, cw = crop.shape[:2]
        if ch < MIN_SIDE or cw < MIN_SIDE:
            results.append({"file": src, "safe": None, "cropped": False, "reason": "crop terlalu kecil"})
            continue
        if detect_faces(det, crop):
            results.append({"file": src, "safe": None, "cropped": False, "reason": "wajah masih terdeteksi setelah crop"})
            continue
        # idx di nama file: dua sumber bisa bernama sama (mis. "0.jpg" dari
        # dua folder produk) — tanpa idx, hasil crop saling menimpa.
        base = os.path.splitext(os.path.basename(src))[0]
        dst = os.path.join(out_dir, f"{idx}_{base}_nohuman.png")
        cv2.imwrite(dst, crop)
        results.append({"file": src, "safe": dst, "cropped": True})
    print(json.dumps(results))


if __name__ == "__main__":
    main()
