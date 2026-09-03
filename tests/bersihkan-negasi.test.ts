// Negasi tentang orang dibuang secara MEKANIS dari arahan visual.
//
// Aturannya sudah diberitahukan ke penulis sejak lama, dengan contoh, dan pagi
// 3 Sep 2026 dipertajam sampai menyebut nama field-nya. Sore harinya, di E2E
// produksi, penulis TETAP menulis "no face", "not readable hands", "no hands",
// dan "face not" — dua tier gugur karenanya, ultra habis di percobaan ketiga
// tanpa naskah sama sekali.
//
// Kesimpulannya bukan "aturannya kurang keras". Model bahasa memang cenderung
// menegasikan saat diminta menghindari sesuatu. Memintanya tiga kali lalu
// menyerah berarti membayar tiga panggilan model untuk kegagalan yang bisa
// diperbaiki tanpa satu panggilan pun.
//
// Ini MEMPERKUAT penjagaan: menolak naskah hanya BERHARAP penulis patuh di
// percobaan berikutnya; membuang klausanya MEMASTIKAN kalimat itu tidak pernah
// sampai ke model video.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bersihkanNegasiOrang } from "../lib/script-engine/bersihkan-negasi";
import { periksaPemicu } from "../lib/media/pemicu-filter";

const adaNegasi = (s: string) =>
  periksaPemicu(s, {}).some((t) => t.jenis === "negasi-orang");

// Bentuk-bentuk yang BENAR-BENAR ditulis penulis di produksi 3 Sep 2026.
const DARI_PRODUKSI = [
  "medium shot of the desk, no face visible, warm daylight from the window",
  "close-up on the box, not readable hands near the edge, steady camera",
  "wide shot of the room, no hands in frame, the product centered on the table",
  "the presenter stands beside the desk, face not shown, camera holds steady",
];

test("klausa negasi dari produksi dibuang, sisanya tetap arahan yang sah", () => {
  for (const asli of DARI_PRODUKSI) {
    assert.ok(adaNegasi(asli), `contoh uji tidak memicu detektor: ${asli}`);
    const h = bersihkanNegasiOrang(asli);
    assert.ok(h.dibuang.length > 0, `tidak ada yang dibuang dari: ${asli}`);
    assert.ok(!adaNegasi(h.teks), `masih ada negasi sesudah dibersihkan: ${h.teks}`);
    assert.ok(h.teks.length >= 12, `sisanya terlalu pendek untuk jadi arahan: "${h.teks}"`);
    // Yang tersisa harus menyebut apa yang ADA — bukan potongan rusak.
    assert.doesNotMatch(h.teks, /\b(no|not)\b/i, `kata negasi tertinggal: ${h.teks}`);
  }
});

test("kata negasinya TIDAK dihapus sendirian — klausa utuh yang dibuang", () => {
  // Menghapus "no" dari "close-up, no face visible" menyisakan "close-up,
  // visible": sampah yang lolos pemeriksa dan tetap masuk ke prompt video.
  const h = bersihkanNegasiOrang("close-up on the bottle, no face visible, soft daylight");
  assert.doesNotMatch(h.teks, /visible/, "sisa klausa yang dibuang masih menempel");
  assert.match(h.teks, /close-up on the bottle/);
  assert.match(h.teks, /soft daylight/);
});

test("arahan yang sudah bersih tidak disentuh sama sekali", () => {
  const bersih = "medium shot, eye level. slow push in. she lifts the bottle and turns the label to camera";
  const h = bersihkanNegasiOrang(bersih);
  assert.equal(h.teks, bersih);
  assert.deepEqual(h.dibuang, []);
});

test("pembuangan yang menyisakan terlalu sedikit DIBATALKAN", () => {
  // Arahan visual kosong lebih berbahaya daripada arahan yang ditolak: model
  // video akan mengarang seluruh adegannya sendiri. Biar validator yang
  // memutuskan.
  const h = bersihkanNegasiOrang("no face");
  assert.equal(h.teks, "no face", "teks dikosongkan padahal tidak ada yang tersisa");
  assert.deepEqual(h.dibuang, []);
});

test("nama produk tidak ikut memicu pembuangan", () => {
  // tutupiNama() menutup nama produk sebelum diperiksa — bug nyata yang sudah
  // dibayar sekali ("Scarlett Whitening Serum" dituduh klaim terlarang).
  const teks = "close-up of the No Face Cream jar on the table, warm light, hand turns it";
  const h = bersihkanNegasiOrang(teks, "No Face Cream");
  assert.equal(h.teks, teks, "nama produk ikut dibuang sebagai negasi");
});
