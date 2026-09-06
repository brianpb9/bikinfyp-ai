// HASHTAG HARUS MENYEBUT PRODUKNYA (laporan Brian, 6 Sep 2026).
//
// Sebelumnya hashtag dibuat dari KATEGORI saja, jadi speaker karaoke 100 watt,
// power bank, dan kabel charger sama-sama mendapat #gadgetviral
// #racunteknologi #gadgetmurah. Tidak satu pun menyebut barangnya — dan tag
// yang tidak menemukan siapa-siapa cuma terlihat seperti pekerjaan.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHashtags } from "../lib/script-engine/caption";
import { kataProduk, MAKS_TAG_PRODUK, TOTAL_HASHTAG } from "../lib/script-engine/hashtag-produk";

const SPEAKER =
  "ADVANCE Portable K1812-C Speaker Profesional Party  RMS 100W 18inch - GARANSI RESMI karokean paket  promo Bluetooth Extr";

test("produk yang berbeda TIDAK boleh menghasilkan hashtag yang sama", () => {
  const a = buildHashtags("gadget", SPEAKER).join(" ");
  const b = buildHashtags("gadget", "Xiaomi Power Bank 20000mAh Fast Charging Original").join(" ");
  assert.notEqual(a, b, "dua barang berbeda di kategori sama menghasilkan tag identik");
});

test("hashtag menyebut jenis barangnya", () => {
  assert.ok(buildHashtags("gadget", SPEAKER).includes("#speaker"), "speaker tidak disebut");
  assert.ok(buildHashtags("kitchen", "Panci Presto Stainless Steel 8 Liter").includes("#panci"));
  assert.ok(buildHashtags("food", "Keripik Pisang Coklat Lumer 250gr").includes("#keripik"));
});

test("kode model, ukuran, dan daya TIDAK jadi hashtag", () => {
  const t = buildHashtags("gadget", SPEAKER);
  // "K1812", "100W", "18inch" — tidak ada yang mencarinya di TikTok, dan
  // memasangnya membuat seluruh deret tag terlihat seperti hasil mesin.
  for (const tag of t) assert.doesNotMatch(tag, /\d/, `tag "${tag}" memuat angka`);
});

test("janji dagang dan sifat umum dibuang", () => {
  const kata = kataProduk("Sepatu Original Garansi Resmi Promo Termurah Ready Stock Premium");
  for (const buruk of ["original", "garansi", "resmi", "promo", "termurah", "ready", "stock", "premium"]) {
    assert.ok(!kata.includes(buruk), `"${buruk}" seharusnya dibuang`);
  }
  assert.ok(kata.includes("sepatu"), "kata barangnya justru hilang");
});

test("merek HURUF BESAR di depan dilewati, merek biasa tidak", () => {
  // "ADVANCE" di judul marketplace hampir selalu merek, dan pembeli yang belum
  // tahu mau beli apa tidak mencari merek.
  assert.ok(!kataProduk(SPEAKER).includes("advance"));
  // "Skintific" ditulis biasa dan memang dicari orang — tidak dibuang.
  assert.ok(kataProduk("Skintific 5X Ceramide Barrier Moisture Gel").includes("skintific"));
});

test("jumlah tag tetap terkendali, dan tag produk didahulukan atas niche", () => {
  const t = buildHashtags("gadget", SPEAKER);
  assert.equal(t.length, TOTAL_HASHTAG, `jumlah tag ${t.length}, seharusnya ${TOTAL_HASHTAG}`);
  assert.equal(new Set(t).size, t.length, "ada tag kembar");
  // Yang dibuang saat penuh haruslah niche, bukan tag produk: tag produk yang
  // membuat video ditemukan orang yang mencari BARANG INI.
  const iProduk = t.indexOf("#speaker");
  const iNiche = t.indexOf("#gadgetviral");
  assert.ok(iProduk >= 0 && iNiche >= 0 && iProduk < iNiche, "tag produk harus mendahului niche");
  assert.ok(!t.includes("#gadgetmurah"), "niche ketiga seharusnya terpotong oleh tag produk");
});

test("tanpa nama produk, perilaku lama dipertahankan apa adanya", () => {
  // Pemanggil lama tidak boleh berubah diam-diam.
  assert.deepEqual(
    buildHashtags("gadget"),
    ["#fyp", "#racuntiktok", "#tiktokshop", "#keranjangkuning", "#spillproduk", "#gadgetviral", "#racunteknologi", "#gadgetmurah"],
  );
});

test("nama produk kosong atau tanpa kata layak tidak menjatuhkan apa pun", () => {
  for (const nama of ["", "   ", "123 456", "A B C"]) {
    const t = buildHashtags("gadget", nama);
    assert.ok(t.length > 0 && t.length <= TOTAL_HASHTAG, `nama "${nama}" menghasilkan ${t.length} tag`);
  }
  assert.ok(kataProduk("ADVANCE").length <= MAKS_TAG_PRODUK);
});
