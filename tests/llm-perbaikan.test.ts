// Naskah LLM yang ditolak validator harus DIPERBAIKI dengan keluhan aslinya,
// lalu jatuh ke template kalau tetap gagal — tidak pernah dikirim diam-diam.
//
// Cacat aslinya (suite 17 Agu, dua tes gagal): prompt LLM tidak pernah menyebut
// jendela kata sebenarnya (25-30 kata / 15 dtk), kewajiban jeda lisan, atau
// aturan kata ganti per register. LLM dinilai dengan aturan yang tidak pernah
// diberikan kepadanya, lalu naskahnya sampai ke pengguna dengan
// validation.passed=false — keadaan yang ditolak gerbang konfirmasi
// (render-cell.ts) dan rute approve, jadi pengguna terjebak tanpa tahu sebabnya.
//
// "Regenerate" yang lama tidak akan pernah menolongnya: normalizeSegments cuma
// merapikan spasi.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-llmfix-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-llmfix-storage-${process.pid}`;
process.env.SCRIPT_LLM = "1";
process.env.ANTHROPIC_API_KEY = "kunci-uji";

const { blokAturan, tulisNaskah, llmSiap } = await import("../lib/script-engine/llm");
const { jendelaKata } = await import("../lib/script-engine/validator");

const aslinya = globalThis.fetch;

/** Balas seolah-olah Anthropic, sambil merekam prompt yang dikirim. */
function stub(segments: unknown[]) {
  const dikirim: string[] = [];
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as {
      system: { text: string }[];
      messages: { content: string }[];
    };
    dikirim.push(`${body.system.map((s) => s.text).join("\n")}\n${body.messages[0].content}`);
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }),
    };
  }) as never;
  return dikirim;
}

// DIPANJANGKAN 4 Sep 2026 ke dalam pita tempo (33-63 kata untuk 15 detik).
// Fixture lama 17 kata mewakili naskah yang lolos gate lama tapi terukur
// meninggalkan 56% video dalam keadaan diam.
const segmenSah = [
  { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, kulitku dulu gitu juga sih, kusam banget tiap bangun pagi",
    start_state: "she is already touching her cheek", framing: "medium", angle: "eye level",
    camera: "static", action: "she leans in, then points", product_state: "hidden",
    expression: "worried", audio_note: "", why: "setup — names the pain", mode: "SELFIE" },
  { block: "BODY", label: "DEMO", start: 4, end: 10, text: "terus aku pakai ini tiap malam, teksturnya ringan dan cepat meresap, nggak bikin lengket",
    start_state: "the bottle is already in her hand", framing: "medium", angle: "eye level",
    camera: "push in", action: "she turns it, then tilts the label", product_state: "partial",
    expression: "warm", audio_note: "", why: "tension — shows the fix", mode: "SELLING" },
  { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "cek keranjang ya",
    start_state: "the bottle is already raised", framing: "tight", angle: "eye level",
    camera: "static", action: "she holds steady, then points down", product_state: "hero",
    expression: "bright", audio_note: "", why: "payoff — label readable", mode: "SELLING" },
];

test("llmSiap benar saat kunci ada dan SCRIPT_LLM tidak dimatikan", () => {
  assert.equal(llmSiap(), true);
});

