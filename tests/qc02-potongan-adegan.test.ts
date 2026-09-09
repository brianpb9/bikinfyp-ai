// QC-02 MENOLAK VIDEO YANG BENAR (job 615855d8, dilaporkan Brian 9 Sep 2026).
//
// Naskah, VO, label produk, durasi, audio — semuanya lolos. Yang menjatuhkannya:
//
//   QC-02 fail: anomali siluet frame_012→frame_013: area×2.91, soliditas Δ0.227
//
// Frame 12 adalah close-up spakbor motor kusam (kulit di frame cuma seujung
// jari). Frame 13 adalah presenter memegang botol (dua tangan, leher, dagu).
// Itu POTONGAN ADEGAN, bukan tangan yang morphing — dan area siluet kulit
// memang naik tiga kali lipat ketika adegan berganti.
//
// Deteksi potongan lama memakai jarak histogram warna dengan ambang 0.42.
// Potongan itu mengukur 0.381: DI BAWAH ambang, karena kedua adegan sama-sama
// abu/hitam/putih. Produk otomotif, elektronik, dan kemasan gelap hampir
// selalu sewarna seperti itu — jadi ini bukan kasus tepi, ini seluruh kelas
// produk yang gerbangnya buta terhadapnya.
//
// Video ditolak tiga kali berturut-turut, kredit dikembalikan, konten gagal.
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

/** Bangun sepasang frame lewat OpenCV sendiri, supaya bentuknya sungguhan. */
function buatPasangan(dir: string, resep: string): string[] {
  execFileSync(python, ["-c", resep, dir]);
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f));
}

function jalankan(frames: string[], extra: string[] = []) {
  const out = execFileSync(python, [SKRIP, "--fps=2", ...extra, ...frames], { encoding: "utf8" });
  return JSON.parse(out) as { evaluated_pairs: number; known_cuts: number; anomalies: unknown[] };
}

// Warna kulit YCrCb yang dipakai detektor: BGR sekitar (120,150,200).
const KULIT = "(120, 150, 200)";

