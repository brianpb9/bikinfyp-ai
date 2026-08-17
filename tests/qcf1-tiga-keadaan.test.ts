// QC-F1 tiga keadaan (temuan reviewer A10).
//
// Diuji terhadap ARTEFAK NYATA, bukan fixture karangan:
//   asli  = storage/uploads/f4d0d645-.../0.webp        (SCARLETT, dropper, 15 ML)
//   palsu = /tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png (SCARLET, pump, 10 ml)
//
// Frame palsu itu LOLOS di versi sebelumnya. Ia harus GAGAL sekarang.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DB_PATH = `/tmp/racun-test-qcf1-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qcf1-storage-${process.pid}`;

const { merekCocok, bolehJadiReferensi, qcF1FrameFidelity } = await import("../lib/media/qc-frame");

const ASLI = "storage/uploads/f4d0d645-ecd8-4842-be0e-17c14ea5826c/0.webp";
const PALSU = "/tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png";

test("merekCocok menolak merek yang TERPOTONG, menerima derau di ekor", () => {
  // Inti cacatnya: awalan 4 huruf membuat "scarlet" lolos untuk "scarlett" —
  // yaitu menerima MEREK LAIN pada gerbang kesetiaan merek.
  assert.equal(merekCocok("SCARLETT ACNE SERUM", "scarlett"), true, "persis harus cocok");
  assert.equal(merekCocok("scarlettx aa", "scarlett"), true, "derau di ekor boleh");
  assert.equal(merekCocok("its i wi scarlet aa ben acne serum", "scarlett"), false,
    "SCARLET (satu T) BUKAN SCARLETT — ini frame yang dulu false-pass");
  assert.equal(merekCocok("scar", "scarlett"), false, "awalan pendek tidak boleh cukup");
  assert.equal(merekCocok("", "scarlett"), false);
});

test("bolehJadiReferensi HANYA untuk PASS", () => {
  const dasar = { detail: "", temuan: { bentukSama: null, tutupSama: null, warnaSama: null, tataLetakLabelSama: null, merekTerbaca: null }, biayaIdr: 0 };
  assert.equal(bolehJadiReferensi({ ...dasar, status: "PASS" }), true);
  assert.equal(bolehJadiReferensi({ ...dasar, status: "FAIL" }), false);
  assert.equal(bolehJadiReferensi({ ...dasar, status: "UNVERIFIED" }), false,
    "UNVERIFIED tidak boleh dipakai — itu inti temuan A10");
});

// Jalur tanpa kunci diuji di tests/qcf1-tanpa-kunci.test.ts (butuh berkas
// sendiri: config membaca env saat impor pertama).

// Uji berbayar (satu panggilan vision ~Rp12). Dilewati kalau artefak/kunci
// tidak ada, supaya suite tetap jalan di mesin lain.
const adaArtefak = fs.existsSync(ASLI) && fs.existsSync(PALSU);
// Uji vision BERBAYAR dan bergantung jaringan — opt-in, supaya `npm test`
// tetap deterministik dan gratis. Penyedia sempat menjawab 503 berturut-turut
// saat perbaikan ini ditulis; suite yang hijau-merah tergantung cuaca jaringan
// bukan suite.
const adaKunci = Boolean(process.env.GEMINI_API_KEY) && process.env.UJI_QCF1_NYATA === "1";

test("frame SCARLET/pump/10ml GAGAL — frame yang dulu false-pass", { skip: !(adaArtefak && adaKunci) }, async () => {
  const hasil = await qcF1FrameFidelity({
    framePath: PALSU, productPhotoPath: ASLI, productName: "Scarlett Acne Serum", productState: "hero",
  });
  assert.equal(hasil.status, "FAIL", `harus FAIL, dapat ${hasil.status}: ${hasil.detail}`);
  assert.equal(bolehJadiReferensi(hasil), false);
  // Minimal salah satu bukti konkret harus tertangkap.
  const alasan = hasil.detail.toLowerCase();
  assert.ok(/tutup|merek|bentuk|label/.test(alasan), `alasan harus menyebut cacatnya: ${hasil.detail}`);
});

test("foto asli dibandingkan dirinya sendiri LULUS", { skip: !(adaArtefak && adaKunci) }, async () => {
  // Kalau ini gagal, gerbangnya terlalu ketat dan akan menolak frame yang benar.
  const hasil = await qcF1FrameFidelity({
    framePath: ASLI, productPhotoPath: ASLI, productName: "Scarlett Acne Serum", productState: "hero",
  });
  assert.equal(hasil.status, "PASS", `asli vs dirinya sendiri harus PASS: ${hasil.detail}`);
  assert.equal(hasil.temuan.merekTerbaca, true, "OCR hero harus membaca mereknya utuh");
});

test("OCR pada frame palsu NYATA menolak mereknya — tanpa jaringan", { skip: !adaArtefak }, async () => {
  // Ini penjaga deterministik untuk cacat A10: dijalankan tiap `npm test`,
  // membaca ARTEFAK NYATA, dan tidak memanggil penyedia mana pun.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const os = await import("node:os");
  const path = await import("node:path");
  const jalankan = promisify(execFile);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcf1-uji-"));
  try {
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", PALSU, "-vf", "scale=1440:-2:flags=lanczos", png]);
    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11"]);
    assert.ok(/scarlet/i.test(stdout), "frame memang memuat SCARLET — kalau tidak, artefaknya berubah");
    assert.equal(merekCocok(stdout, "scarlett"), false,
      "SCARLET tidak boleh diterima sebagai SCARLETT; inilah false-pass yang ditemukan reviewer");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