test("prompt menyebut jendela kata, jeda lisan, dan kata ganti register", async () => {
  const dikirim = stub(segmenSah);
  try {
    const { minWc, maxWc } = jendelaKata({
      qualityTier: "high_quality", durationSec: 15, productName: "Scarlett Acne Serum",
    });
    await tulisNaskah({
      productName: "Scarlett Acne Serum", productCategory: "beauty", priceIdr: 75000,
      durationSec: 15, contentType: "affiliate", cartLabel: "keranjang kuning",
      register: "bestie", hookFamily: "H1", hookLevel: "normal", format: "talking_head",
      wordMin: minWc, wordMax: maxWc,
    });
    const p = dikirim[0];
    // L-05: angkanya harus angka VALIDATOR, bukan angka karangan prompt.
    assert.ok(p.includes(`no fewer than ${minWc}`), `batas bawah tidak dikirim:\n${p}`);
    assert.ok(p.includes(`no more than ${maxWc}`), `batas atas tidak dikirim:\n${p}`);
    // SASARAN, bukan cuma batas — diberi jendela saja, model konsisten meleset
    // ke atas (terukur 31/33/34/36 kata pada jendela 22-30, 17 Agu).
    const sasaran = Math.max(minWc, Math.round((minWc + maxWc) / 2) - 1);
    assert.ok(p.includes(`about ${sasaran} spoken words`), `sasaran tidak dikirim:\n${p}`);
    assert.ok(sasaran > minWc && sasaran < maxWc, "sasaran harus di DALAM jendela");
    assert.ok(!/1\.5 x total seconds/.test(p), "batas lama yang bertentangan masih ada");
    // L-04.
    assert.match(p, /SPOKEN FILLER/);
    assert.match(p, /"nah"/);
    // L-16: register bestie = aku/kamu.
    assert.match(p, /PRONOUNS .* uses aku/);
  } finally {
    globalThis.fetch = aslinya;
  }
});

test("register genz mendapat aturan kata ganti yang berlawanan", async () => {
  const dikirim = stub(segmenSah);
  try {
    await tulisNaskah({
      productName: "X", productCategory: "beauty", priceIdr: 1000, durationSec: 15,
      contentType: "affiliate", cartLabel: "keranjang", register: "genz",
      hookFamily: "H1", hookLevel: "normal", format: "talking_head", wordMin: 25, wordMax: 30,
    });
    assert.match(dikirim[0], /PRONOUNS .* uses gue/);
  } finally {
    globalThis.fetch = aslinya;
  }
});

test("keluhan validator dikirim balik apa adanya sebagai PERBAIKAN", async () => {
  const dikirim = stub(segmenSah);
  try {
    await tulisNaskah({
      productName: "X", productCategory: "beauty", priceIdr: 1000, durationSec: 15,
      contentType: "affiliate", cartLabel: "keranjang", register: "bestie",
      hookFamily: "H1", hookLevel: "normal", format: "talking_head", wordMin: 25, wordMax: 30,
      keluhan: ["Panjang skrip 26 kata — untuk video 15 detik harus 29–48 kata."],
    });
    const p = dikirim[0];
    assert.match(p, /THIS IS A REPAIR/);
    // Keluhannya harus utuh: LLM tidak bisa memperbaiki apa yang tidak diberi tahu.
    assert.ok(p.includes("Panjang skrip 26 kata"), "keluhan validator tidak diteruskan");
  } finally {
    globalThis.fetch = aslinya;
  }
});

test("blokAturan tidak lagi memuat batas kata yang bertentangan", () => {
  // Batas kata bergantung tier/durasi/nama produk, jadi ia TIDAK boleh ada di
  // blok statis yang di-cache — di situ ia pasti salah untuk sebagian job.
  assert.ok(!/1\.5 x total seconds/.test(blokAturan()));
  assert.ok(!/Per segment <= 10 words/.test(blokAturan()));
});

test("JSON diambil sebagai objek seimbang, bukan cuma dibuang pagarnya", async () => {
  const { ambilObjekJson } = await import("../lib/script-engine/llm");
  // Kasus nyata 17 Agu: model menempelkan teks SESUDAH objek JSON yang benar.
  assert.equal(ambilObjekJson('{"a":1}\nCatatan tambahan di luar JSON.'), '{"a":1}');
  assert.equal(ambilObjekJson('```json\n{"a":1}\n```'), '{"a":1}');
  // Kurung di dalam dialog tidak boleh memotong objeknya.
  assert.equal(ambilObjekJson('{"text":"harga {promo} nih"} lalu apa'), '{"text":"harga {promo} nih"}');
  // Tanda kutip yang di-escape juga tidak boleh menutup string terlalu cepat.
  assert.equal(ambilObjekJson('{"t":"dia bilang \\"halo\\" gitu"} sisa'), '{"t":"dia bilang \\"halo\\" gitu"}');
  // Prosa sebelum objeknya ikut dilewati.
  assert.equal(ambilObjekJson('Here you go:\n{"a":2}'), '{"a":2}');
});

