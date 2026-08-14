#!/usr/bin/env python3
"""QC-09 — deteksi wajah pada frame shot untuk format hands_only (YuNet / OpenCV).
Pemakaian: python3 qc_face_check.py <model.onnx> <frame1.png> [frame2.png ...]
Output: JSON {"frames": [{"file": ..., "faces": n, "best_score": s}], "max_faces": n}
Keterbatasan: YuNet menangkap wajah jelas/sebagian; wajah yang sangat tertutup/blur
bisa lolos — mitigasi utama tetap prompt larangan wajah (shot-planner).
"""
import json
import sys

import cv2

# Ambang tinggi wajah relatif terhadap tinggi frame untuk dianggap SUBJEK.
# 0,12 dikalibrasi pada video katalog nyata: presenter yang bicara ke kamera
# mengisi 0,25-0,45 tinggi frame, sementara orang lewat di latar 0,04-0,09.
# Ambangnya diletakkan di celah lebar di antaranya.
MIN_TINGGI_WAJAH = 0.12

def main() -> None:
    model = sys.argv[1]
    out = []
    max_faces = 0
    max_utama = 0
    for path in sys.argv[2:]:
        img = cv2.imread(path)
        if img is None:
            out.append({"file": path, "faces": 0, "best_score": 0, "error": "unreadable"})
            continue
        h, w = img.shape[:2]
        # r15 (Brian 2026-08-08): ambang 0.6 asli menghasilkan 4 false-positive
        # TERBUKTI hari ini (skor 0.61/0.63/0.63/0.71, semua dicek manual = TIDAK
        # ada wajah, cuma pola kulit tangan/buku jari). Dikalibrasi ulang pakai
        # 2 foto wajah asli sungguhan: skor wajah nyata 0.91 & 0.93 -- gap lebar
        # ke false-positive tertinggi (0.71), jadi 0.8 aman di tengah tanpa
        # kehilangan deteksi wajah sungguhan.
        det = cv2.FaceDetectorYN_create(model, "", (w, h), score_threshold=0.8)
        _, faces = det.detect(img)
        n = 0 if faces is None else len(faces)
        best = 0.0 if faces is None or len(faces) == 0 else round(float(max(x[-1] for x in faces)), 2)
        # WAJAH UTAMA vs WAJAH LATAR.
        #
        # Pemeriksa lokal versi pertama menghitung SEMUA wajah, dan langsung
        # menolak sepuluh video katalog — termasuk "liputan event" dan "waktu
        # berhenti", yang justru premisnya keramaian. Itu mengulang persis
        # kesalahan yang sudah diperbaiki di pemeriksa visi: orang di latar
        # bukan cacat, ia isi ceritanya.
        #
        # YuNet tidak tahu depan-belakang, tapi ia tahu UKURAN, dan wajah di
        # latar selalu kecil. Tinggi kotak wajah relatif terhadap tinggi frame
        # memisahkan keduanya tanpa model tambahan.
        besar = 0
        if faces is not None:
            for f in faces:
                if float(f[3]) / h >= MIN_TINGGI_WAJAH:
                    besar += 1
        out.append({"file": path, "faces": n, "faces_utama": besar, "best_score": best})
        max_faces = max(max_faces, n)
        max_utama = max(max_utama, besar)
    print(json.dumps({"frames": out, "max_faces": max_faces, "max_faces_utama": max_utama}))

if __name__ == "__main__":
    main()
