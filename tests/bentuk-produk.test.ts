// Aksi demo harus MUNGKIN secara fisik untuk produknya.
//
// Cacat nyata 16 Agu 2026: JJ Glow Gluta Pink BARSOAP keluar sebagai sabun
// CAIR. Sebabnya aksi demo kategori beauty berbunyi "dropping a little of the
// product", dan body_care "pumping a dollop" — dua-duanya mengandaikan produk
// bisa dituang. Untuk sabun batang itu mustahil, jadi model menuruti aksinya
// dan mengarang bentuk produk yang bisa dituang.
//
// PERBAIKAN PERTAMANYA SETENGAH JADI, dan audit putaran ketiga benar soal itu:
// menggabungkan semua benda padat jadi satu label "padat" membuat Serum Stick,
// lipstik, dan compact powder SEMUANYA mendapat aksi sabun — "dibasahi lalu
// digosok sampai berbusa". Penggolongnya benar, promptnya tetap salah. Yang
// perlu diketahui bukan "benda ini padat", melainkan APA YANG DILAKUKAN TANGAN
// terhadapnya. Karena itu bentuknya sekarang spesifik, dan tes ini menjaga
// pemetaan bentuk -> aksi, bukan cuma labelnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bentukProduk } from "../lib/media/shot-planner";

test("sabun batang dikenali dan dapat aksi berbusa", () => {
  assert.equal(bentukProduk("JJ Glow Sabun", "JJ Glow Sabun Gluta Pink Barsoap"), "sabun_batang");
  assert.equal(bentukProduk("Sabun Batang Sereh"), "sabun_batang");
  // "shampoo" menyebut isinya, "bar" menyebut bentuknya — bentuk yang menang.
  assert.equal(bentukProduk("Shampoo Bar Rosemary"), "sabun_batang");
});

// "sabun cair" memuat kata "sabun"; kalau urutan pemeriksaan dibalik ia akan
// salah tertangkap sebagai padat dan dapat aksi menggosok batang.
test("cairan tidak salah dikenali sebagai padat", () => {
  assert.equal(bentukProduk("Sabun Cair Lidah Buaya"), "tuang");
  assert.equal(bentukProduk("Serum Wardah"), "tuang");
  assert.equal(bentukProduk("Body Lotion Vanilla"), "tuang");
});

// Kata "liquid"/"cair" adalah KOREKSI SADAR penjual terhadap bentuk yang
// biasanya diasumsikan orang. Koreksi sadar harus menang atas tebakan kita.
test("Liquid Lipstick itu cairan, bukan lipstik putar", () => {
  assert.equal(bentukProduk("Liquid Lipstick Matte"), "tuang");
  assert.equal(bentukProduk("Lip Cream Liquid"), "tuang");
  // Tanpa kata "liquid", lipstik biasa tetap lipstik.
  assert.equal(bentukProduk("Lipstick Velvet Merah"), "lipstik");
});

// Inti temuan audit ketiga: benda padat yang BUKAN sabun tidak boleh berbusa.
test("padat non-sabun tidak diperlakukan seperti sabun", () => {
  assert.equal(bentukProduk("Serum Stick Niacinamide"), "oles_padat");
  assert.equal(bentukProduk("Deodorant Stick"), "oles_padat");
  assert.equal(bentukProduk("Lip Balm Madu"), "oles_padat");
  assert.equal(bentukProduk("Compact Powder Two Way Cake"), "bubuk_padat");
  assert.equal(bentukProduk("Blush On Peach"), "bubuk_padat");
});

// Menebak salah arah sama buruknya dengan tidak menebak.
test("bentuk yang tidak jelas tidak ditebak", () => {
  assert.equal(bentukProduk("Produk Baru"), "tidak diketahui");
  assert.equal(bentukProduk("Paket Hemat"), "tidak diketahui");
  assert.equal(bentukProduk("Kaos Polos Katun"), "tidak diketahui");
});

// Penjaga terhadap kemunduran yang paling mungkin: seseorang menyatukan lagi
// semua bentuk padat ke satu aksi karena "toh sama-sama padat".
test("tiap bentuk padat punya aksi tangan yang berbeda", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "lib/media/shot-planner.ts"), "utf8");
  const blok = src.slice(src.indexOf("const AKSI_PER_BENTUK"), src.indexOf("const AKSI_NETRAL"));
  for (const bentuk of ["sabun_batang", "oles_padat", "bubuk_padat", "lipstik"]) {
    assert.ok(blok.includes(`${bentuk}:`), `aksi untuk ${bentuk} hilang`);
  }
  // Hanya sabun yang boleh menyebut busa. Kalau kata ini bocor ke bentuk lain,
  // kita kembali ke cacat yang sama.
  const menyebutBusa = blok.split("\n").filter((b) => /lather|foam/i.test(b));
  assert.equal(menyebutBusa.length, 1, "hanya aksi sabun batang yang boleh menyebut busa");
  assert.match(menyebutBusa[0], /wetting the solid bar/, "busa harus melekat pada aksi sabun batang");
});
