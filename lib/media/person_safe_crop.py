#!/usr/bin/env python3
"""Foto referensi aman-orang untuk BytePlus r2v (kebijakan "may contain real
person", insiden lab 2026-08-07: SEMUA foto e-commerce fashion memakai model
sehingga render ditolak).

Aturan (keputusan Brian: "jangan pake real person — biar AI yang bikin
orangnya"): foto tanpa wajah dipakai apa adanya; foto berwajah di-crop
otomatis ke area DI BAWAH wajah terbawah (kain/produk saja), lalu dicek ulang
tidak ada wajah tersisa.

Ambang ukuran (2026-08-07, insiden production 990a734e: BytePlus menolak foto
ekstrak-link 200x200 dengan "expected width >= 300px"): foto (atau hasil crop)
di bawah MIN_SIDE DINAIKKAN (upscale, bukan dibuang) — menolak foto otomatis
akan memutus USP "auto-fill foto dari link". Upload/extract (product-images.ts)
SUDAH menaikkan foto baru ke lantai yang sama; pemeriksaan di sini adalah
jaring pengaman untuk foto lama yang tersimpan sebelum fix itu + hasil crop
yang kebetulan jadi terlalu kecil.

Pemakaian: python3 person_safe_crop.py <model.onnx> <outDir> <img1> [img2 ...]
Output: JSON [{"file": ..., "safe": <path|null>, "cropped": bool, "resized": bool, "reason": ...}]
"""
import json
import os
import sys

import cv2

MIN_SIDE = 320  # samakan dengan MIN_REF_SIDE di lib/product-images.ts


def detect_faces(det, img):
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, faces = det.detect(img)
    return [] if faces is None else list(faces)


def ensure_min_side(img):
    """Upscale (Lanczos) supaya sisi terpendek >= MIN_SIDE. No-op bila sudah cukup."""
    h, w = img.shape[:2]
    m = min(h, w)
    if m >= MIN_SIDE:
        return img, False
    scale = MIN_SIDE / m
    new_w, new_h = max(MIN_SIDE, round(w * scale)), max(MIN_SIDE, round(h * scale))
    return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4), True


def main() -> None:
    model, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    det = cv2.FaceDetectorYN_create(model, "", (320, 320), score_threshold=0.6)
    results = []
    for idx, src in enumerate(sys.argv[3:]):
        img = cv2.imread(src)
        if img is None:
            results.append({"file": src, "safe": None, "cropped": False, "resized": False, "reason": "unreadable"})
            continue
        h, w = img.shape[:2]
        faces = detect_faces(det, img)
        if not faces:
            img2, resized = ensure_min_side(img)
            if not resized:
                results.append({"file": src, "safe": src, "cropped": False, "resized": False})
                continue
            base = os.path.splitext(os.path.basename(src))[0]
            dst = os.path.join(out_dir, f"{idx}_{base}_upscaled.png")
            cv2.imwrite(dst, img2)
            results.append({"file": src, "safe": dst, "cropped": False, "resized": True})
            continue
        # Crop di bawah wajah TERBAWAH + margin 5% tinggi (leher/bahu ikut
        # terpotong) — menyisakan kain/produk.
        lowest_bottom = max(int(f[1] + f[3]) for f in faces)
        top = min(h - 1, lowest_bottom + int(h * 0.05))
        crop = img[top:h, 0:w]
        crop, resized = ensure_min_side(crop)
        if detect_faces(det, crop):
            results.append({"file": src, "safe": None, "cropped": False, "resized": False, "reason": "wajah masih terdeteksi setelah crop"})
            continue
        # idx di nama file: dua sumber bisa bernama sama (mis. "0.jpg" dari
        # dua folder produk) — tanpa idx, hasil crop saling menimpa.
        base = os.path.splitext(os.path.basename(src))[0]
        dst = os.path.join(out_dir, f"{idx}_{base}_nohuman.png")
        cv2.imwrite(dst, crop)
        results.append({"file": src, "safe": dst, "cropped": True, "resized": resized})
    print(json.dumps(results))


if __name__ == "__main__":
    main()
