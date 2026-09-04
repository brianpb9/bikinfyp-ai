// Prompt video berhenti menganggap SEMUA produk adalah botol serum.
//
// ─────────────────────────────────────────────────────────────────────────────
// BUKTI DARI PRODUKSI — prompt job be16d8f3, 4 Sep 2026
// ─────────────────────────────────────────────────────────────────────────────
// Produknya speaker party 18 inci. Yang dikirim ke model:
//
//   "the packaging stays physically intact and correct (one cap, one dropper,
//    nothing floating or duplicated). The ENTIRE bottle and its full label..."
//   "Every \"ADVANCE Portable K1812-C Speaker...\" in frame is at its true small
//    size, about the width of a hand"
//
// Model diberi tahu bahwa ada botol dengan tutup dan pipet, seukuran telapak
// tangan. Ia lalu menghasilkan bentuk yang morphing, dan QC-02 menolaknya tiga
// kali berturut-turut. Videonya sendiri memperlihatkan speaker yang berubah
// rupa dan teks yang membayang.
//
// Kalimat-kalimat itu benar untuk botol serum — produk pertama yang kami
// tangani — dan diam-diam ikut terkirim untuk semua produk sesudahnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(process.cwd(), "lib/media/shot-planner.ts"), "utf8");
// Komentar yang MENJELASKAN kosakata lama tidak boleh dihitung sebagai
// pelanggaran — menghukumnya mengajari orang berikutnya menghapus catatannya.
const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("prompt tidak lagi mengarang bentuk produk", () => {
  for (const kata of ["one cap, one dropper", "ENTIRE bottle", "invented ingredient names", "invented volume figures"]) {
    assert.ok(!kode.includes(kata), `kosakata botol masih dikirim ke model: "${kata}"`);
  }
  // Yang DIJAGA kalimat itu tetap ada: produk identik, label tidak dikarang,
  // seluruh benda di dalam bingkai.
  assert.match(kode, /the exact same product from the reference image/);
  assert.match(kode, /The ENTIRE product and its full/);
  assert.match(kode, /Never render invented words or invented figures/);
});

test("prompt tidak lagi mengarang UKURAN produk", () => {
  assert.ok(!kode.includes("about the width of a hand"), "semua produk masih diklaim seukuran telapak tangan");
  // Maksud aslinya tetap dijaga: foto referensi tidak boleh jadi bidang depan
  // raksasa.
  assert.match(kode, /true real-world size relative to the person handling it/);
});

test("tidak ada lagi perintah BERHENTI satu detik di narasi", () => {
  // Diukur 4 Sep 2026: arahan yang menyuruh berhenti dituruti secara harfiah.
  // Naskah dengan arahan jeda meninggalkan 2,85 dtk sunyi; dengan arahan aktif
  // 0,40 dtk. Lebih buruk lagi ia bertentangan dengan kalimat lain di prompt
  // yang sama ("keeping the narration flowing without long empty gaps") — dan
  // prompt yang memuat dua perintah berlawanan menyerahkan pilihannya ke model.
  assert.ok(!kode.includes("pauses for a full second"), "perintah jeda satu detik masih dikirim");
  assert.ok(!kode.includes("clearly noticeable, not rushed"), "penekanan jeda masih dikirim");
  assert.match(kode, /staying continuous without a long empty gap/, "pemisahan antar baris ikut hilang");
});

test("yang dilafalkan MEREK-nya, bukan judul SKU 24 kata", () => {
  // Prompt lama: Enunciate clearly the words "ADVANCE Portable K1812-C Speaker
  // Profesional Party RMS 100W 18inch - GARANSI RESMI karokean paket promo
  // Bluetooth Extr" — judul marketplace yang bahkan terpotong di tengah kata.
  assert.ok(!kode.includes('Enunciate clearly the words "${input.productName}"'), "judul SKU penuh masih disuruh dilafalkan");
  assert.match(kode, /klausaLafalMerek\(input\.productName\)/, "merek tidak lagi disebut sama sekali");
  assert.match(kode, /Enunciate clearly the brand name "\$\{merek\}"/);
});

test("merek yang jadi KATA PEMICU tidak ikut dikirim", async () => {
  // Menukar nama produk utuh dengan tokenMerek() membuka bahaya yang langsung
  // tertangkap tes: untuk "Sabun Mandi Harian" tokennya "mandi" — kata pemicu
  // penyaring penyedia. Nama UTUH aman karena tutupiNama() menyamarkannya
  // sebelum diperiksa; token telanjang tidak ikut disamarkan.
  //
  // Melafalkan merek itu penyempurnaan; prompt yang ditolak penyedia adalah
  // kegagalan yang dibayar. Jadi saat bertabrakan, yang mengalah penyempurnaannya.
  const { tokenMerek } = await import("../lib/script-engine/validator");
  const { periksaPemicu } = await import("../lib/media/pemicu-filter");
  assert.equal(tokenMerek("Sabun Mandi Harian"), "mandi", "premis tesnya berubah");
  assert.ok(periksaPemicu("mandi", {}).length > 0, "\"mandi\" tidak lagi kata pemicu — tes ini perlu contoh lain");
  assert.match(kode, /if \(periksaPemicu\(merek, \{\}\)\.length > 0\) return "";/,
    "merek tidak diperiksa terhadap penyaring sebelum dikirim");
});
