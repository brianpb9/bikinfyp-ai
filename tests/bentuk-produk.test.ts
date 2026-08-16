// Aksi demo harus MUNGKIN secara fisik untuk produknya.
//
// Cacat nyata 16 Agu 2026: JJ Glow Gluta Pink BARSOAP keluar sebagai sabun
// CAIR. Sebabnya aksi demo kategori beauty berbunyi "dropping a little of the
// product", dan body_care "pumping a dollop" — dua-duanya mengandaikan produk
// bisa dituang. Untuk sabun batang itu mustahil, jadi model menuruti aksinya
// dan mengarang bentuk produk yang bisa dituang.
//
// Deskripsi produknya sendiri sudah menyebut "Barsoap". Jadi promptnya
// bertentangan dengan dirinya sendiri — pola yang sama untuk keenam kalinya di
// repo ini, dan tiap kali penyebabnya bukan larangan yang kurang keras.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bentukProduk } from "../lib/media/shot-planner";

test("sabun batang dikenali padat", () => {
  assert.equal(bentukProduk("JJ Glow Sabun", "JJ Glow Sabun Gluta Pink Barsoap"), "padat");
  assert.equal(bentukProduk("Sabun Batang Sereh"), "padat");
  assert.equal(bentukProduk("Lipstik Matte"), "padat");
});

// "sabun cair" memuat kata "sabun"; kalau urutan pemeriksaan dibalik ia akan
// salah tertangkap sebagai padat dan dapat aksi menggosok batang.
test("sabun cair tidak salah dikenali sebagai padat", () => {
  assert.equal(bentukProduk("Sabun Cair Lidah Buaya"), "tuang");
  assert.equal(bentukProduk("Serum Wardah"), "tuang");
  assert.equal(bentukProduk("Body Lotion Vanilla"), "tuang");
});

// Menebak salah arah sama buruknya dengan tidak menebak.
test("bentuk yang tidak jelas tidak ditebak", () => {
  assert.equal(bentukProduk("Produk Baru"), "tidak diketahui");
  assert.equal(bentukProduk("Paket Hemat"), "tidak diketahui");
});
