// P0 regresi 18 Agu: QC-07 selalu FAIL untuk SEMUA format, setelah provider
// video dibayar.
//
// Sebabnya: qc.ts meratakan teks final jadi SATU segmen role:"hook" lalu
// memanggil validateScript(..., "light") sebagai proksi "cuma L-10/L-11 yang
// keras". Begitu L-03 dijadikan keras di light, tidak ada segmen CTA -> L-03
// selalu gagal -> compositing ulang -> FAILED/refund, dengan ongkos provider
// sudah keluar.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-qc07-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qc07-storage-${process.pid}`;

const { periksaKataTerlarang, validateScript } = await import("../lib/script-engine/validator");

test("teks final TANPA CTA tidak lagi dianggap melanggar — inti regresinya", () => {
  // Persis bentuk yang dibangun qc.ts: seluruh dialog jadi satu untaian.
  const teksFinal = "Nah, jerawat masih bandel juga sih? aku pakai ini tiap malam deh, cek keranjang kuning ya";
  assert.deepEqual(periksaKataTerlarang(teksFinal), [], "teks bersih tidak boleh menghasilkan pelanggaran");

  // Bandingkan dengan proksi LAMA: satu segmen berperan "hook", tanpa CTA.
  const proksiLama = validateScript(
    { hook_family: "H1", register: "bestie", segments: [{ role: "hook", text: teksFinal }],
      productName: "Serum Glow", priceIdr: 85000 } as never,
    "light"
  );
  assert.ok(proksiLama.errors.some((e) => e.rule === "L-03"),
    "proksi lama memang menghasilkan L-03 — itulah kenapa ia tidak boleh dipakai lagi");
});

test("QC-07 tetap menangkap yang memang jadi tugasnya", () => {
  const over = periksaKataTerlarang("produk ini dijamin pasti bikin glowing");
  assert.ok(over.some((e) => e.rule === "L-10"), JSON.stringify(over));
  const medis = periksaKataTerlarang("krim ini menyembuhkan jerawat dan aman untuk ibu hamil");
  assert.ok(medis.some((e) => e.rule === "L-11"), JSON.stringify(medis));
});

test("QC-07 tidak lagi ikut berubah kalau aturan STRUKTUR naskah berubah", () => {
  // Teks yang melanggar banyak aturan struktur (kepanjangan, tanpa keranjang,
  // hook tanpa perangkat) tapi tidak memuat kata terlarang: QC-07 harus PASS.
  const panjangTanpaCta = "Botol kaca kecil berisi cairan bening di meja " + "kata ".repeat(60);
  assert.deepEqual(periksaKataTerlarang(panjangTanpaCta), [],
    "QC-07 bukan pemeriksa struktur — ia hanya memeriksa kata terlarang");
  // Sementara validator struktur memang menolaknya.
  const struktur = validateScript(
    { hook_family: "H1", register: "bestie", segments: [{ role: "hook", text: panjangTanpaCta }],
      productName: "Serum Glow", priceIdr: 85000, qualityTier: "high_quality", durationSec: 15 } as never,
    "strict"
  );
  assert.equal(struktur.passed, false);
});

test("qc.ts memanggil pemeriksa terpisah, bukan proksi mode", async () => {
  const fsx = await import("node:fs");
  const src = fsx.readFileSync("lib/media/qc.ts", "utf8");
  assert.match(src, /periksaKataTerlarang\(input\.finalTexts\.join\(" "\)\)/);
  // Proksi lama tidak boleh kembali: pola inilah yang membuat QC-07 ikut
  // berubah setiap kali daftar aturan struktur berubah.
  assert.ok(!/segments: \[\{ role: "hook", text: input\.finalTexts/.test(src),
    "meratakan teks final jadi segmen hook lalu memvalidasi struktur = regresi yang sama");
});
