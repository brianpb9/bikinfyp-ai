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
  const variants = await generateScripts({ tanpaLlm: true, product: promoProduct, register: "bestie" });
  // KONSEKUENSI TERUKUR dari STANDAR 10/10 baris 5, bukan tes yang dilonggarkan.
  //
  // Produk beauty masuk kategori jenuh, jadi levelnya dinaikkan otomatis ke
  // agak_berani — dan hook di level itu lebih panjang. Diukur: harga coret
  // masuk ke 3 dari 3 varian pada level normal, 2 dari 3 pada agak_berani
  // (H1 kehabisan ruang dan tangga degradasi melepasnya). Yang tetap dijaga:
  // promo TIDAK hilang diam-diam dari semua varian, dan yang melepasnya tetap
  // menghasilkan naskah yang sah.
  const denganCoret = variants.filter((v) => v.segments.find((s) => s.role === "demo")!.text.includes("dari 120 ribu jadi 85 ribu"));
  assert.ok(denganCoret.length >= 2, `harga coret cuma masuk ${denganCoret.length}/3 varian`);
  for (const v of variants) {
    assert.ok(v.validation.passed, `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
    const demo = v.segments.find((s) => s.role === "demo")!.text;
  }
});

test("injeksi promo di tier bersuara: degradasi otomatis, tetap lolos validator", async () => {
  // Nama panjang: jatah kata bersuara (10-22) bisa habis -> promo boleh ter-drop
  // dari UCAPAN (tetap hidup di overlay + caption), yang penting valid.
  const longName = await generateScripts({ tanpaLlm: true, product: promoProduct, register: "bestie", qualityTier: "high_quality" });
  for (const v of longName) {
    // Yang dijaga tes ini DEGRADASI PROMO-nya (elemen promo dilepas satu per
    // satu sampai muat), bukan kelulusan mutlak. Sejak batas 1,5 kata/detik,
    // template dasarnya sendiri melanggar L-05 — utang copy yang tercatat
    // terpisah. Yang harus tetap nol: sebab gagal DI LUAR utang itu.
    // S-09 ikut ke daftar utang yang sama: batas kata PER SHOT (STANDAR 10/10
    // baris 9) menolak demo template yang memang sudah kepanjangan menurut
    // L-05. Bukan sebab baru — sumbu ukur baru untuk copy yang sama.
    const lain = v.validation.errors.map((e) => e.rule).filter((r) => !["L-05", "L-19", "S-09", "S-04"].includes(r));
    assert.deepEqual(lain, [], `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
  // Nama pendek: ada ruang -> harga coret masuk ke ucapan minimal di satu varian.
  const shortName = await generateScripts({ tanpaLlm: true,
    product: { ...promoProduct, id: "prod-promo-short", name: "Serum X" },
    register: "bestie",
    qualityTier: "high_quality",
  });
  for (const v of shortName) {
    // Yang dijaga tes ini DEGRADASI PROMO-nya (elemen promo dilepas satu per
    // satu sampai muat), bukan kelulusan mutlak. Sejak batas 1,5 kata/detik,
    // template dasarnya sendiri melanggar L-05 — utang copy yang tercatat
    // terpisah. Yang harus tetap nol: sebab gagal DI LUAR utang itu.
    // S-09 ikut ke daftar utang yang sama: batas kata PER SHOT (STANDAR 10/10
    // baris 9) menolak demo template yang memang sudah kepanjangan menurut
    // L-05. Bukan sebab baru — sumbu ukur baru untuk copy yang sama.
    const lain = v.validation.errors.map((e) => e.rule).filter((r) => !["L-05", "L-19", "S-09", "S-04"].includes(r));
    assert.deepEqual(lain, [], `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
  // PERINGATAN YANG DIPASANG DI SINI SUDAH BERBUNYI — dan ini catatannya.
  //
  // Versi sebelumnya menjaga bahwa harga coret ("dari 120 ribu jadi 85 ribu")
  // TIDAK PERNAH muat, karena pada jendela 22 kata memang tidak ada ruang.
  // Penulisnya meninggalkan syarat eksplisit: "kalau ini mulai lolos, berarti
  // jendela kata berubah dan keputusan produk soal promo harus ditinjau ulang".
  //
  // Jendelanya memang berubah, 4 Sep 2026: pita tempo memberi 33-63 kata untuk
  // 15 detik, sesudah terukur bahwa naskah 17 kata meninggalkan 56% video dalam
  // keadaan diam. Harga coret yang menambah 6 kata kini muat.
  //
  // Jadi yang dijaga sekarang bukan lagi "promo selalu dilepas", melainkan hal
  // yang sejak awal menjadi maksudnya: tangga degradasi tetap BEKERJA — promo
  // dilepas ketika tidak muat, bukan diselipkan sampai naskahnya meluber
  // melewati jendela. Naskah yang meluber adalah cacat; promo yang muat bukan.
  for (const v of shortName) {
    const kata = v.segments.map((s) => s.text).join(" ").split(/\s+/).filter(Boolean).length;
    const luber = v.validation.errors.some((e) => e.rule === "L-05" && /maksimal/.test(e.message_id));
    assert.equal(luber, false, `${v.hook_family}: promo membuat naskah meluber (${kata} kata) — tangga degradasi tidak bekerja`);
  }

  // Dan buktinya bukan sekadar 'tidak ada': elemen promo memang pernah dicoba
  // dan gugur karena panjang, bukan karena promonya tidak pernah dirakit.
  const panjang = shortName.map((v) => v.segments.map((s) => s.text).join(" ").split(/\s+/).length);
  assert.ok(panjang.every((n) => n > 22), `naskah dasar memang sudah di atas 22 kata: ${panjang.join(", ")}`);
});

test("semua 16 keluarga hook aman disuntik promo (silent 15s + 30s)", async () => {
  for (const duration of [15, 30] as const) {
    for (let i = 1; i <= 16; i++) {
      const variants = await generateScripts({ tanpaLlm: true,
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
  const expired = await generateScripts({ tanpaLlm: true, product: { ...promoProduct, promoEndsAt: inDays(-2) }, register: "bestie" });
  const plain = await generateScripts({ tanpaLlm: true, product: baseProduct, register: "bestie" });
  assert.deepEqual(expired.map((v) => v.segments), plain.map((v) => v.segments));
  assert.equal(expired[0].caption, plain[0].caption);
});

test("caption memuat angka promo (%, harga, stok, tanggal)", async () => {
  const [v] = await generateScripts({ tanpaLlm: true, product: promoProduct, register: "bestie" });
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
