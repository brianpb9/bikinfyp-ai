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
        return {"area_fraction": 0.0, "solidity": 0.0, "valleys": 0, "hist": histogram(image), "eligible": False}
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
        "area_fraction": round(area / float(w * h), 5),
        "solidity": round(area / hull_area, 4),
        "valleys": int(min(valleys, 8)),
        "hist": histogram(image),
        "eligible": area / float(w * h) >= 0.008,
    }


def histogram(image):
    small = cv2.resize(image, (64, 64), interpolation=cv2.INTER_AREA)
    hist = cv2.calcHist([small], [0, 1, 2], None, [8, 8, 8], [0, 256] * 3)
    return cv2.normalize(hist, hist).flatten()


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: qc_hand_morph_check.py <frame...>")
    items = [{"file": f, **features(f)} for f in sys.argv[1:]]
    anomalies = []
    evaluated = 0
    for a, b in zip(items, items[1:]):
        # Hard edits/cuts are not a hand morph; ignore their boundary.
        cut = cv2.compareHist(a["hist"].astype("float32"), b["hist"].astype("float32"), cv2.HISTCMP_BHATTACHARYYA) > 0.42
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
    print(json.dumps({"sampled_frames": len(items), "evaluated_pairs": evaluated, "anomalies": anomalies}, default=lambda x: x.tolist()))


if __name__ == "__main__":
    main()