test("aturan partikel (L-01) ikut ke prompt — sebelumnya terlewat", async () => {
  const { PARTICLES } = await import("../lib/script-engine/validator");
  const dikirim = stub(segmenSah);
  try {
    await tulisNaskah({
      productName: "X", productCategory: "beauty", priceIdr: 1000, durationSec: 15,
      contentType: "affiliate", cartLabel: "keranjang", register: "bestie",
      hookFamily: "H1", hookLevel: "normal", format: "hands_only", wordMin: 22, wordMax: 30,
    });
    const p = dikirim[0];
    assert.match(p, /PARTICLES — at least TWO/);
    // Daftarnya harus daftar VALIDATOR, bukan salinan yang bisa hanyut.
    for (const t of PARTICLES) assert.ok(p.includes(`"${t}"`), `partikel "${t}" tidak ikut`);
  } finally { globalThis.fetch = aslinya; }
});

test("saat memperbaiki PANJANG, sasarannya turun ke dekat batas bawah", async () => {
  // Model memangkas tapi kurang jauh: 34 lalu 32 kata untuk batas 30 (17 Agu).
  // Batasnya tidak diubah; sasarannya digeser supaya lesetnya mendarat di dalam.
  const biasa = stub(segmenSah);
  try {
    await tulisNaskah({
      productName: "X", productCategory: "beauty", priceIdr: 1000, durationSec: 15,
      contentType: "affiliate", cartLabel: "keranjang", register: "bestie",
      hookFamily: "H1", hookLevel: "normal", format: "hands_only", wordMin: 22, wordMax: 30,
    });
    assert.ok(biasa[0].includes("about 25 spoken words"), biasa[0].slice(0, 400));
  } finally { globalThis.fetch = aslinya; }

  const perbaikan = stub(segmenSah);
  try {
    await tulisNaskah({
      productName: "X", productCategory: "beauty", priceIdr: 1000, durationSec: 15,
      contentType: "affiliate", cartLabel: "keranjang", register: "bestie",
      hookFamily: "H1", hookLevel: "normal", format: "hands_only", wordMin: 22, wordMax: 30,
      keluhan: ["Panjang skrip 34 kata — untuk video bersuara 15 detik maksimal ~30 kata (22–30)."],
    });
    assert.ok(perbaikan[0].includes("about 24 spoken words"), perbaikan[0].slice(0, 400));
    // Batas kerasnya TIDAK ikut turun.
    assert.ok(perbaikan[0].includes("no more than 30"));
  } finally { globalThis.fetch = aslinya; }
});

test("keberhasilan jalur LLM meninggalkan baris log POSITIF", async () => {
  // "Tidak ada JATUH KE TEMPLATE" bukan bukti kalau tidak ada permintaan sama
  // sekali. Verifikasi produksi butuh sesuatu yang MUNCUL saat berhasil.
  const { generateScripts } = await import("../lib/script-engine");
  const baris: string[] = [];
  const logAsli = console.log;
  console.log = (...a: unknown[]) => { baris.push(a.join(" ")); };
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: [
      { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, jerawat aku dulu bandel banget sih, tiap bangun tidur muncul lagi",
        start_state: "dia sudah memegang pipinya", framing: "medium", angle: "eye level", camera: "static",
        action: "dia mendekat, lalu menunjuk", product_state: "hidden", expression: "worried",
        audio_note: "", why: "setup", mode: "SELFIE" },
      { block: "BODY", label: "DEMO", start: 4, end: 10,
        text: "terus aku pakai serum ini tiap malam deh, teksturnya ringan banget dan cepat meresap",
        start_state: "botolnya sudah di tangan", framing: "medium", angle: "eye level", camera: "push in",
        action: "dia memutar botol, lalu memiringkan label", product_state: "partial", expression: "warm",
        audio_note: "", why: "tension", mode: "SELLING" },
      { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "jadi kalau kamu mau coba juga, cek keranjang kuning ya",
        start_state: "botolnya sudah terangkat", framing: "tight", angle: "eye level", camera: "static",
        action: "dia menahannya diam, lalu menunjuk", product_state: "hero", expression: "bright",
        audio_note: "", why: "payoff", mode: "SELLING" },
    ] }) }] }),
  })) as never;
  try {
    await generateScripts({
      product: { id: "pl", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "bestie", qualityTier: "high_quality", durationSec: 15, count: 1,
    });
    assert.ok(baris.some((b) => /naskah LLM DIPAKAI/.test(b)), `tidak ada baris positif:\n${baris.join("\n")}`);
  } finally { console.log = logAsli; globalThis.fetch = aslinya; }
});