test("POTONGAN ADEGAN tidak lagi dibaca sebagai tangan morphing", { skip: !bisa }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-cut-"));
  // Dua adegan berbeda TAPI sewarna — persis kondisi yang membutakan ambang
  // warna tunggal. Latar berubah total; siluet kulit membesar tiga kali.
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
# DUA ADEGAN, PALET SAMA, SUSUNAN BERBEDA — tiruan tanda tangan kegagalan asli.
#
# Angkanya dipilih supaya pasangan ini BENAR-BENAR menjadi anomali kalau aturan
# potongan tidak menangkapnya:
#
#   rasio area siluet kulit  9.7  (ambang 2.8)   <- seujung jari -> dua tangan
#   Δsoliditas             0.246  (ambang 0.13)  <- bulat mulus -> berlekuk
#   -> dua sinyal, cukup untuk menolak video
#
# dan supaya ambang WARNA LAMA tidak menyelamatkannya:
#
#   jarak histogram warna  0.352  (ambang lama 0.42 — DI BAWAH, jadi tak terlihat)
#   perubahan latar        0.245  (syarat baru 0.20 — inilah yang menangkapnya)
#
# Nilai warna 0.352 sengaja dekat dengan potongan nyata job 615855d8 (0.381).
# Kalau syarat latar dicabut atau ambangnya dinaikkan, tes ini memerah.
V0, V1, V2 = 55, 115, 180
a = np.zeros((240, 135, 3), np.uint8)
a[0:80] = V2; a[80:160] = V0; a[160:] = V1          # pita MENDATAR
cv2.circle(a, (100, 200), 15, ${KULIT}, -1)          # kulit kecil, bulat mulus
cv2.imwrite(d + "/f001.png", a)

b = np.zeros((240, 135, 3), np.uint8)
c1, c2 = int(135 * 0.59), int(135 * 0.93)
b[:, 0:c1] = V0; b[:, c1:c2] = V2; b[:, c2:] = V1    # pita TEGAK: palet sama, tata letak lain
cv2.ellipse(b, (67, 130), (44, 62), 0, 0, 360, ${KULIT}, -1)
for x in (34, 56, 78, 96):                            # lekukan -> soliditas jatuh
    col = V0 if x < c1 else (V2 if x < c2 else V1)
    cv2.rectangle(b, (x, 66), (x + 8, 132), (col, col, col), -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const hasil = jalankan(buatPasangan(dir, resep));
  assert.equal(hasil.anomalies.length, 0, "potongan adegan masih dianggap morphing");
  assert.equal(hasil.evaluated_pairs, 0, "pasangan potongan seharusnya tidak dinilai sama sekali");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("MORPHING SUNGGUHAN tetap ditangkap — perbaikan tidak membutakan gerbang", { skip: !bisa }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-morph-"));
  // Beda dari tes di atas HANYA pada latarnya: di sini latarnya DIAM, persis
  // seperti tangan yang berubah bentuk di dalam satu adegan yang berjalan.
  // Kalau syarat latar dibuat terlalu longgar, tes ini yang memerah.
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
def latar():
    im = np.full((240, 135, 3), 70, np.uint8)
    im[0:120, :] = 95
    cv2.rectangle(im, (10, 150), (125, 235), (55, 55, 55), -1)
    return im
a = latar(); cv2.circle(a, (67, 120), 22, ${KULIT}, -1)
cv2.imwrite(d + "/f001.png", a)
# latar IDENTIK, tangan berubah drastis: membesar dan berlekuk (soliditas jatuh)
b = latar()
cv2.ellipse(b, (67, 120), (44, 62), 0, 0, 360, ${KULIT}, -1)
for x in (40, 60, 80, 95):
    cv2.rectangle(b, (x, 58), (x + 7, 120), tuple(int(v) for v in latar()[60, 67]), -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const hasil = jalankan(buatPasangan(dir, resep));
  assert.equal(hasil.evaluated_pairs, 1, "transisi latar-diam seharusnya tetap dinilai");
  assert.equal(hasil.anomalies.length, 1, "morphing tangan lolos — gerbangnya jadi buta");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("batas shot yang DIBERITAHUKAN menutup pasangan itu tanpa menebak warna", { skip: !bisa }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-cuts-"));
  // Pasangan morphing yang sama seperti tes sebelumnya — yang tadinya ANOMALI.
  // Bedanya: pemanggil menyatakan ada sambungan klip di antaranya.
  const resep = `
import cv2, numpy as np, sys
d = sys.argv[1]
def latar():
    im = np.full((240, 135, 3), 70, np.uint8)
    im[0:120, :] = 95
    cv2.rectangle(im, (10, 150), (125, 235), (55, 55, 55), -1)
    return im
a = latar(); cv2.circle(a, (67, 120), 22, ${KULIT}, -1)
cv2.imwrite(d + "/f001.png", a)
b = latar()
cv2.ellipse(b, (67, 120), (44, 62), 0, 0, 360, ${KULIT}, -1)
for x in (40, 60, 80, 95):
    cv2.rectangle(b, (x, 58), (x + 7, 120), tuple(int(v) for v in latar()[60, 67]), -1)
cv2.imwrite(d + "/f002.png", b)
`;
  const frames = buatPasangan(dir, resep);
  // fps=2 -> frame 0 di detik 0.0, frame 1 di detik 0.5. Sambungan di 0.5.
  const hasil = jalankan(frames, ["--cuts=0.5"]);
  assert.equal(hasil.known_cuts, 1, "batas shot tidak terbaca");
  assert.equal(hasil.anomalies.length, 0, "batas shot yang diketahui tidak dihormati");
  fs.rmSync(dir, { recursive: true, force: true });
});
