#!/usr/bin/env python3
"""QC-03 — kemiripan produk antar shot & kehadiran warna khas produk dari referensi.

Dua metrik (keduanya kasar, ambang longgar — hanya untuk penyimpangan TOTAL):
1. antar shot: delta rata-rata RGB region tengah 40% (ambang 60).
2. vs referensi: warna "signature" produk = rata-rata HUE piksel paling jenuh di
   referensi; tiap shot harus mengandung >= 10% piksel dengan hue serupa di region
   tengah. (Warna latar/avg TIDAK dipakai — foto dengan produk kecil akan salah baca.)
Bila produk referensi tidak punya warna jenuh (putih/hitam/polos), metrik (2) di-skip.
Pemakaian: python3 color_similarity.py ref.png shot0.png [shot1.png ...]
Output: JSON {"shot_pairs": [...], "signature": {...|null}, "ref_fractions": [...]}
"""
import colorsys
import json
import sys
from PIL import Image

SAT_MIN = 0.35
VAL_MIN = 0.20
HUE_TOL = 0.045  # ~16 derajat
FRAC_MIN = 0.10

def px_hsv(img):
    small = img.convert("RGB").resize((48, 48))
    for r, g, b in small.getdata():
        yield colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)

def center_crop(img):
    w, h = img.size
    return img.crop((int(w * 0.3), int(h * 0.3), int(w * 0.7), int(h * 0.7)))

def center_avg_rgb(img) -> list[float]:
    crop = center_crop(img).resize((32, 32))
    px = list(crop.getdata())
    n = len(px)
    return [round(sum(c[i] for c in px) / n, 1) for i in range(3)]

def signature_hue(img):
    """Rata-rata hue piksel jenuh di SELURUH referensi (asumsi: produk = objek paling berwarna)."""
    hs = [h for h, s, v in px_hsv(img) if s >= SAT_MIN and v >= VAL_MIN]
    if len(hs) < 30:
        return None
    # rata-rata sirkular
    import math
    sx = sum(math.cos(2 * math.pi * h) for h in hs) / len(hs)
    sy = sum(math.sin(2 * math.pi * h) for h in hs) / len(hs)
    return (math.atan2(sy, sx) / (2 * math.pi)) % 1.0

def hue_fraction(img, hue0) -> float:
    crop = center_crop(img)
    vals = [(h, s) for h, s, v in px_hsv(crop) if s >= 0.3 and v >= VAL_MIN]
    if not vals:
        return 0.0
    close = sum(1 for h, _ in vals if min(abs(h - hue0), 1 - abs(h - hue0)) <= HUE_TOL)
    total = len(list(px_hsv(crop)))
    return round(close / total, 3)

def main() -> None:
    paths = sys.argv[1:]
    imgs = [Image.open(p) for p in paths]
    avgs = [center_avg_rgb(i) for i in imgs]
    shot_pairs = []
    for i in range(1, len(paths)):
        for j in range(i + 1, len(paths)):
            delta = [round(abs(avgs[i][k] - avgs[j][k]), 1) for k in range(3)]
            shot_pairs.append({"a": paths[i], "b": paths[j], "delta": delta, "max": max(delta)})
    sig = signature_hue(imgs[0])
    fracs = [None if sig is None else hue_fraction(imgs[i], sig) for i in range(1, len(paths))]
    print(json.dumps({
        "shot_pairs": shot_pairs,
        "signature": None if sig is None else round(sig, 3),
        "ref_fractions": fracs,
        "frac_min": FRAC_MIN,
    }))

if __name__ == "__main__":
    main()
