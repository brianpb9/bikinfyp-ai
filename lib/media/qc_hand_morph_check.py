#!/usr/bin/env python3
"""Conservative, lightweight QC-02 hand-shape continuity check.

This is deliberately not a hand landmark model: the worker image has OpenCV,
but no large hand model.  It detects abrupt changes in the *skin-coloured
foreground silhouette* across adjacent sampled frames.  A failure requires two
independent morphology signals on the same non-cut transition, keeping normal
hand movement from becoming a false positive.
"""
import json
import math
import sys

import cv2
import numpy as np


def features(filename):
    image = cv2.imread(filename)
    if image is None:
        raise ValueError("cannot read " + filename)
    # Frame grayscale/beralpha tetap masuk lewat jalur yang sama: cvtColor
    # BGR2YCrCb menuntut 3 kanal, dan frame satu kanal membuatnya melempar
    # sebelum satu pun pemeriksaan berjalan.
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
    h, w = image.shape[:2]
    # Conservative YCrCb skin range; only evaluates an actual skin-coloured
    # foreground large enough to plausibly be a hand/forearm.
    ycc = cv2.cvtColor(image, cv2.COLOR_BGR2YCrCb)
    mask = cv2.inRange(ycc, np.array([0, 133, 77]), np.array([255, 173, 127]))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"gray": cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (96, 96), interpolation=cv2.INTER_AREA).astype("float32"),
                "skin_small": cv2.resize(mask, (96, 96), interpolation=cv2.INTER_NEAREST),
                "area_fraction": 0.0, "solidity": 0.0, "valleys": 0, "hist": histogram(image), "eligible": False}
    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    hull = cv2.convexHull(contour)
    hull_area = max(cv2.contourArea(hull), 1.0)
    perimeter = max(cv2.arcLength(contour, True), 1.0)
    valleys = 0
    hull_indices = cv2.convexHull(contour, returnPoints=False)
    # BENTUK defects TIDAK SAMA di semua versi OpenCV: ada yang mengembalikan
    # (N, 1, 4), ada yang (N, 4). Kode lama menulis defects[:, 0] lalu membaca
    # d[3] — pada bentuk kedua, d adalah SATU bilangan, dan d[3] melempar
    # IndexError. Itu terjadi SESUDAH penyedia video dibayar.
    #
    # reshape(-1, 4) membuat kedua bentuk itu jadi satu bentuk. try/except
    # tetap dipasang untuk kontur yang memang ditolak convexityDefects (indeks
    # hull tidak monotonik): kalau lembah jari tidak bisa dihitung, yang hilang
    # sinyal itu saja — dua sinyal lain (area, soliditas) tetap jalan.
    if hull_indices is not None and len(hull_indices) >= 4 and len(contour) >= 4:
        try:
            defects = cv2.convexityDefects(contour, hull_indices)
            if defects is not None:
                # Depth threshold relative to perimeter filters tiny mask noise.
                valleys = sum(1 for d in defects.reshape(-1, 4) if d[3] / 256.0 >= perimeter * 0.018)
        except (cv2.error, IndexError, ValueError) as err:
            print("qc-02: lembah jari dilewati (" + type(err).__name__ + ")", file=sys.stderr)
    return {
        "gray": cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (96, 96), interpolation=cv2.INTER_AREA).astype("float32"),
        "skin_small": cv2.resize(mask, (96, 96), interpolation=cv2.INTER_NEAREST),
        "area_fraction": round(area / float(w * h), 5),
        "solidity": round(area / hull_area, 4),
        "valleys": int(min(valleys, 8)),
        "hist": histogram(image),
        "eligible": area / float(w * h) >= 0.008,
    }


def latar_berubah(a, b):
    """Seberapa besar LATAR (piksel bukan-kulit) berubah antara dua frame.

    Kenapa latar: morphing tangan mengubah siluet kulit SEMENTARA adegannya
    tetap — meja, dinding, dan produk di belakangnya tidak ke mana-mana. Ganti
    adegan mengubah keduanya. Jadi latar adalah pembeda yang tidak bisa
    dikelabui oleh dua adegan yang kebetulan sewarna.
    """
    keep = cv2.bitwise_or(a["skin_small"], b["skin_small"]) == 0
    if keep.sum() < 500:
        return 0.0
    return float(np.mean(np.abs(a["gray"][keep] - b["gray"][keep]))) / 255.0


def histogram(image):
    small = cv2.resize(image, (64, 64), interpolation=cv2.INTER_AREA)
    hist = cv2.calcHist([small], [0, 1, 2], None, [8, 8, 8], [0, 256] * 3)
    return cv2.normalize(hist, hist).flatten()


