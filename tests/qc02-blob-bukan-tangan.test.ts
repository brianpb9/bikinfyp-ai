// QC-02 MENILAI ASPAL SEBAGAI TANGAN (job 2a040ce1, Brian 9 Sep 2026).
//
// Job kedua yang ditolak QC-02 secara keliru, dan sebabnya BUKAN potongan
// adegan seperti job sebelumnya. Diukur pada video aslinya:
//
//   frame_005: siluet "kulit" 25.8% frame, kotak batas 480x684 pada gambar
//              480 piksel — SELEBAR PENUH, 80% tingginya
//   sepanjang video: median lebar blob 94% frame, 17 dari 30 frame >= 90%
//
// Yang terdeteksi adalah ASPAL. Rentang YCrCb kulit juga mencakup beige/tan:
// paving, beton, kardus, kayu, pasir. Diperparah acuan berpita blur — konten
// kulit muncul tiga kali (pita atas, tengah, pita bawah) lalu menyatu.
//
// Seluruh pemeriksaan bertumpu pada satu asumsi — "siluet kulit terbesar
// adalah tangan" — dan asumsi itu tidak pernah diperiksa. Blob yang menguasai
// KEDUA sumbu frame adalah latar; tangan menyentuh satu-dua tepi.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SKRIP = path.join(process.cwd(), "lib", "media", "qc_hand_morph_check.py");
const python = process.env.PYTHON_BIN ?? "python3";
function adaOpencv(): boolean {
  try { execFileSync(python, ["-c", "import cv2, numpy"], { stdio: "ignore" }); return true; } catch { return false; }
}
const bisa = adaOpencv();
const KULIT = "(120, 150, 200)";

function jalankan(dir: string, resep: string) {
  execFileSync(python, ["-c", resep, dir]);
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f));
  return JSON.parse(execFileSync(python, [SKRIP, "--fps=2", ...frames], { encoding: "utf8" })) as
    { evaluated_pairs: number; anomalies: unknown[] };
}

test("blob yang menguasai kedua sumbu frame diperlakukan sebagai LATAR", () => {
  if (!bisa) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-latar-"));
  // Meniru aspal: bidang warna-kulit selebar penuh frame, tinggi 80%, yang
  // berubah bentuk saat kamera bergerak. Tanpa saringan ini, perubahan itu
  // terbaca sebagai tangan yang morphing.
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
a = np.full((240, 135, 3), 60, np.uint8)
cv2.rectangle(a, (0, 45), (134, 239), ${KULIT}, -1)          # selebar penuh, 80% tinggi
cv2.imwrite(d + "/f001.png", a)
b = np.full((240, 135, 3), 60, np.uint8)
cv2.rectangle(b, (0, 150), (134, 239), ${KULIT}, -1)          # menyusut drastis
for x in (20, 50, 80, 110):
    cv2.rectangle(b, (x, 150), (x + 9, 200), (60, 60, 60), -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const hasil = jalankan(dir, resep);
  assert.equal(hasil.evaluated_pairs, 0, "bidang selebar frame masih dinilai sebagai tangan");
  assert.equal(hasil.anomalies.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("tangan yang WAJAR tetap dinilai — saringan tidak mematikan gerbang", () => {
  if (!bisa) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-tangan-"));
  // Lebar blob ~50% frame: masuk akal sebagai tangan, dan memang morphing.
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
def latar():
    im = np.full((240, 135, 3), 70, np.uint8); im[0:120, :] = 95
    return im
a = latar(); cv2.circle(a, (60, 150), 17, ${KULIT}, -1)
cv2.imwrite(d + "/f001.png", a)
b = latar(); cv2.ellipse(b, (60, 150), (33, 46), 0, 0, 360, ${KULIT}, -1)
for x in (34, 50, 66, 80):
    cv2.rectangle(b, (x, 104), (x + 6, 150), (95, 95, 95), -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const hasil = jalankan(dir, resep);
  assert.equal(hasil.evaluated_pairs, 1, "tangan berukuran wajar ikut tersaring — gerbangnya mati");
  assert.equal(hasil.anomalies.length, 1, "morphing tangan tidak lagi ditangkap");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("lengan melintang lebar tapi tipis tetap dinilai", () => {
  if (!bisa) return;
  // Syaratnya sengaja DUA sumbu sekaligus. Lengan yang melintang bisa selebar
  // frame tanpa menjadi latar — kalau saringannya cuma soal lebar, shot lengan
  // akan berhenti diperiksa sama sekali.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-lengan-"));
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
a = np.full((240, 135, 3), 70, np.uint8)
cv2.rectangle(a, (0, 110), (134, 140), ${KULIT}, -1)   # selebar frame, tinggi 12%
cv2.imwrite(d + "/f001.png", a)
b = np.full((240, 135, 3), 70, np.uint8)
cv2.rectangle(b, (0, 110), (134, 142), ${KULIT}, -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const hasil = jalankan(dir, resep);
  assert.equal(hasil.evaluated_pairs, 1, "lengan melintang ikut tersaring padahal bukan latar");
  fs.rmSync(dir, { recursive: true, force: true });
});
