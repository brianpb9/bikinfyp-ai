// LUBANG REFERENSI PALSU — ditutup di INTAKE, bukan di QC.
//
// Ditemukan 20 Agu dengan cara yang tidak menyenangkan: foto uji
// test_output/canary-glow.jpg ternyata gambar AI yang labelnya berbunyi
// "bdodpgeer", "SOINd", "PAL Q3". Foto itu dipakai sebagai referensi di lima
// render berbayar, dan huruf karangan yang kami kira dikarang model video
// besar kemungkinan DISALIN dari fotonya.
//
// Gerbang intake sebenarnya sudah ada, tapi bocor di tiga tempat:
//   1. pemanggilnya cuma memeriksa `terbaca` dan MENGABAIKAN `cocokNama`;
//   2. `cocokNama` menebak merek dari NAMA PRODUK, bukan dari merek tepercaya
//      (raw_meta.brand) yang dipakai QC-F1;
//   3. pencocokannya substring 4 huruf — kelemahan yang sama persis dengan
//      QC-10 versi lama yang meloloskan "moseru" untuk "Mosseru".
//
// Jadi foto berlabel omong kosong lolos: ia "terbaca" (banyak kata
// berkeyakinan tinggi), dan kecocokan mereknya tidak pernah ditanyakan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-intake-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-intake-storage-${process.pid}`;

const { periksaLabelFoto } = await import("../lib/media/label-terbaca");

/** Fixture regresi: foto AI berlabel omong kosong yang sempat jadi referensi. */
const FOTO_PALSU = path.resolve(process.cwd(), "..", "test_output", "canary-glow.jpg");
/** Foto produk sungguhan, label terbaca benar. */
const FOTO_ASLI = path.resolve(process.cwd(), "..", "test_output", "jjglow-produk.png");

function punyaOcr(): boolean {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("FIXTURE REGRESI: foto berlabel karangan DITOLAK", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada di mesin ini");
  if (!fs.existsSync(FOTO_PALSU)) return t.skip(`fixture tidak ada: ${FOTO_PALSU}`);
  const hasil = await periksaLabelFoto(FOTO_PALSU, "Serum Glow Bright", "Glow Bright");
  // Ditolak — entah karena labelnya tidak terbaca meyakinkan (jalur lama:
  // hanya "Sony" yang lolos ambang keyakinan) atau karena mereknya tidak
  // cocok. Yang penting foto ini TIDAK PERNAH jadi referensi.
  assert.ok(
    hasil.terbaca === false || hasil.cocokMerek === false,
    `foto AI berlabel "bdodpgeer" LOLOS intake — OCR: ${JSON.stringify(hasil.kata).slice(0, 200)}`
  );
  assert.ok(hasil.alasan && hasil.alasan.length > 20, "penolakan tanpa alasan yang bisa dibaca pengguna");
});

test("foto TAJAM tapi merek berbeda ditolak dengan pesan merek", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada di mesin ini");
  if (!fs.existsSync(FOTO_ASLI)) return t.skip("fixture tidak ada");
  // Inilah kasus yang gerbang keterbacaan TIDAK bisa tangkap: fotonya bagus,
  // labelnya terbaca sempurna — tapi itu produk orang lain.
  const hasil = await periksaLabelFoto(FOTO_ASLI, "Scarlett Acne Serum", "Scarlett");
  assert.equal(hasil.terbaca, true, "foto tajam seharusnya terbaca");
  assert.equal(hasil.cocokMerek, false, "foto merek lain diterima sebagai referensi");
  assert.match(String(hasil.alasan), /merek terdaftar/i);
});

test("foto produk SUNGGUHAN dengan merek terdaftar diterima", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada di mesin ini");
  if (!fs.existsSync(FOTO_ASLI)) return t.skip(`fixture tidak ada: ${FOTO_ASLI}`);
  const hasil = await periksaLabelFoto(FOTO_ASLI, "JJ Glow Gluta Pink Brightening Soap", "Gluta Pink");
  assert.equal(hasil.terbaca, true, `label foto asli tidak terbaca: ${JSON.stringify(hasil).slice(0, 200)}`);
  assert.notEqual(hasil.cocokMerek, false, `foto asli DITOLAK — gerbang yang menolak yang benar akan dimatikan orang: ${hasil.alasan}`);
});

test("tanpa merek terdaftar: TIDAK dituduh palsu, tapi juga tidak diaku terverifikasi", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada di mesin ini");
  if (!fs.existsSync(FOTO_PALSU)) return t.skip("fixture tidak ada");
  // Doktrin yang sama dengan QC-F1: tanpa sumber merek tepercaya, tidak ada
  // yang bisa dibuktikan — dan yang tidak terbukti tidak boleh disebut lulus.
  const hasil = await periksaLabelFoto(FOTO_PALSU, "Serum Glow Bright", null);
  assert.equal(hasil.cocokMerek, null, "tanpa merek tepercaya seharusnya 'tidak diperiksa', bukan lulus/gagal");
});

test("pencocokan KETAT — salah eja bukan kecocokan", async () => {
  // Aturan yang sama dengan QC-10/QC-F1: kelebihan huruf boleh, kekurangan
  // tidak. "moseru" BUKAN "mosseru".
  const { merekCocok } = await import("../lib/media/qc-frame");
  assert.equal(merekCocok("mosseru bright", "mosseru"), true);
  assert.equal(merekCocok("moseru bright", "mosseru"), false, "salah eja diterima — persis cacat 18 Agu");
});
