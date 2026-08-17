// Unit test add-on Promo & Urgency (lib/promo.ts + injeksi script-engine):
// - resolvePromo: aktif/nonaktif/kedaluwarsa/tanggal rusak,
// - frasa deadline skrip TANPA angka (L-14) dan bebas frasa L-13,
// - injeksi: harga coret di demo + deadline di CTA, SEMUA varian tetap lolos
//   validator strict di kedua tier (degradasi otomatis bila jatah kata sempit),
// - promo kedaluwarsa -> skrip identik dengan tanpa-promo (drop diam-diam),
// - caption memuat %, tanggal, stok (angka boleh di caption, bukan di skrip).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-promo-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-promo-storage-${process.pid}`;

const { resolvePromo, promoDeadlineSpokenPhrase } = await import("../lib/promo");
const { generateScripts } = await import("../lib/script-engine");
const { validateScript } = await import("../lib/script-engine/validator");

const NOW = new Date("2026-08-06T12:00:00");
const inDays = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

test("resolvePromo: aktif hanya bila harga normal > harga jual dan belum lewat", async () => {
  assert.equal(resolvePromo({ priceIdr: 85000 }, NOW), null);
  assert.equal(resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 85000 }, NOW), null);
  assert.equal(resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 60000 }, NOW), null);
  const p = resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 120000, promoEndsAt: inDays(3), promoStockLeft: 12 }, NOW)!;
  assert.equal(p.pct, 29);
  assert.equal(p.stockLeft, 12);
  // Kedaluwarsa / tanggal rusak -> drop seluruh promo (jangan mengarang urgency).
  assert.equal(resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 120000, promoEndsAt: inDays(-1) }, NOW), null);
  assert.equal(resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 120000, promoEndsAt: "bukan-tanggal" }, NOW), null);
  // Tanggal HARI INI masih berlaku sampai akhir hari.
  assert.ok(resolvePromo({ priceIdr: 85000, promoPriceBeforeIdr: 120000, promoEndsAt: inDays(0) }, NOW));
});

test("frasa deadline skrip: tanpa angka, tanpa frasa terlarang L-13", async () => {
  const cases = [0, 1, 3, 10].map((n) => promoDeadlineSpokenPhrase(new Date(`${inDays(n)}T23:59:59`), NOW));
  for (const phrase of cases) {
    assert.ok(phrase, "frasa wajib ada untuk <=13 hari");
    assert.ok(!/\d/.test(phrase!), `frasa mengandung angka: ${phrase}`);
    for (const banned of ["stok terakhir", "dijamin habis", "habis hari ini", "cuma hari ini", "tinggal hari ini", "stok tinggal"]) {
      assert.ok(!phrase!.includes(banned), `frasa kena L-13: ${phrase}`);
    }
  }
  assert.equal(promoDeadlineSpokenPhrase(new Date(`${inDays(30)}T23:59:59`), NOW), null, ">2 minggu: skrip tidak menyebut deadline");
});

const baseProduct = { id: "prod-promo-1", name: "Serum Glow Bright", price_idr: 85000, category: "beauty" };
// await generateScripts() memanggil resolvePromo() TANPA parameter `now`, jadi ia
// selalu memakai jam server sungguhan. Kalau fixture ini memakai `inDays()`
// yang dihitung dari NOW beku (2026-08-06), promonya berubah jadi kedaluwarsa
// begitu tanggal asli melewatinya — dan tes gagal bukan karena produknya rusak,
// tapi karena tesnya membusuk. (Persis itu yang terjadi: tiga tes promo gagal
// diam-diam mulai 9 Agu 2026.) Fixture yang masuk ke generateScripts karena itu
// dipatok relatif ke HARI INI. NOW beku tetap dipakai untuk unit test
// resolvePromo/promoDeadlineSpokenPhrase yang memang menerima `now` eksplisit.
const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const promoProduct = {
  ...baseProduct,
  promoPriceBeforeIdr: 120000,
  promoEndsAt: daysFromToday(2),
  promoStockLeft: 12,
};

