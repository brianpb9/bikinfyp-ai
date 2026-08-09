// Unit test validator L-01..L-16 (FSD F-02.3).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-validator-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-validator-storage-${process.pid}`;

const { validateScript } = await import("../lib/script-engine/validator");

const base = {
  hook_family: "H1",
  register: "bestie",
  segments: [
    { role: "hook", text: "Say, masa 85 ribu dapet kualitas kayak gini sih? aku ngecek ulang loh" },
    { role: "demo", text: "nah jadi gini, ini Serum Glow Bright. pas aku pegang langsung kerasa sih bedanya, teksturnya tuh niat banget, padahal harganya cuma 85 ribu" },
    { role: "cta", text: "Aku taruh linknya di keranjang kuning ya, tinggal CO aja deh" },
  ],
  productName: "Serum Glow Bright",
  priceIdr: 85000,
};

function rules(res: { errors: { rule: string }[] }): string[] {
  return res.errors.map((e) => e.rule);
}
function withSeg(idx: number, text: string) {
  return { ...base, segments: base.segments.map((s, i) => (i === idx ? { ...s, text } : s)) };
}

test("skrip valid lolos semua aturan", () => {
  const res = validateScript(base, "strict");
  assert.deepEqual(res.errors, [], JSON.stringify(res.errors));
  assert.equal(res.passed, true);
});

test("L-01: kurang dari 2 partikel -> gagal", () => {
  const res = validateScript(
    {
      ...base,
      segments: [
        { role: "hook", text: "85 ribu dapet kualitas segini aku kaget banget" },
        { role: "demo", text: "jadi gini, ini Serum Glow Bright bagus, teksturnya niat, harganya cuma 85 ribu padahal kualitasnya oke banget buat harian" },
        { role: "cta", text: "Aku taruh linknya di keranjang kuning, tinggal CO" },
      ],
    },
    "strict"
  );
  assert.ok(rules(res).includes("L-01"));
});

test("L-02: tanpa harga eksplisit di hook/demo -> gagal", () => {
  const tanpaHarga = withSeg(1, "nah jadi gini, ini Serum Glow Bright. teksturnya tuh niat banget, beneran bagus sih buat harian, aku suka banget pokoknya deh");
  tanpaHarga.segments[0] = { ...tanpaHarga.segments[0], text: "Say, kualitas segini kok bisa sih? aku ngecek ulang loh" };
  const res = validateScript(tanpaHarga, "strict");
  assert.ok(rules(res).includes("L-02"));
});

test("L-03: CTA tanpa 'keranjang kuning' -> gagal", () => {
  const res = validateScript(withSeg(2, "Aku taruh linknya di bio ya, tinggal klik deh"), "strict");
  assert.ok(rules(res).includes("L-03"));
});

test("L-04: tanpa filler lisan -> gagal", () => {
  const res = validateScript(
    {
      ...base,
      segments: [
        { role: "hook", text: "Say, 85 ribu dapet kualitas segini sih? aku kaget loh" },
        { role: "demo", text: "ini Serum Glow Bright, pas aku pegang kerasa sih bedanya, teksturnya tuh niat banget, padahal harganya cuma 85 ribu" },
        { role: "cta", text: "Aku taruh linknya di keranjang kuning ya, tinggal CO deh" },
      ],
    },
    "strict"
  );
  assert.ok(rules(res).includes("L-04"));
});

test("L-05: terlalu pendek dan terlalu panjang -> gagal", () => {
  const pendek = validateScript(
    {
      ...base,
      segments: [
        { role: "hook", text: "Say, 85 ribu sih" },
        { role: "demo", text: "ini Serum Glow Bright bagus" },
        { role: "cta", text: "cek keranjang kuning ya" },
      ],
    },
    "strict"
  );
  assert.ok(rules(pendek).includes("L-05"));

  const panjang = validateScript(
    withSeg(1, Array(4).fill(base.segments[1].text).join(" ")),
    "strict"
  );
  assert.ok(rules(panjang).includes("L-05"));
});

test("L-06: produk disebut di hook -> gagal, kecuali H4/H11", () => {
  const hookProduk = withSeg(0, "Say, Serum Glow Bright cuma 85 ribu sih, aku kaget loh");
  const res = validateScript(hookProduk, "strict");
  assert.ok(rules(res).includes("L-06"));

  const h4 = validateScript({ ...hookProduk, hook_family: "H4" }, "strict");
  assert.ok(!rules(h4).includes("L-06"));

  const h11 = validateScript({ ...hookProduk, hook_family: "H11" }, "strict");
  assert.ok(!rules(h11).includes("L-06"));
});

test("L-10: overclaim -> gagal keras di strict DAN light", () => {
  const s = withSeg(1, base.segments[1].text + ", dijamin bagus");
  assert.ok(rules(validateScript(s, "strict")).includes("L-10"));
  assert.ok(rules(validateScript(s, "light")).includes("L-10"));
  assert.equal(validateScript(s, "light").passed, false);

  const s2 = withSeg(0, "Say, ini 100% paling bagus, 85 ribu sih loh");
  assert.ok(rules(validateScript(s2, "strict")).includes("L-10"));
});

