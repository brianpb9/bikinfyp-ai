#!/usr/bin/env python3
"""QC-01 — apakah MULUT presenter bergerak (YuNet / OpenCV).

Pemakaian: python3 qc_lipsync_check.py <model.onnx> <frame1.png> <frame2.png> ...
Frame WAJIB berurutan waktu, jarak seragam.

Output JSON:
  {"frames": [{"file": ..., "face": bool, "mouth_motion": float}],
   "frames_with_face": n, "mouth_motion_max": f, "mouth_motion_mean": f}

CARA KERJA. YuNet mengembalikan kotak wajah + 5 titik (2 mata, hidung, 2 sudut
mulut). Lima titik tidak cukup untuk mengukur bukaan mulut secara geometris,
jadi yang diukur GERAKAN: potongan daerah mulut dinormalkan ukurannya, lalu
dibandingkan dengan frame sebelumnya. Mulut yang bicara berubah banyak antar
frame; mulut diam hampir tidak berubah.

YANG BISA DIJAWAB: "mulutnya bergerak sama sekali atau tidak". Itu menangkap
kegagalan yang paling parah dan paling sering — presenter membeku sementara
suaranya bicara.

YANG TIDAK BISA DIJAWAB: apakah gerakannya COCOK dengan bunyi yang diucapkan.
Itu butuh viseme, dan sengaja tidak diklaim di sini. Batasannya ditulis supaya
tidak ada yang membaca hasil "lulus" sebagai "lip-sync-nya benar".

Normalisasi ukuran penting: wajah yang lebih dekat ke kamera menghasilkan
potongan lebih besar, dan tanpa normalisasi angkanya tidak bisa dibandingkan
antar frame maupun antar video.
"""
import json
import sys

import cv2
import numpy as np

# Ukuran potongan mulut setelah dinormalkan. Cukup kecil supaya derau sensor
# tidak dominan, cukup besar supaya bentuk mulut masih terbaca.
UKURAN = (48, 32)


def potong_mulut(img, wajah):
    """Potongan daerah mulut dari satu deteksi YuNet.

    Titik YuNet: 0 mata kanan, 1 mata kiri, 2 hidung, 3 sudut mulut kanan,
    4 sudut mulut kiri. Kotaknya dibangun dari kedua sudut mulut, dilebarkan
    supaya bibir atas/bawah dan dagu ikut masuk — bukaan mulut terlihat di
    sana, bukan tepat di garis sudut.
    """
    x, y, w, h = wajah[:4]
    lm = wajah[4:14].reshape(5, 2)
    mk, mki = lm[3], lm[4]
    cx, cy = (mk[0] + mki[0]) / 2, (mk[1] + mki[1]) / 2
    lebar = max(abs(mki[0] - mk[0]) * 1.8, w * 0.45)
    tinggi = max(h * 0.35, lebar * 0.7)
    x0 = int(max(0, cx - lebar / 2))
    x1 = int(min(img.shape[1], cx + lebar / 2))
    y0 = int(max(0, cy - tinggi / 2))
    y1 = int(min(img.shape[0], cy + tinggi / 2))
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    crop = cv2.cvtColor(img[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
    crop = cv2.resize(crop, UKURAN, interpolation=cv2.INTER_AREA)
    # Normalisasi kecerahan: pencahayaan yang berubah antar frame jangan
    # terbaca sebagai mulut yang bergerak.
    crop = crop.astype(np.float32)
    sd = crop.std()
    return (crop - crop.mean()) / sd if sd > 1e-6 else crop - crop.mean()


def main() -> None:
    model_path = sys.argv[1]
    paths = sys.argv[2:]
    det = cv2.FaceDetectorYN.create(model_path, "", (320, 320), 0.7, 0.3, 5000)

    hasil = []
    sebelumnya = None
    for p in paths:
        img = cv2.imread(p)
        if img is None:
            hasil.append({"file": p, "face": False, "mouth_motion": 0.0, "error": "unreadable"})
            continue
        det.setInputSize((img.shape[1], img.shape[0]))
        _, faces = det.detect(img)
        if faces is None or len(faces) == 0:
            hasil.append({"file": p, "face": False, "mouth_motion": 0.0})
            sebelumnya = None  # rantai putus: jangan bandingkan lintas wajah hilang
            continue
        # Wajah terbesar = presenter; wajah kecil di latar bukan yang bicara.
        wajah = max(faces, key=lambda f: f[2] * f[3])
        crop = potong_mulut(img, wajah)
        if crop is None:
            hasil.append({"file": p, "face": True, "mouth_motion": 0.0})
            sebelumnya = None
            continue
        gerak = 0.0 if sebelumnya is None else float(np.abs(crop - sebelumnya).mean())
        sebelumnya = crop
        hasil.append({"file": p, "face": True, "mouth_motion": round(gerak, 4)})

    bergerak = [h["mouth_motion"] for h in hasil if h.get("face")]
    print(json.dumps({
        "frames": hasil,
        "frames_with_face": sum(1 for h in hasil if h.get("face")),
        "mouth_motion_max": round(max(bergerak), 4) if bergerak else 0.0,
        "mouth_motion_mean": round(float(np.mean(bergerak)), 4) if bergerak else 0.0,
    }))


if __name__ == "__main__":
    main()