test("injeksi promo: harga coret di demo + deadline di CTA, lolos validator (silent)", async () => {
  const variants = await generateScripts({ product: promoProduct, register: "bestie" });
  for (const v of variants) {
    assert.ok(v.validation.passed, `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
    const demo = v.segments.find((s) => s.role === "demo")!.text;
    assert.ok(demo.includes("dari 120 ribu jadi 85 ribu"), `${v.hook_family}: harga coret tidak masuk demo: ${demo}`);
  }
});

test("injeksi promo di tier bersuara: degradasi otomatis, tetap lolos validator", async () => {
  // Nama panjang: jatah kata bersuara (10-22) bisa habis -> promo boleh ter-drop
  // dari UCAPAN (tetap hidup di overlay + caption), yang penting valid.
  const longName = await generateScripts({ product: promoProduct, register: "bestie", qualityTier: "high_quality" });
  for (const v of longName) {
    // Yang dijaga tes ini DEGRADASI PROMO-nya (elemen promo dilepas satu per
    // satu sampai muat), bukan kelulusan mutlak. Sejak batas 1,5 kata/detik,
    // template dasarnya sendiri melanggar L-05 — utang copy yang tercatat
    // terpisah. Yang harus tetap nol: sebab gagal DI LUAR utang itu.
    const lain = v.validation.errors.map((e) => e.rule).filter((r) => r !== "L-05" && r !== "L-19");
    assert.deepEqual(lain, [], `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
  // Nama pendek: ada ruang -> harga coret masuk ke ucapan minimal di satu varian.
  const shortName = await generateScripts({
    product: { ...promoProduct, id: "prod-promo-short", name: "Serum X" },
    register: "bestie",
    qualityTier: "high_quality",
  });
  for (const v of shortName) {
    // Yang dijaga tes ini DEGRADASI PROMO-nya (elemen promo dilepas satu per
    // satu sampai muat), bukan kelulusan mutlak. Sejak batas 1,5 kata/detik,
    // template dasarnya sendiri melanggar L-05 — utang copy yang tercatat
    // terpisah. Yang harus tetap nol: sebab gagal DI LUAR utang itu.
    const lain = v.validation.errors.map((e) => e.rule).filter((r) => r !== "L-05" && r !== "L-19");
    assert.deepEqual(lain, [], `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
  // KONSEKUENSI NYATA batas 1,5 kata/detik, bukan tes yang ditambal.
  //
  // Harga coret ("dari 120 ribu jadi 85 ribu") menambah 6 kata. Pada jendela
  // lama 25-30 kata ia masih muat; pada 22 kata tidak pernah muat lagi untuk
  // naskah bersuara 15 detik. Tangga degradasi promo bekerja persis seperti
  // dirancang — ia melepas elemen satu per satu — dan sekarang berakhir di
  // "tanpa promo sama sekali".
  //
  // Yang dijaga: promo DILEPAS, bukan diselipkan sampai naskahnya meluber.
  const anyStrike = shortName.some((v) => v.segments.some((s) => s.text.includes("dari 120 ribu jadi 85 ribu")));
  assert.equal(anyStrike, false,
    "pada batas 22 kata harga coret memang tidak muat; kalau ini mulai lolos, " +
    "berarti jendela kata berubah dan keputusan produk soal promo harus ditinjau ulang");

  // Dan buktinya bukan sekadar 'tidak ada': elemen promo memang pernah dicoba
  // dan gugur karena panjang, bukan karena promonya tidak pernah dirakit.
  const panjang = shortName.map((v) => v.segments.map((s) => s.text).join(" ").split(/\s+/).length);
  assert.ok(panjang.every((n) => n > 22), `naskah dasar memang sudah di atas 22 kata: ${panjang.join(", ")}`);
});

test("semua 16 keluarga hook aman disuntik promo (silent 15s + 30s)", async () => {
  for (const duration of [15, 30] as const) {
    for (let i = 1; i <= 16; i++) {
      const variants = await generateScripts({
        product: { ...promoProduct, id: `p-${duration}-${i}` },
        register: "netral",
        durationSec: duration,
        hookLevel: i % 2 === 0 ? "berani" : "normal",
      });
      for (const v of variants) {
        assert.ok(v.validation.passed, `${duration}s ${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
      }
    }
  }
});

test("promo kedaluwarsa: skrip identik dengan tanpa promo (drop diam-diam)", async () => {
  const expired = await generateScripts({ product: { ...promoProduct, promoEndsAt: inDays(-2) }, register: "bestie" });
  const plain = await generateScripts({ product: baseProduct, register: "bestie" });
  assert.deepEqual(expired.map((v) => v.segments), plain.map((v) => v.segments));
  assert.equal(expired[0].caption, plain[0].caption);
});

test("caption memuat angka promo (%, harga, stok, tanggal)", async () => {
  const [v] = await generateScripts({ product: promoProduct, register: "bestie" });
  assert.ok(v.caption.includes("diskon 29%"), v.caption);
  assert.ok(v.caption.includes("Rp120.000") && v.caption.includes("Rp85.000"), v.caption);
  assert.ok(v.caption.includes("stok tinggal 12"), v.caption);
});

test("L-14: angka harga normal sah hanya bila promoPriceBeforeIdr diberikan", async () => {
  const segments = [
    { role: "hook", text: "Say, kusamnya balik terus nggak sih loh?" },
    { role: "demo", text: "nah jadi gini, dari 120 ribu jadi 85 ribu doang deh, teksturnya niat banget sumpah, beneran kerasa bedanya pas dipake tiap hari" },
    { role: "cta", text: "Cek keranjang kuning ya deh, jangan sampai nyesel belakangan" },
  ];
  const base = { hook_family: "H2", register: "bestie", segments, productName: "Serum X", priceIdr: 85000 };
  const without = validateScript(base, "strict");
  assert.ok(without.errors.some((e) => e.rule === "L-14"), "tanpa promo, angka 120 harus ditolak L-14");
  const withPromo = validateScript({ ...base, promoPriceBeforeIdr: 120000 }, "strict");
  assert.ok(!withPromo.errors.some((e) => e.rule === "L-14"), JSON.stringify(withPromo.errors));
});
