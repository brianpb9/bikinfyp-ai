// Unit test mesin skrip (FSD F-02 kriteria uji):
// - 3 varian selalu beda keluarga hook
// - >=95% lolos validator (di sini: 100% untuk produk uji)
// - 0% kata terlarang di 100 generate
// - register bunda tidak pernah mengandung gue/lo; genz tidak pernah aku/kamu

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-engine-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-engine-storage-${process.pid}`;

const { generateScripts } = await import("../lib/script-engine");
const { validateScript } = await import("../lib/script-engine/validator");

const product = { id: "prod-test-1", name: "Serum Glow Bright", price_idr: 85000, category: "beauty" };

const FORBIDDEN = /\b(pasti|dijamin|terbaik|menyembuhkan|obat|penyakit)\b|100%|nomor 1/i;

test("3 varian beda keluarga hook dan semua lolos validator strict", () => {
  const variants = generateScripts({ product, register: "bestie" });
  assert.equal(variants.length, 3);
  const families = variants.map((v) => v.hook_family);
  assert.equal(new Set(families).size, 3, `keluarga hook harus beda: ${families}`);
  for (const v of variants) {
    assert.equal(v.validation.passed, true, `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
  }
});

test("100 generate: 100% lolos validator, 0% kata terlarang", () => {
  const regs = ["bunda", "bestie", "genz", "netral"] as const;
  for (let i = 0; i < 100; i++) {
    const register = regs[i % 4];
    const variants = generateScripts({ product, register });
    for (const v of variants) {
      const full = v.segments.map((s) => s.text).join(" ");
      assert.equal(v.validation.passed, true, `iterasi ${i} ${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
      assert.ok(!FORBIDDEN.test(full), `kata terlarang di: ${full}`);
    }
  }
});

test("register bunda tidak pernah mengandung gue/lo; genz tidak aku/kamu", () => {
  for (const v of generateScripts({ product, register: "bunda" })) {
    const full = v.segments.map((s) => s.text).join(" ").toLowerCase();
    assert.ok(!/\b(gue|gua|gw|lo|lu|elu)\b/.test(full), `bunda bocor gue/lo: ${full}`);
  }
  for (const v of generateScripts({ product, register: "genz" })) {
    const full = v.segments.map((s) => s.text).join(" ").toLowerCase();
    assert.ok(!/\b(aku|kamu|kau|anda)\b/.test(full), `genz bocor aku/kamu: ${full}`);
  }
});

test("struktur segmen 0-3/3-10/10-15 dan caption+hashtag sesuai kontrak", () => {
  const [v] = generateScripts({ product, register: "netral" });
  assert.deepEqual(
    v.segments.map((s) => [s.role, s.start, s.end]),
    [["hook", 0, 3], ["demo", 3, 10], ["cta", 10, 15]]
  );
  // Tanpa sourceUrl diketahui (mis. input manual) -> istilah generik, bukan
  // klaim TikTok yang belum tentu benar (keputusan Brian 2026-08-03).
  assert.ok(v.caption.toLowerCase().includes("keranjang"));
  assert.ok(!v.caption.toLowerCase().includes("keranjang kuning"));
  assert.ok(v.hashtags.length >= 8 && v.hashtags.length <= 12);
  assert.ok(v.hashtags.includes("#racuntiktok"));
});

test("CTA 'keranjang kuning' cuma untuk link TikTok; Shopee/tanpa sumber pakai 'keranjang' polos", () => {
  const tiktokProduct = { ...product, sourceUrl: "https://vt.tiktok.com/abc123" };
  const [tiktokVariant] = generateScripts({ product: tiktokProduct, register: "netral" });
  const tiktokCta = tiktokVariant.segments.find((s) => s.role === "cta")!.text.toLowerCase();
  assert.ok(tiktokCta.includes("keranjang kuning"), `TikTok CTA harusnya 'keranjang kuning': ${tiktokCta}`);

  const shopeeProduct = { ...product, sourceUrl: "https://shopee.co.id/produk-123" };
  const [shopeeVariant] = generateScripts({ product: shopeeProduct, register: "netral" });
  const shopeeCta = shopeeVariant.segments.find((s) => s.role === "cta")!.text.toLowerCase();
  assert.ok(shopeeCta.includes("keranjang"), `Shopee CTA harusnya sebut 'keranjang': ${shopeeCta}`);
  assert.ok(!shopeeCta.includes("keranjang kuning"), `Shopee CTA gak boleh 'keranjang kuning': ${shopeeCta}`);
});

test("harga muncul eksplisit di hook atau demo untuk berbagai nominal", () => {
  for (const price of [5000, 25000, 85000, 250000, 1500000]) {
    const p = { ...product, price_idr: price };
    for (const v of generateScripts({ product: p, register: "bestie" })) {
      const res = validateScript(
        { hook_family: v.hook_family, register: "bestie", segments: v.segments, productName: p.name, priceIdr: price },
        "strict"
      );
      assert.equal(res.passed, true, `harga ${price}: ${JSON.stringify(res.errors)}`);
    }
  }
});

test("tier bersuara: skrip kompak 25-30 kata (r19), tanpa tanda kurung, lolos validator", () => {
  const variants = generateScripts({ product, register: "bestie", qualityTier: "high_quality" });
  assert.equal(variants.length, 3);
  for (const v of variants) {
    assert.equal(v.validation.passed, true, `${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
    const full = v.segments.map((s) => s.text).join(" ");
    const wc = full.split(/\s+/).filter(Boolean).length;
    assert.ok(wc >= 25 && wc <= 30, `${v.hook_family}: ${wc} kata`);
    assert.ok(!/[()]/.test(full), `${v.hook_family}: ada tanda kurung`);
    assert.equal(v.quality_tier, "high_quality");
  }
});

test("durasi 30 dtk: timing segmen skala 2x, demo diperpanjang, lolos validator (v1, 2026-08-03)", () => {
  for (const qualityTier of ["silent_caption", "high_quality"] as const) {
    const variants = generateScripts({ product, register: "bestie", qualityTier, durationSec: 30 });
    assert.equal(variants.length, 3);
    for (const v of variants) {
      assert.deepEqual(
        v.segments.map((s) => [s.role, s.start, s.end]),
        [["hook", 0, 6], ["demo", 6, 20], ["cta", 20, 30]],
        `${qualityTier}/${v.hook_family}: timing tidak skala 2x dari basis 15 dtk`
      );
      assert.equal(v.validation.passed, true, `${qualityTier}/${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
    }
    // Demo 30 dtk harus lebih panjang dari demo 15 dtk (kalimat lanjutan ditambahkan,
    // bukan cuma diregangkan diam-diam menjadi jeda kosong).
    const [v30] = variants;
    const [v15] = generateScripts({ product, register: "bestie", qualityTier });
    const demo30 = v30.segments.find((s) => s.role === "demo")!.text;
    const demo15 = v15.segments.find((s) => s.role === "demo")!.text;
    assert.ok(demo30.length > demo15.length, `${qualityTier}: demo 30 dtk (${demo30}) tidak lebih panjang dari demo 15 dtk (${demo15})`);
  }
});

test("durasi 45 dtk: timing segmen skala 3x, demo diperpanjang, lolos validator (v1.3, 2026-08-04)", () => {
  for (const qualityTier of ["silent_caption", "high_quality"] as const) {
    const variants = generateScripts({ product, register: "bestie", qualityTier, durationSec: 45 });
    assert.equal(variants.length, 3);
    for (const v of variants) {
      assert.deepEqual(
        v.segments.map((s) => [s.role, s.start, s.end]),
        [["hook", 0, 9], ["demo", 9, 30], ["cta", 30, 45]],
        `${qualityTier}/${v.hook_family}: timing tidak skala 3x dari basis 15 dtk`
      );
      assert.equal(v.validation.passed, true, `${qualityTier}/${v.hook_family}: ${JSON.stringify(v.validation.errors)}`);
    }
    // Demo 45 dtk harus lebih panjang dari demo 30 dtk (bukan cuma 30 dtk yang
    // diperpanjang, makin lama durasinya makin banyak juga kalimat lanjutannya).
    const [v45] = variants;
    const [v30] = generateScripts({ product, register: "bestie", qualityTier, durationSec: 30 });
    const demo45 = v45.segments.find((s) => s.role === "demo")!.text;
    const demo30 = v30.segments.find((s) => s.role === "demo")!.text;
    assert.ok(demo45.length > demo30.length, `${qualityTier}: demo 45 dtk (${demo45}) tidak lebih panjang dari demo 30 dtk (${demo30})`);
  }
});
