// PRODUK PEMBERSIH KENDARAAN, NASKAH TENTANG CAT RAMBUT (Brian, 9 Sep 2026).
//
// "skrip yang dibuat tidak sesuai konteks, saya memasukkan alat produk
//  pembersih dan pengkilap kendaraan malah di arahkan menjadi cat rambut."
//
// Dua cacat berbeda yang bersambung jadi satu gejala:
//
//   1. guessCategory mencocokkan SUBSTRING, jadi "Cream Polish Body Mobil"
//      dibaca beauty (dari "cream") dan "Penghilang Kerak" dibaca home (dari
//      "rak"). Kategori otomotif malah tidak ada sama sekali.
//   2. Kedua tahap penulis (ide dan naskah) hanya diberi nama + kategori +
//      harga. Deskripsi wujud produk sudah ada di basis data dan sudah dipakai
//      shot-planner, tapi tidak pernah dikirim ke penulis — jadi video
//      menggambar produk yang benar sementara naskahnya bicara produk lain.
//
// Tes ini mengunci keduanya.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { guessCategory } from "../lib/category-guess";
import { blokProdukNyata } from "../lib/script-engine/blok-produk";
import { CATEGORY_NOUN, CATEGORY_PAIN, CATEGORY_PROOF, CATEGORY_HOOK_PRIORITY } from "../lib/config/hooks";

// ── 1. KATEGORI ─────────────────────────────────────────────────────────────

test("produk perawatan kendaraan dikenali otomotif, bukan beauty/home", () => {
  // Delapan nama yang bentuknya wajar untuk katalog Shopee/TikTok Shop.
  for (const nama of [
    "Pembersih dan Pengkilap Kendaraan 500ml",
    "Cairan Penghilang Kerak Jamur Kaca Mobil",
    "Wax Poles Mobil Glossy Coating",
    "Semir Ban Motor Mengkilap",
    "Shampoo Mobil Snow Wash",
    "Pembersih Interior Mobil Foam Cleaner",
    "Cream Polish Body Mobil",
    "Obat Poles Lampu Mobil Kusam",
  ]) {
    assert.equal(guessCategory(nama), "otomotif", `salah kategori: ${nama}`);
  }
});

test("pencocokan memakai batas kata — imbuhan tidak lagi memicu kategori", () => {
  // Kasus uji SENGAJA tanpa satu pun kata otomotif. Versi pertama tes ini
  // memakai "Cream Polish Body Mobil", dan mutasi membuktikan tesnya kosong:
  // nama itu diselamatkan oleh URUTAN (otomotif diperiksa lebih dulu), bukan
  // oleh batas kata — jadi \b bisa dicabut tanpa satu tes pun memerah.
  //
  // Yang di bawah ini hanya bisa lolos lewat \b:
  assert.notEqual(guessCategory("Coffee Creamer Bubuk 1kg"), "beauty", '"creamer" bukan "cream"');
  assert.notEqual(guessCategory("Penghilang Kerak Toilet"), "home", '"kerak" bukan "rak"');
  assert.notEqual(guessCategory("Sarung Jok Motor Anti Selip"), "kids", '"anti" bukan "anak"');
});

test("urutan tabel: kata kendaraan menang atas kata kategori lain", () => {
  // Mekanisme KEDUA, dipisah dari batas kata supaya tiap tes menguji satu hal.
  // "Cream Polish Body Mobil" punya "cream" (beauty) DAN "mobil" (otomotif);
  // yang benar adalah otomotif, dan itu ditentukan urutan, bukan \b.
  assert.equal(guessCategory("Cream Polish Body Mobil"), "otomotif");
  assert.equal(guessCategory("Shampoo Motor Snow Wash"), "otomotif");
});

test("kategori lama tidak rusak oleh batas kata", () => {
  assert.equal(guessCategory("Serum Wajah Glowing 30ml"), "beauty");
  assert.equal(guessCategory("Hijab Segi Empat Voal"), "muslim_fashion");
  assert.equal(guessCategory("Sepatu Sneakers Pria"), "fashion");
  assert.equal(guessCategory("Popok Bayi M40"), "kids");
  assert.equal(guessCategory("Rice Cooker Mini 1.2L"), "kitchen");
  assert.equal(guessCategory("Kopi Susu Literan"), "food");
  assert.equal(guessCategory("Powerbank 10000mAh"), "gadget");
});