// ---------------------------------------------------------------------------
// ATURAN YANG DIPAKAI MENOLAK HARUS SAMPAI KE PENULIS — kasus ketiga
// ---------------------------------------------------------------------------
//
// Dua kali sebelumnya cacat yang sama sudah dibayar: jendela kata (L-05) dan
// kata ganti (L-16) dipakai menolak tanpa pernah diberitahukan. Diukur di
// produksi 3 Sep 2026, tiga aturan lagi ternyata masih begitu — dan akibatnya
// bukan teoretis: empat run berturut-turut ditolak, tiga di antaranya habis di
// percobaan ketiga tanpa naskah sama sekali.
//
//   L-19        "Hook belum memakai perangkat retoris yang dikenali"
//               -> muncul di SETIAP percobaan keempat run. Tidak pernah dikirim.
//   §B baris 9  "segmen demo 11 kata — maksimal 10 kata untuk shot 6 detik"
//               -> prompt cuma menyebut RATA-RATA per segmen, bukan batas keras.
//   L-21        'Negasi tentang orang di arahan visual: "No face"'
//               -> aturannya ADA, tapi contohnya semua kalimat naratif, jadi
//                  penulis tidak menghubungkannya dengan field yang ia isi.

const { batasKataShot } = await import("../lib/script-engine/standar-10");

test("prompt menyampaikan L-19, batas kata per segmen, dan larangan negasi di field visual", async () => {
  const dikirim = stub(segmenSah);
  try {
    const { minWc, maxWc } = jendelaKata({
      qualityTier: "high_quality", durationSec: 15, productName: "Scarlett Acne Serum",
    });
    await tulisNaskah({
      productName: "Scarlett Acne Serum", productCategory: "beauty", priceIdr: 75000,
      durationSec: 15, contentType: "affiliate", cartLabel: "keranjang kuning",
      register: "bestie", hookFamily: "H1", hookLevel: "normal", format: "talking_head",
      wordMin: minWc, wordMax: maxWc,
    });
    const p = dikirim[0];

    // L-19 — beserta penandanya, bukan cuma namanya. Menyuruh "pakai perangkat
    // retoris" tanpa menyebut yang dikenali sama saja dengan tidak menyuruh.
    assert.match(p, /HOOK DEVICE/, "aturan hook tidak dikirim");
    assert.ok(p.includes('"kirain"'), `penanda perangkat tidak ikut:\n${p}`);

    // §B baris 9 — angkanya dari batasKataShot(), sumber yang sama dengan yang
    // menolak. Kalau ini disalin jadi angka mati, ia akan hanyut diam-diam.
    // Pita dipilih dari durasi VIDEO (15 dtk), bukan durasi segmen (5 dtk) —
    // kalau tidak, tiga segmen akan menembus jendela total.
    const batas = batasKataShot(15 / 3, "haul", 15);
    assert.ok(
      p.includes(`may exceed ${batas} spoken words`),
      `batas keras per segmen (${batas}) tidak dikirim:\n${p}`,
    );
    // Dan ia harus dinyatakan BERBEDA dari jendela total — itu justru bedanya.
    assert.match(p, /SEPARATE, harder rule than the total window/);

    // L-21 — dialamatkan ke field yang benar-benar dilanggar di produksi.
    assert.match(p, /THIS APPLIES TO visual_direction, start_state AND action/);
    assert.ok(p.includes("'no hands visible'"), "contoh yang benar-benar terjadi tidak disebut");
  } finally {
    globalThis.fetch = aslinya;
  }
});
