// BUG (ditemukan dari tiga generate NYATA, 20 Agu 2026): nama produk resmi
// yang memuat kata klaim menjatuhkan standar 10/10 baris 6.
//
// "Scarlett Whitening Serum" adalah nama SKU yang benar-benar ada di katalog
// Brian. Idenya ditandai "menyebut klaim yang tidak boleh diucapkan" dan
// nilainya ditahan di 6 — padahal yang dilarang baris 6 adalah klaim yang
// DIUCAPKAN, bukan menyebut nama barangnya. Akibatnya setiap SKU dengan kata
// itu di namanya mustahil lolos gate, berapa pun bagus idenya.
//
// Perbaikannya memakai pola yang sudah terbukti di penyaring pemicu: buang
// kemunculan NAMA PRODUK dulu, lalu periksa sisanya. Yang tetap dilarang:
// klaimnya sebagai kalimat.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-klaim-nama-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-klaim-nama-storage-${process.pid}`;

const { nilaiBarisIde } = await import("../lib/script-engine/standar-10");

const dasar = {
  human_situation: "Anak kos berbagi satu botol serum, tiap malam antre di depan cermin",
  mechanic: "time_compression",
  productCategory: "beauty",
  hookLevel: "agak_berani",
  contentType: "affiliate" as const,
};

test("nama produk yang memuat kata klaim TIDAK menjatuhkan baris 6", () => {
  const hasil = nilaiBarisIde({
    ...dasar,
    productName: "Scarlett Whitening Serum",
    one_liner: "Aku tandai garis spidol di botol Scarlett Whitening Serum tiap malam karena tiga anak kos ikut pakai",
    why_stop: "penonton ingin tahu seberapa cepat garisnya turun",
  } as never);
  const b6 = hasil.gagal.find((g) => g.no === 6);
  assert.equal(b6, undefined, `baris 6 salah menuduh nama produk: ${b6?.sebab ?? ""}`);
});

test("klaim yang benar-benar DIUCAPKAN tetap dijatuhkan", () => {
  const hasil = nilaiBarisIde({
    ...dasar,
    productName: "Scarlett Whitening Serum",
    // Di sini "memutihkan" BUKAN bagian nama produk — ia janji hasil.
    one_liner: "Serum ini memutihkan wajahku dalam semalam",
    why_stop: "hasil instan bikin penasaran",
  } as never);
  assert.ok(hasil.gagal.some((g) => g.no === 6), "klaim yang diucapkan harus tetap gagal");
});

test("produk tanpa kata klaim di nama: perilaku lama tidak berubah", () => {
  const bersih = nilaiBarisIde({
    ...dasar, productName: "Somethinc Ceramide Serum",
    one_liner: "Botol serum Somethinc-ku dipakai satu rumah, sisa tiga hari",
    why_stop: "penonton ingin tahu siapa yang menghabiskan",
  } as never);
  assert.equal(bersih.gagal.find((g) => g.no === 6), undefined);

  const kotor = nilaiBarisIde({
    ...dasar, productName: "Somethinc Ceramide Serum",
    one_liner: "Serum ini menyembuhkan jerawat dalam tiga hari",
    why_stop: "klaim klinis bikin penasaran",
  } as never);
  assert.ok(kotor.gagal.some((g) => g.no === 6));
});

test("nama pendek tidak dipakai menutupi apa pun (jaring terlalu lebar)", () => {
  // Nama satu-dua huruf tidak boleh jadi izin membuang kata dari teks.
  const hasil = nilaiBarisIde({
    ...dasar, productName: "JJ",
    one_liner: "Sabun JJ ini memutihkan kulit dalam seminggu",
    why_stop: "hasilnya kelihatan cepat",
  } as never);
  assert.ok(hasil.gagal.some((g) => g.no === 6), "nama pendek tidak boleh melindungi klaim");
});

test("kata klaim dari nama produk aman walau ditulis SENDIRIAN oleh model", () => {
  // Bentuk yang benar-benar ditulis model pada run nyata 20 Agu: nama panjang
  // dipendekkan jadi satu kata ("serum whitening-nya"), lalu dituduh mengklaim.
  const hasil = nilaiBarisIde({
    ...dasar,
    productName: "Scarlett Whitening Serum",
    one_liner: "Botol serum whitening punyaku dipakai satu kos, sisa seminggu",
    why_stop: "penonton ingin tahu siapa yang menghabiskan duluan",
  } as never);
  assert.equal(hasil.gagal.find((g) => g.no === 6), undefined, "kata dari nama produk tidak boleh dihitung klaim");
});

test("kata klaim DI LUAR nama produk tetap dijatuhkan, walau produknya bernama mirip", () => {
  const hasil = nilaiBarisIde({
    ...dasar,
    productName: "Scarlett Whitening Serum",
    // "menyembuhkan" tidak ada di nama — ini janji hasil.
    one_liner: "Serum ini menyembuhkan jerawatku dalam tiga hari",
    why_stop: "hasilnya cepat kelihatan",
  } as never);
  assert.ok(hasil.gagal.some((g) => g.no === 6));
});
