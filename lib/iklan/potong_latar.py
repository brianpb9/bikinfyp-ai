"""Potong latar foto produk dengan GrabCut (OpenCV) -> PNG RGBA yang dipangkas.

Dipakai end card iklan sinematik: foto produk ASLI penjual ditempel di atas latar
lockup, karena label yang digambar model video selalu jadi huruf acak.

Keluaran (stdout, satu baris JSON): {"ok": bool, "cakupan": float, "alasan": str}
Tidak ada dependensi selain opencv-python-headless dan numpy (sudah ada di worker).
"""

import json
import sys

import cv2
import numpy as np


def main(masuk: str, keluar: str) -> dict:
    img = cv2.imread(masuk, cv2.IMREAD_COLOR)
    if img is None:
        return {"ok": False, "cakupan": 0.0, "alasan": "gambar tidak terbaca"}
    h, w = img.shape[:2]
    skala = 900 / max(h, w) if max(h, w) > 900 else 1.0
    kecil = cv2.resize(img, (int(w * skala), int(h * skala))) if skala != 1.0 else img
    kh, kw = kecil.shape[:2]

    # Foto sudah dipotong ke produk (potongKeProduk) atau produknya di tengah:
    # persegi awal menyisakan tepi 4% sebagai "pasti latar".
    mx, my = max(2, int(kw * 0.04)), max(2, int(kh * 0.03))
    rect = (mx, my, kw - 2 * mx, kh - 2 * my)
    mask = np.zeros((kh, kw), np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(kecil, mask, rect, bgd, fgd, 6, cv2.GC_INIT_WITH_RECT)
    depan = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Satu objek: ambil komponen terbesar, tutup lubang kecil di dalamnya.
    n, label, stats, _ = cv2.connectedComponentsWithStats(depan, 8)
    if n <= 1:
        return {"ok": False, "cakupan": 0.0, "alasan": "tidak ada objek terdeteksi"}
    terbesar = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    depan = np.where(label == terbesar, 255, 0).astype(np.uint8)
    kontur, _ = cv2.findContours(depan, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    penuh = np.zeros_like(depan)
    cv2.drawContours(penuh, kontur, -1, 255, thickness=cv2.FILLED)

    cakupan = float(penuh.mean() / 255.0)
    if cakupan < 0.12 or cakupan > 0.92:
        return {"ok": False, "cakupan": cakupan, "alasan": f"cakupan objek {cakupan:.2f} di luar 0.12–0.92"}

    # Kembali ke resolusi asli, tepi dilembutkan 1–2 px supaya tidak bergerigi.
    alpha = cv2.resize(penuh, (w, h), interpolation=cv2.INTER_LINEAR)
    alpha = cv2.erode(alpha, np.ones((3, 3), np.uint8), iterations=1)
    alpha = cv2.GaussianBlur(alpha, (5, 5), 0)
    rgba = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    ys, xs = np.where(alpha > 10)
    rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    cv2.imwrite(keluar, rgba)
    return {"ok": True, "cakupan": cakupan, "alasan": "ok"}


if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1], sys.argv[2])))
