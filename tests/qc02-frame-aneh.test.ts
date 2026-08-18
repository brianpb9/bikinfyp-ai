// QC-02 berjalan SESUDAH penyedia video dibayar, jadi setiap kali ia melempar
// karena bentuk frame yang tidak terduga, biayanya sudah keluar. Tes ini
// mengadu skripnya dengan frame yang memang aneh — grayscale, beralpha,
// seluruhnya warna kulit, kontur berlekuk tajam — dan menuntut ia MENJAWAB,
// bukan melempar.
//
// IndexError yang dilaporkan TEREPRODUKSI di sini, dan sebabnya bukan frame
// rusak: cv2.convexityDefects mengembalikan (N, 1, 4) di sebagian versi
// OpenCV dan (N, 4) di sebagian lain. Kode lama membaca defects[:, 0] lalu
// d[3] — pada bentuk kedua d adalah satu bilangan, dan d[3] melempar. Jadi
// yang menentukan bukan videonya, melainkan versi OpenCV di mesin yang
// menjalankannya: hijau di laptop, merah di worker, sesudah provider dibayar.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SKRIP = path.join(process.cwd(), "lib", "media", "qc_hand_morph_check.py");
const python = process.env.PYTHON_BIN ?? "python3";

function adaOpencv(): boolean {
  try {
    execFileSync(python, ["-c", "import cv2, numpy"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const bisa = adaOpencv();

test("frame aneh dijawab, bukan dilempar", { skip: !bisa }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc02-"));
  // Frame dibuat lewat OpenCV sendiri supaya bentuknya benar-benar sesuai
  // yang dijanjikan (grayscale beneran, alpha beneran).
  const pembuat = `
import cv2, numpy as np, sys
d = sys.argv[1]
# 1: grayscale
cv2.imwrite(d + "/a.png", np.full((240, 135), 128, np.uint8))
# 2: BGRA
bgra = np.zeros((240, 135, 4), np.uint8); bgra[:] = (120, 150, 200, 255)
cv2.imwrite(d + "/b.png", bgra)
# 3: seluruh frame warna kulit
cv2.imwrite(d + "/c.png", np.full((240, 135, 3), (120, 150, 200), np.uint8))
# 4: bentuk berlekuk tajam (kontur dengan banyak cekungan)
img = np.zeros((240, 135, 3), np.uint8)
titik = np.array([[[67 + int(50 * np.cos(t)) if i % 2 == 0 else 67 + int(18 * np.cos(t)),
                    120 + int(50 * np.sin(t)) if i % 2 == 0 else 120 + int(18 * np.sin(t))]]
                  for i, t in enumerate(np.linspace(0, 2 * np.pi, 40))], np.int32)
cv2.fillPoly(img, [titik.reshape(-1, 2)], (120, 150, 200))
cv2.imwrite(d + "/d.png", img)
`;
  execFileSync(python, ["-c", pembuat, dir]);
  const frames = ["a", "b", "c", "d"].map((n) => path.join(dir, `${n}.png`));

  const out = execFileSync(python, [SKRIP, ...frames], { encoding: "utf8" });
  const hasil = JSON.parse(out) as { sampled_frames: number; evaluated_pairs: number; anomalies: unknown[] };
  assert.equal(hasil.sampled_frames, 4);
  assert.ok(Array.isArray(hasil.anomalies), out);

  // Dan tetap bisa dijalankan berpasangan, seperti yang dilakukan worker.
  for (let i = 0; i + 1 < frames.length; i++) {
    const pasangan = JSON.parse(execFileSync(python, [SKRIP, frames[i], frames[i + 1]], { encoding: "utf8" }));
    assert.equal(pasangan.sampled_frames, 2);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