test("L-11: klaim medis -> gagal keras di strict DAN light", () => {
  const s = withSeg(1, base.segments[1].text + ", bisa menyembuhkan jerawat");
  assert.ok(rules(validateScript(s, "strict")).includes("L-11"));
  assert.equal(validateScript(s, "light").passed, false);
});

test("L-12: bahasa iklan formal -> gagal (strict), warning (light)", () => {
  const s = withSeg(2, "Dapatkan produk ini sekarang juga di keranjang kuning ya deh");
  assert.ok(rules(validateScript(s, "strict")).includes("L-12"));
  const light = validateScript(s, "light");
  assert.equal(light.passed, true); // L-12 bukan aturan keras saat edit user
  assert.ok(light.warnings.some((w) => w.rule === "L-12"));
});

test("L-13: urgensi palsu -> gagal", () => {
  const s = withSeg(2, "Stok terakhir, buruan cek keranjang kuning ya deh");
  assert.ok(rules(validateScript(s, "strict")).includes("L-13"));
});

test("L-14: angka yang tidak ada di data produk -> gagal", () => {
  const s = withSeg(1, base.segments[1].text + ", diskon 50 persen");
  assert.ok(rules(validateScript(s, "strict")).includes("L-14"));
});

test("L-15: merek pesaing direndahkan -> gagal; disebut netral -> warning", () => {
  const s = withSeg(1, base.segments[1].text + ", wardah mah jelek");
  assert.ok(rules(validateScript(s, "strict")).includes("L-15"));

  const netral = withSeg(1, base.segments[1].text + ", kayak wardah gitu");
  const res = validateScript(netral, "strict");
  assert.ok(!rules(res).includes("L-15"));
  assert.ok(res.warnings.some((w) => w.rule === "L-15"));
});

test("L-16: campur gue/aku -> gagal; register lock", () => {
  const campur = withSeg(0, "Say, masa 85 ribu dapet kualitas kayak gini sih? gue ngecek ulang loh");
  assert.ok(rules(validateScript(campur, "strict")).includes("L-16"));

  // register genz tapi pakai aku
  const genzSalah = validateScript({ ...base, register: "genz" }, "strict");
  assert.ok(rules(genzSalah).includes("L-16"));

  // register bunda tapi pakai gue
  const bundaGue = validateScript(
    { ...campur, register: "bunda", segments: campur.segments.map((s) => ({ ...s, text: s.text.replace(/\baku\b/g, "gue") })) },
    "strict"
  );
  assert.ok(rules(bundaGue).includes("L-16"));
});

test("mode light: pelanggaran non-L-10/L-11 hanya jadi warning", () => {
  const tanpaPartikel = {
    ...base,
    segments: [
      { role: "hook", text: "85 ribu dapet kualitas segini aku kaget banget" },
      { role: "demo", text: "jadi gini, ini Serum Glow Bright bagus, teksturnya niat, harganya cuma 85 ribu padahal kualitas oke buat harian" },
      { role: "cta", text: "Aku taruh linknya di keranjang kuning, tinggal CO" },
    ],
  };
  const res = validateScript(tanpaPartikel, "light");
  assert.equal(res.passed, true);
  assert.ok(res.warnings.length > 0);
});

test("L-05 tier bersuara: maks ~30 kata (r19, Gemini TTS ~1.93 kata/dtk); skrip 47 kata ditolak", () => {
  const audioTier = { ...base, qualityTier: "high_quality" as const };
  const res = validateScript(audioTier, "strict");
  assert.ok(rules(res).includes("L-05"));

  const pendek = {
    ...base,
    qualityTier: "super_hq" as const,
    segments: [
      { role: "hook", text: "Say, 85 ribu dapet kualitas segini? sumpah sih" },
      { role: "demo", text: "nah, ini Serum Glow Bright, teksturnya niat banget, beneran kerasa bedanya pas dipake" },
      { role: "cta", text: "Cek keranjang kuning ya deh, jangan sampai nyesel" },
    ],
  };
  const res2 = validateScript(pendek, "strict");
  assert.deepEqual(res2.errors, [], JSON.stringify(res2.errors));
});

test("L-17: tanda kurung instruksi ditolak untuk tier bersuara, diizinkan untuk silent", () => {
  const denganKurung = {
    ...base,
    qualityTier: "high_quality" as const,
    segments: [
      { role: "hook", text: "Say, 85 ribu segini? sumpah sih" },
      { role: "demo", text: "nah, ini Serum Glow Bright (jeda sebentar) teksturnya niat" },
      { role: "cta", text: "Cek keranjang kuning ya deh" },
    ],
  };
  assert.ok(rules(validateScript(denganKurung, "strict")).includes("L-17"));
  const silent = { ...denganKurung, qualityTier: "silent_caption" as const };
  assert.ok(!rules(validateScript(silent, "strict")).includes("L-17"));
});
