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
  const dasar = { detail: "", temuan: { bentukSama: null, tutupSama: null, warnaSama: null, tataLetakLabelSama: null, merekTerbaca: null }, biayaIdr: 0,
    evidence: { frameSha256: null, productPhotoSha256: null } };
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
    framePath: PALSU, productPhotoPath: ASLI, productName: "Scarlett Acne Serum",
    merekEksplisit: "Scarlett", productState: "hero",
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
    framePath: ASLI, productPhotoPath: ASLI, productName: "Scarlett Acne Serum",
    merekEksplisit: "Scarlett", productState: "hero",
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

test("merek HANYA dari sumber tepercaya — tidak ada tebakan dari nama produk", async () => {
  const { tokenMerekUtama, usulMerekDariNama } = await import("../lib/media/qc");

  // Tebakan dari nama produk DIHAPUS sebagai keputusan. Ekspektasi lama
  // "Serum Wajah Scarlett -> wajah" dulu dikunci di sini sebagai BENAR; itu
  // keliru, dan reviewer menemukannya. Mengganti satu tebakan (terpanjang)
  // dengan tebakan lain (non-generik pertama) tidak membuatnya benar.
  assert.equal(tokenMerekUtama(null), null, "tanpa sumber tepercaya: tidak tahu");
  assert.equal(tokenMerekUtama("   "), null);

  // Merek eksplisit: kata depan dilewati, bukan dipakai.
  assert.equal(tokenMerekUtama("The Originote"), "originote");
  assert.equal(tokenMerekUtama("Scarlett"), "scarlett");
  assert.equal(tokenMerekUtama("PT Scarlett Whitening"), "scarlett");

  // Usulan dari nama produk tetap ada, TAPI namanya jelas: untuk ditawarkan ke
  // pengguna saat intake, bukan untuk memutuskan gerbang.
  assert.equal(usulMerekDariNama("Scarlett Acne Serum"), "scarlett");
  assert.equal(usulMerekDariNama("The Originote Serum"), "originote");
  // Nama produk rusak dari parser tidak boleh melahirkan "merek" apa pun yang
  // meyakinkan — usulannya boleh salah, dan itu sebabnya ia bukan keputusan.
  assert.equal(usulMerekDariNama("[ Beli 5 box dapat 10"), "beli");
});

test("hero tanpa merek tepercaya = UNVERIFIED, bukan menebak", { skip: !adaArtefak || !adaKunci }, async () => {
  const hasil = await qcF1FrameFidelity({
    framePath: ASLI, productPhotoPath: ASLI, productName: "Scarlett Acne Serum",
    productState: "hero", // merekEksplisit sengaja TIDAK diisi
  });
  assert.equal(hasil.status, "UNVERIFIED");
  assert.equal(bolehJadiReferensi(hasil), false);
  assert.match(hasil.detail, /merek tepercaya/);
});

test("cast-ref memutuskan lewat bolehJadiReferensi(), bukan membaca status sendiri", async () => {
  const fsx = await import("node:fs");
  const src = fsx.readFileSync("lib/media/cast-ref.ts", "utf8");
  // Satu pintu: kalau ada yang membaca status secara langsung untuk MEMUTUSKAN
  // pakai/tidak, jawabannya bisa ditulis ulang jadi `!== "FAIL"` suatu hari.
  assert.match(src, /bolehJadiReferensi\(qc\)/);
  assert.ok(!/qc\.status === "PASS"/.test(src), "keputusan pakai/tidak tidak boleh membaca status langsung");
});

test("merek tepercaya dibaca dari raw_meta, dan tidak pernah ditebak", async () => {
  const { merekTepercaya } = await import("../lib/postgres/worker");
  assert.equal(merekTepercaya({ product_raw_meta: '{"brand":"Scarlett"}' }), "Scarlett");
  assert.equal(merekTepercaya({ product_raw_meta: '{"brand":"  The Originote  "}' }), "The Originote");
  // Tidak ada sumber = null, BUKAN menebak dari nama produk.
  assert.equal(merekTepercaya({ product_raw_meta: "{}" }), null);
  assert.equal(merekTepercaya({ product_raw_meta: null }), null);
  assert.equal(merekTepercaya({ product_raw_meta: "bukan json" }), null, "raw_meta rusak tidak boleh melempar");
  assert.equal(merekTepercaya({ product_raw_meta: '{"brand":42}' }), null, "tipe salah bukan merek");
});

test("merek mengalir worker -> cast-ref -> qcF1 lewat satu nama field", async () => {
  const fsx = await import("node:fs");
  // Rantainya diperiksa di sumber karena ujung-ke-ujungnya butuh render nyata:
  // yang dijaga adalah TIDAK ADA mata rantai yang menjatuhkan fieldnya diam-diam.
  const worker = fsx.readFileSync("lib/postgres/worker.ts", "utf8");
  const castref = fsx.readFileSync("lib/media/cast-ref.ts", "utf8");
  const qcframe = fsx.readFileSync("lib/media/qc-frame.ts", "utf8");
  assert.match(worker, /merekEksplisit: merekTepercaya\(row\)/, "worker mengisi dari sumber tepercaya");
  assert.match(castref, /merekEksplisit\?: string \| null/, "cast-ref menerimanya");
  assert.match(castref, /merekEksplisit: input\.merekEksplisit/, "cast-ref meneruskannya");
  assert.match(qcframe, /merekEksplisit\?: string \| null/, "qcF1 menerimanya");
});