test("nama majemuk dinamai dari wadahnya: rak sepatu = home, bukan fashion", () => {
  assert.equal(guessCategory("Rak Sepatu Susun 5 Tingkat"), "home");
  assert.equal(guessCategory("Lemari Baju Portable"), "home");
});

test("otomotif punya konteksnya sendiri di SEMUA tabel, bukan jatuh ke default", () => {
  // Kategori tanpa entri diam-diam memakai baris default — dan kalau itu
  // terjadi, produk kendaraan diberi konteks "barang / zonknya / kualitasnya",
  // yang persis kehambaran yang mau dihindari.
  for (const [nama, tabel] of [
    ["CATEGORY_NOUN", CATEGORY_NOUN],
    ["CATEGORY_PAIN", CATEGORY_PAIN],
    ["CATEGORY_PROOF", CATEGORY_PROOF],
  ] as const) {
    assert.ok(tabel.otomotif, `${nama} belum punya baris otomotif`);
    assert.notEqual(tabel.otomotif, tabel.default, `${nama}.otomotif cuma menyalin default`);
  }
  assert.ok(CATEGORY_HOOK_PRIORITY.otomotif?.length, "prioritas hook otomotif kosong");

  // Tabel di script-engine/index.ts tidak diekspor; dibaca dari sumber.
  const src = readFileSync(new URL("../lib/script-engine/index.ts", import.meta.url), "utf8");
  for (const tabel of ["CATEGORY_SPACE", "CATEGORY_AKTIVITAS", "CATEGORY_IDENTITAS"]) {
    const blok = src.slice(src.indexOf(`const ${tabel}`), src.indexOf("};", src.indexOf(`const ${tabel}`)));
    assert.match(blok, /otomotif:/, `${tabel} belum punya baris otomotif`);
  }
});

// ── 2. PRODUK NYATA SAMPAI KE PENULIS ───────────────────────────────────────

test("blok produk menyebut wujudnya dan menyatakan deskripsi MENGALAHKAN kategori", () => {
  const b = blokProdukNyata({ productVisualDesc: "botol semprot pengkilap bodi kendaraan, 500ml" });
  assert.match(b, /botol semprot pengkilap bodi kendaraan/);
  // Tanpa kalimat prioritas ini, model menghadapi dua sinyal bertentangan
  // (label kategori vs deskripsi) dan menyelesaikannya sesuka hati.
  assert.match(b, /THIS DESCRIPTION WINS/);
});

test("blok kosong kalau tidak ada yang bisa dikatakan", () => {
  assert.equal(blokProdukNyata({}), "");
  assert.equal(blokProdukNyata({ productVisualDesc: "   ", brandBrief: null }), "");
});

test("arahan brand ikut, dan panjangnya dipangkas", () => {
  assert.match(blokProdukNyata({ brandBrief: "jangan sebut diskon" }), /jangan sebut diskon/);
  const panjang = blokProdukNyata({ productVisualDesc: "x".repeat(900) });
  assert.ok(!panjang.includes("x".repeat(500)), "deskripsi tidak dipangkas");
});

test("KEDUA tahap penulis memancarkan blok produk — bukan cuma salah satunya", () => {
  // Tahap ide adalah keputusan paling menentukan di pipeline: kalau IA salah
  // paham produknya, ketiga varian ikut salah dan penulis naskah tidak punya
  // kesempatan memperbaikinya.
  for (const f of ["llm.ts", "ide.ts"]) {
    const src = readFileSync(new URL(`../lib/script-engine/${f}`, import.meta.url), "utf8");
    assert.match(src, /blokProdukNyata\(r\)/, `${f} tidak memanggil blokProdukNyata`);
  }
});

test("rute yang menghasilkan naskah benar-benar mengisi deskripsi produknya", () => {
  // Medan boleh ada di tipe dan tetap tidak pernah terisi — persis cacat yang
  // baru saja diperbaiki. Jadi yang diuji adalah PEMANGGILNYA.
  for (const f of [
    "../app/api/scripts/generate/route.ts",
    "../app/api/dashboard/campaign/generate/route.ts",
    "../app/api/dashboard/matrix/route.ts",
  ]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.match(src, /productVisualDesc: product\.product_visual_desc/, `${f} tidak meneruskan deskripsi produk`);
  }
});