def main():
    # BATAS SHOT DIBERITAHUKAN, TIDAK LAGI DITEBAK DARI WARNA (9 Sep 2026).
    #
    # Deteksi potongan di bawah memakai jarak histogram warna dengan ambang
    # 0.42. Pada job 615855d8 potongan nyata dari close-up spakbor motor ke
    # presenter memegang botol mengukur 0.381 — DI BAWAH ambang, karena kedua
    # shot sama-sama abu/hitam/putih. Potongan itu lalu dinilai sebagai
    # transisi tangan: area siluet kulit naik 2.91x (seujung jari -> dua tangan
    # + leher + dagu), soliditas berubah 0.227, dua sinyal, ditolak.
    #
    # Video yang benar dibuang tiga kali. Detektor warna memang tidak bisa
    # melihat potongan antar dua adegan yang sewarna — dan produk otomotif,
    # elektronik, dan kemasan gelap justru hampir selalu sewarna.
    #
    # Pemanggil TAHU di mana potongannya: video ini gabungan klip yang
    # durasinya ia tentukan sendiri. Batas yang diberitahukan bersifat pasti;
    # ambang warna dipertahankan sebagai jaring untuk potongan DI DALAM satu
    # klip, yang memang tidak bisa diketahui dari luar.
    cuts = []
    fps = 2.0
    argv = []
    for a in sys.argv[1:]:
        if a.startswith("--cuts="):
            cuts = [float(x) for x in a[len("--cuts="):].split(",") if x.strip()]
        elif a.startswith("--fps="):
            fps = float(a[len("--fps="):]) or 2.0
        else:
            argv.append(a)
    if len(argv) < 2:
        raise SystemExit("usage: qc_hand_morph_check.py [--fps=N] [--cuts=a,b] <frame...>")
    items = [{"file": f, "index": i, **features(f)} for i, f in enumerate(argv)]
    anomalies = []
    evaluated = 0
    for a, b in zip(items, items[1:]):
        # Hard edits/cuts are not a hand morph; ignore their boundary.
        # Batas yang DIBERITAHUKAN menang atas tebakan warna.
        t_a = a["index"] / fps
        t_b = b["index"] / fps
        cut_diketahui = any(t_a < c <= t_b + 1e-6 for c in cuts)
        jarak_warna = cv2.compareHist(a["hist"].astype("float32"), b["hist"].astype("float32"), cv2.HISTCMP_BHATTACHARYYA)
        # DUA TANDA TANGAN, karena satu saja bisa buta.
        #
        # Ambang warna tunggal 0.42 melewatkan potongan job 615855d8: close-up
        # spakbor motor -> presenter memegang botol mengukur 0.381, sebab kedua
        # adegan sama-sama abu/hitam/putih. Produk otomotif, elektronik, dan
        # kemasan gelap hampir selalu begitu.
        #
        # Latarnya sendiri berubah 0.230 di transisi itu, sementara gerakan
        # kamera DI DALAM satu adegan tertinggi 0.167. Keduanya masing-masing
        # terlalu rapat untuk jadi ambang tunggal yang aman — tapi potongan
        # adegan adalah satu-satunya hal yang menggerakkan KEDUANYA sekaligus.
        # Jadi syarat gabungannya sengaja dibuat konjungtif: ia hanya menambah
        # potongan yang terlewat, tidak pernah menambah kegagalan.
        cut = (cut_diketahui
               or jarak_warna > 0.42
               or (jarak_warna > 0.28 and latar_berubah(a, b) > 0.20))
        if cut or not (a["eligible"] and b["eligible"]):
            continue
        evaluated += 1
        area_ratio = max(a["area_fraction"], b["area_fraction"]) / max(min(a["area_fraction"], b["area_fraction"]), 0.0001)
        solidity_delta = abs(a["solidity"] - b["solidity"])
        valley_delta = abs(a["valleys"] - b["valleys"])
        # A 2.8x silhouette expansion alone may be a hand entering frame.  It
        # must coincide with a material contour/topology change to be rejected.
        signals = sum([area_ratio >= 2.8, solidity_delta >= 0.13, valley_delta >= 3])
        if signals >= 2:
            anomalies.append({
                "from": a["file"], "to": b["file"], "area_ratio": round(area_ratio, 2),
                "solidity_delta": round(solidity_delta, 3), "valley_delta": valley_delta,
                "signals": signals,
            })
    # One strongly abnormal non-cut adjacent transition is enough to flag.
    print(json.dumps({"sampled_frames": len(items), "evaluated_pairs": evaluated,
                      "known_cuts": len(cuts), "anomalies": anomalies}, default=lambda x: x.tolist()))


if __name__ == "__main__":
    main()
