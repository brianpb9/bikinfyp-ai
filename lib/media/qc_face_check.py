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

# ...tapi ambang MUTLAK saja tidak cukup, dan itu terbukti mahal.
#
# 16 Agu 2026: TVC "Tersangka Glowing" (parodi ruang sidang) ditolak karena "5
# wajah utama", lalu render memperbaiki shot yang sebenarnya tidak cacat.
# Diukur di frame aslinya: tokoh utama 0,378 - penuduh 0,260 - penonton 0,177 /
# 0,148 / 0,119. Penontonnya DEKAT KAMERA, jadi semuanya melewati 0,12. Asumsi
# "latar selalu kecil" runtuh begitu keramaiannya dekat.
#
# Yang sebenarnya dijaga aturan ini adalah TOKOH UTAMA TERDUPLIKASI - dua wajah
# BESAR berukuran mirip (TVC pernah tayang dengan dua perempuan identik di shot
# penutup). Kerumunan tidak pernah seukuran tokohnya. Jadi ukurannya dibuat
# relatif terhadap wajah terbesar di frame yang sama, bukan terhadap frame.
#
# Di frame sengketa itu celahnya lebar: 69% lalu turun ke 47%. Ambang 0,6
# menghasilkan 2 wajah utama - tepat batas rute komedi. Pada kalibrasi lama
# hasilnya tidak berubah: latar 0,09 dibagi presenter 0,25 = 36%, tetap
# terbuang. Aturan relatif ini lebih ketat DAN lebih benar sekaligus.
MIN_RASIO_KE_TERBESAR = 0.6

def main() -> None:
    model = sys.argv[1]
    out = []
    max_faces = 0
    max_utama = 0
    # Model YuNet mahal untuk di-load. Satu invocation menerima seluruh frame
    # satu video, jadi detector harus hidup sepanjang invocation — bukan dibuat
    # ulang untuk setiap frame. Input size tetap di-set sebelum SETIAP detect:
    # katalog dapat berisi frame landscape dan portrait dalam invocation yang
    # sama, dan FaceDetectorYN mensyaratkan ukuran aktual input.
    det = cv2.FaceDetectorYN_create(model, "", (320, 320), score_threshold=0.8)
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
        det.setInputSize((w, h))
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
        if faces is not None and len(faces):
            tinggi = [float(f[3]) / h for f in faces]
            terbesar = max(tinggi)
            for t in tinggi:
                # Dua syarat sekaligus: cukup besar di frame, DAN sebanding
                # dengan wajah terbesar. Yang pertama membuang latar jauh, yang
                # kedua membuang kerumunan dekat.
                if t >= MIN_TINGGI_WAJAH and t >= terbesar * MIN_RASIO_KE_TERBESAR:
                    besar += 1
        out.append({"file": path, "faces": n, "faces_utama": besar, "best_score": best})
        max_faces = max(max_faces, n)
        max_utama = max(max_utama, besar)
    print(json.dumps({"frames": out, "max_faces": max_faces, "max_faces_utama": max_utama}))

if __name__ == "__main__":
    main()
