// Slice 2 (audit B7, 19 Agu 2026): Story OS untuk Ads.
//
// Sebelum ini penulis Ads = HOOK→BODY→CTA polos; satu-satunya hal khas Ads yang
// sampai ke model adalah kalimat CTA. Story OS (knowledge/rules/STORY-OS-ADS-v1.md)
// menuntut bentuk lain: BUTTON ditulis pertama, SPIKE di depan SAKSI, HOOK tanpa
// kata, FRICTION naik dua kali, bridging >= 2.
//
// Gerbang SA1–SA8: SA1/SA2/SA4/SA6/SA8 dapat dicek mesin dari struktur;
// SA3/SA5/SA7 diserahkan ke juri FYP. Pembagian itu HARUS jujur — tes ini
// menguncinya, supaya tidak ada gerbang "kode" yang sebenarnya cuma harapan.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-storyos-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-storyos-storage-${process.pid}`;
process.env.SCRIPT_LLM = "1";
process.env.ANTHROPIC_API_KEY = "kunci-uji-story-ads";

const { GERBANG_SA, periksaStoryOsAds, penegakanSA } = await import("../lib/script-engine/story-os-ads");

/** Naskah Ads yang MEMENUHI Story OS — dipakai sebagai kontrol positif. */
const LULUS = {
  segments: [
    {
      block: "HOOK", label: "HOOK", start: 0, end: 4, text: "",
      start_state: "Tangan menutup mulut di depan cermin kecil, produk tergeletak di meja rias",
      action: "kamera diam, tangan turun perlahan", product_state: "hidden",
      why: "setup", mode: "CCTV", visual_direction: "meja rias, tanpa wajah",
    },
    {
      block: "BODY", label: "FRICTION", start: 4, end: 8, text: "Untuk Serum Uji, jangan sekarang dong.",
      start_state: "Timer di layar HP menyala, waktunya habis",
      action: "tangan naik lagi ke mulut, lalu ditarik", product_state: "hidden", bridge_source: "spoken_product_name",
      why: "tension", mode: "SELFIE", visual_direction: "meja rias",
    },
    {
      block: "BODY", label: "FRICTION", start: 8, end: 12, text: "Harganya 89 ribu. Bentar.",
      start_state: "Suara petugas memanggil dari luar pintu",
      action: "dia berdiri, menggeser kursi, mengambil produk dan memasukkannya ke saku",
      product_state: "hidden", bridge_source: "spoken_approved_price", why: "tension", mode: "HANDHELD", visual_direction: "beranjak",
    },
    {
      block: "BODY", label: "SPIKE", start: 12, end: 16, text: "Udah. Masuk aja.",
      start_state: "Petugas berdiri di ambang pintu, suara off camera",
      action: "dia tersenyum lepas di depan petugas", product_state: "hidden",
      why: "payoff", mode: "GENERAL", visual_direction: "ruang tunggu",
      saksi: "petugas, off camera",
    },
    {
      block: "CTA", label: "BUTTON", start: 16, end: 20,
      text: "Tadi sikat gigi dulu. Keterima nggak ya? Detailnya ada di bawah ya.",
      start_state: "Produk di tangan, label menghadap kamera",
      action: "diam satu detik di akhir", product_state: "hidden",
      why: "payoff", mode: "SELLING", visual_direction: "produk hero",
    },
  ],
} as never;

const ADS_CTX = { contentType: "ads" as const, durationSec: 20, productName: "Serum Uji", productCategory: "beauty", productPriceIdr: 89000 };

test("SA3 silent-hook kini kode; kualitas konflik SA3 serta SA5/SA7 tetap dinilai juri", () => {
  assert.deepEqual(
    GERBANG_SA.filter((g) => g.penegakan === "kode").map((g) => g.id).sort(),
    ["SA1", "SA2", "SA3", "SA4", "SA6", "SA8"]
  );
  assert.deepEqual(
    GERBANG_SA.filter((g) => g.penegakan === "juri").map((g) => g.id).sort(),
    ["SA5", "SA7"]
  );
  // Tiap gerbang wajib menyebut siapa yang menegakkannya — supaya tidak ada
  // yang membaca daftar ini lalu mengira delapan-duanya dicek mesin.
  for (const g of GERBANG_SA) assert.ok(g.judul.length > 5, `${g.id} tanpa judul`);
  assert.equal(penegakanSA("SA5"), "juri");
  assert.equal(penegakanSA("SA1"), "kode");
});

test("naskah Ads yang memenuhi Story OS: NOL temuan keras", () => {
  const temuan = periksaStoryOsAds(LULUS, ADS_CTX);
  assert.deepEqual(temuan, [], `naskah sah ditolak: ${JSON.stringify(temuan)}`);
});

test("Ads 0/1/2 segmen gagal struktur lengkap di strict dan light", async () => {
  const { validateScript } = await import("../lib/script-engine/validator");
  const source = structuredClone((LULUS as unknown as { segments: Record<string, unknown>[] }).segments);
  for (const length of [0, 1, 2]) {
    const segments = source.slice(0, length);
    const direct = periksaStoryOsAds({ segments } as never, ADS_CTX);
    if (length === 0) assert.ok(direct.some((finding) => finding.gerbang === "SA3"), `${length}: tanpa SA3`);
    assert.ok(direct.some((finding) => finding.gerbang === "SA4" && /5 beat/.test(finding.pesan)), `${length}: tanpa panjang`);
    assert.ok(direct.some((finding) => finding.gerbang === "SA4" && /FRICTION/.test(finding.pesan)), `${length}: tanpa FRICTION`);
    assert.ok(direct.some((finding) => finding.gerbang === "SA2" && /SPIKE/.test(finding.pesan)), `${length}: tanpa SPIKE`);
    assert.ok(direct.some((finding) => finding.gerbang === "SA1" && /BUTTON/.test(finding.pesan)), `${length}: tanpa BUTTON`);
    for (const mode of ["strict", "light"] as const) {
      const result = validateScript({
        segments, hookFamily: "H1", register: "netral", productName: "Serum Uji",
        productPriceIdr: 89000, contentType: "ads", durationSec: 20, quality_tier: "super_hq",
      } as never, mode);
      assert.equal(result.passed, false, `${mode} meloloskan Ads ${length} segmen`);
      for (const rule of ["SA1", "SA2", "SA4", ...(length === 0 ? ["SA3"] : [])]) {
        assert.ok(result.errors.some((issue) => issue.rule === rule), `${mode}/${length}: tanpa ${rule}`);
      }
    }
  }
});

test("SA3 menolak reordered, duplicate, missing, text, tts, alias suara, dan start nol di strict dan light", async () => {
  const { validateScript } = await import("../lib/script-engine/validator");
  const mutations: Array<[string, (segments: Record<string, unknown>[]) => void]> = [
    ["reordered HOOK", (segments) => { [segments[0], segments[1]] = [segments[1], segments[0]]; }],
    ["duplicate HOOK", (segments) => { segments.splice(1, 0, structuredClone(segments[0])); }],
    ["missing HOOK", (segments) => { segments[0].block = "BODY"; segments[0].label = "FRICTION"; }],
    ["nonempty text", (segments) => { segments[0].text = "Eh, dialog bocor."; }],
    ["nonempty tts_text", (segments) => { segments[0].tts_text = "[excited] Eh, TTS bocor."; }],
    ["speech alias", (segments) => { segments[0].dialogue = "Eh, alias bocor."; }],
    ["later segment starts at zero", (segments) => { segments[1].start = 0; }],
  ];
  for (const [name, mutate] of mutations) {
    const segments = structuredClone((LULUS as unknown as { segments: Record<string, unknown>[] }).segments);
    mutate(segments);
    for (const mode of ["strict", "light"] as const) {
      const result = validateScript({
        segments, hookFamily: "H1", register: "netral", productName: "Serum Uji",
        productPriceIdr: 89000, contentType: "ads", durationSec: 20, quality_tier: "super_hq",
      } as never, mode);
      assert.ok(result.errors.some((issue) => issue.rule === "SA3"), `${mode} meloloskan ${name}`);
    }
  }
});

test("schema LLM Ads menolak HOOK bersuara dan menerima kontrol senyap", async () => {
  const { SkemaNaskahAds } = await import("../lib/script-engine/llm");
  assert.equal(SkemaNaskahAds.safeParse({ segments: LIVE_ADS_SAFE }).success, true);
  for (const mutate of [
    (segments: typeof LIVE_ADS_SAFE) => { [segments[0], segments[1]] = [segments[1], segments[0]]; },
    (segments: typeof LIVE_ADS_SAFE) => { segments.splice(1, 0, structuredClone(segments[0])); },
    (segments: typeof LIVE_ADS_SAFE) => { segments[0].block = "BODY"; segments[0].label = "FRICTION"; },
    (segments: typeof LIVE_ADS_SAFE) => { segments[0].text = "Eh, bocor."; },
  ]) {
    const unsafe = structuredClone(LIVE_ADS_SAFE);
    mutate(unsafe);
    assert.equal(SkemaNaskahAds.safeParse({ segments: unsafe }).success, false);
  }
  const unknownSpeechAlias = structuredClone(LIVE_ADS_SAFE) as Array<Record<string, unknown>>;
  unknownSpeechAlias[0].tts_text = "Eh, alias yang semula dibuang.";
  assert.equal(SkemaNaskahAds.safeParse({ segments: unknownSpeechAlias }).success, false, "schema strict tidak boleh membuang alias suara diam-diam");
});

test("mapper Ads menolak susunan HOOK tidak kanonis tanpa mengurutkan ulang", async () => {
  const { keSegmentDraft } = await import("../lib/script-engine/llm");
  const reordered = structuredClone(LIVE_ADS_SAFE);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => keSegmentDraft(reordered as never, "ads"), /Kontrak SA3 mapper/);

  const safe = keSegmentDraft(structuredClone(LIVE_ADS_SAFE) as never, "ads");
  assert.equal(safe[0].label, "HOOK");
  assert.equal(safe[0].text, "");
});

test("live LLM Ads menolak reordered HOOK lalu menerima respons perbaikan tanpa normalisasi diam-diam", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const fetchAsli = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      const segments = structuredClone(LIVE_ADS_SAFE);
      if (calls === 1) [segments[0], segments[1]] = [segments[1], segments[0]];
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }) };
    }) as never;
    const [result] = await generateScripts({
      product: { id: "live-reordered-hook", name: "Kemeja Uji", price_idr: 189000, category: "fashion" },
      register: "netral", qualityTier: "high_quality", durationSec: 15,
      contentType: "ads", templateId: "ads-unboxing-pov", count: 1,
      hookFamilies: ["H8"], lockHookFamily: true,
    });
    assert.equal(calls, 2);
    assert.equal(result.validation.passed, true, JSON.stringify(result.validation.errors));
    assert.equal(result.segments[0].label, "HOOK");
    assert.equal(result.segments[0].text, "");
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("live LLM Ads memperbaiki keluaran 0/1/2 segmen sebelum pipeline", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const fetchAsli = globalThis.fetch;
  try {
    for (const length of [0, 1, 2]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        const segments = calls === 1 ? structuredClone(LIVE_ADS_SAFE).slice(0, length) : structuredClone(LIVE_ADS_SAFE);
        return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }) };
      }) as never;
      const [result] = await generateScripts({
        product: { id: `live-short-${length}`, name: "Kemeja Uji", price_idr: 189000, category: "fashion" },
        register: "netral", qualityTier: "high_quality", durationSec: 15,
        contentType: "ads", templateId: "ads-unboxing-pov", count: 1,
        hookFamilies: ["H8"], lockHookFamily: true,
      });
      assert.equal(calls, 2, `${length}: tidak direpair tepat sekali`);
      assert.equal(result.validation.passed, true, JSON.stringify(result.validation.errors));
      assert.deepEqual(result.segments.map((segment) => segment.label), ["HOOK", "FRICTION", "FRICTION", "SPIKE", "BUTTON"]);
    }
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("live LLM Ads menolak bridge blank-only lalu menerima provenance lisan yang terbukti", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const fetchAsli = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      const segments = structuredClone(LIVE_ADS_SAFE);
      if (calls === 1) {
        delete segments[1].bridge_source;
        delete segments[2].bridge_source;
      }
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }) };
    }) as never;
    const [result] = await generateScripts({
      product: { id: "live-blank-bridge", name: "Kemeja Uji", price_idr: 189000, category: "fashion" },
      register: "netral", qualityTier: "high_quality", durationSec: 15,
      contentType: "ads", templateId: "ads-unboxing-pov", count: 1,
      hookFamilies: ["H8"], lockHookFamily: true,
    });
    assert.equal(calls, 2, "bridge tanpa provenance harus direpair tepat sekali");
    assert.equal(result.validation.passed, true, JSON.stringify(result.validation.errors));
    assert.deepEqual(
      result.segments.flatMap((segment) => segment.bridge_source ? [segment.bridge_source] : []).sort(),
      ["spoken_approved_price", "spoken_product_name"]
    );
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("live LLM Ads menolak ketaatan CTA telanjang lalu menerima BUTTON bertanya", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const fetchAsli = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = (async () => {
      calls++;
      const segments = structuredClone(LIVE_ADS_SAFE);
      if (calls === 1) segments[4].text = "Detailnya ada di bawah ya.";
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }) };
    }) as never;
    const [result] = await generateScripts({
      product: { id: "live-bare-cta", name: "Kemeja Uji", price_idr: 189000, category: "fashion" },
      register: "netral", qualityTier: "high_quality", durationSec: 15,
      contentType: "ads", templateId: "ads-unboxing-pov", count: 1,
      hookFamilies: ["H8"], lockHookFamily: true,
    });
    assert.equal(calls, 2, "CTA telanjang harus direpair tepat sekali");
    assert.equal(result.validation.passed, true, JSON.stringify(result.validation.errors));
    assert.match(result.segments[4].text, /\?[\s\S]*Detailnya ada di bawah ya/i);
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("SA1 — CTA tanpa tanya yang tersisa ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[4].text = "Detailnya ada di bawah ya.";
  const t = periksaStoryOsAds(rusak, ADS_CTX);
  assert.ok(t.some((x) => x.gerbang === "SA1"), `SA1 tidak menangkap button tanpa tanya: ${JSON.stringify(t)}`);
});

test("SA2 — spike tanpa saksi ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  delete rusak.segments[3].saksi;
  rusak.segments[3].start_state = "Dia sendirian di ruangan kosong";
  // action & visual_direction ikut dibersihkan: pemeriksa membaca ketiganya,
  // dan menyebut "petugas" di action memang BERARTI saksinya hadir.
  rusak.segments[3].action = "dia tersenyum lepas ke arah cermin";
  rusak.segments[3].visual_direction = "ruang tunggu kosong";
  const t = periksaStoryOsAds(rusak, ADS_CTX);
  assert.ok(t.some((x) => x.gerbang === "SA2"), `SA2 tidak menangkap spike tanpa saksi: ${JSON.stringify(t)}`);
});

test("SA4 — friction cuma sekali ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[2].label = "BODY";
  const t = periksaStoryOsAds(rusak, ADS_CTX);
  assert.ok(t.some((x) => x.gerbang === "SA4"), `SA4 tidak menangkap friction tunggal: ${JSON.stringify(t)}`);
});

test("SA6 — prop blank partial/hero dan aksi generik tidak pernah menjadi bridge", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  delete rusak.segments[1].bridge_source;
  delete rusak.segments[2].bridge_source;
  rusak.segments[0].product_state = "partial";
  rusak.segments[2].product_state = "hero";
  rusak.segments[2].action = "talent buka lalu pegang kartu blank";
  const t = periksaStoryOsAds(rusak, ADS_CTX);
  assert.ok(t.some((x) => x.gerbang === "SA6" && /prop blank/.test(x.pesan)), JSON.stringify(t));
  assert.ok(t.some((x) => x.gerbang === "SA6" && /terverifikasi cuma 0/.test(x.pesan)), JSON.stringify(t));
});

test("SA8 — body yang menjelaskan hook/produk ditolak", () => {
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[1].text = "Aslinya sabun ini bikin gigi lebih bersih.";
  const t = periksaStoryOsAds(rusak, ADS_CTX);
  assert.ok(t.some((x) => x.gerbang === "SA8"), `SA8 tidak menangkap body penjelasan: ${JSON.stringify(t)}`);
});

test("Affiliate TIDAK dikenai Story OS Ads — ia punya bentuknya sendiri", () => {
  const t = periksaStoryOsAds(LULUS, { contentType: "affiliate", durationSec: 15 });
  assert.deepEqual(t, [], "Story OS Ads tidak boleh berlaku untuk Affiliate");
});

test("penulis Ads menerima instruksi Story OS, Affiliate tidak", async () => {
  const { blokTugasUntukUji } = await import("../lib/script-engine/llm");
  const ads = blokTugasUntukUji({ contentType: "ads", durationSec: 20 });
  const aff = blokTugasUntukUji({ contentType: "affiliate", durationSec: 15 });
  for (const kata of ["BUTTON", "SPIKE", "FRICTION", "SAKSI", "bridging"]) {
    assert.ok(new RegExp(kata, "i").test(ads), `instruksi Ads tidak menyebut ${kata}`);
  }
  assert.ok(!/BUTTON-first|SPIKE/i.test(aff), "Affiliate tidak boleh diberi beat Story OS Ads");
  assert.match(ads, /must contain the exact CTA phrase[\s\S]+as a substring/i);
  assert.match(ads, /unresolved story question or clause/i);
  assert.match(ads, /must never be the whole line/i);
  assert.doesNotMatch(ads, /CTA line must be exactly/i);
});

test("prompt produksi penulis Ads mengunci prop blank non-faktual tanpa meminta label produk", async () => {
  const { blokTugasUntukUji } = await import("../lib/script-engine/llm");
  for (const fixture of [
    { productName: "Serum Glow Bening", productCategory: "beauty" },
    { productName: "Jasa Kilat Beres", productCategory: "jasa" },
  ]) {
    const prompt = blokTugasUntukUji({ contentType: "ads", durationSec: 20, format: "ads", ...fixture });
    assert.match(prompt, /plain unprinted colour card or swatch/i);
    assert.match(prompt, /no letters, numbers, logos, labels, prices, product names, categories, or readable marks/i);
    assert.doesNotMatch(prompt, /Product hero|label readable|action with the product|product present in frame 1/i);
  }
});

const LIVE_ADS_SAFE = [
  { block: "HOOK", label: "HOOK", start: 0, end: 3, text: "", start_state: "kartu blank sudah di meja", framing: "medium shot", angle: "eye level", camera: "static camera", action: "kartu warna polos bergerak sejak frame pertama", product_state: "hidden", expression: "curious", audio_note: "", why: "setup conflict", mode: "GENERAL" },
  { block: "BODY", label: "FRICTION", start: 3, end: 6.5, text: "Nah, Kemeja Uji.", bridge_source: "spoken_product_name", start_state: "kartu blank dekat tangan", framing: "medium shot", angle: "eye level", camera: "slow push", action: "talent buka kartu warna polos perlahan", product_state: "hidden", expression: "focused", audio_note: "", why: "tension rises", mode: "GENERAL" },
  { block: "BODY", label: "FRICTION", start: 6.5, end: 10, text: "Seratus delapan puluh sembilan ribu.", bridge_source: "spoken_approved_price", start_state: "swatch blank sudah terbuka", framing: "close shot", angle: "eye level", camera: "slow drift", action: "swatch blank dipindahkan mendekati saksi", product_state: "hidden", expression: "focused", audio_note: "", why: "tension rises again", mode: "GENERAL" },
  { block: "BODY", label: "SPIKE", start: 10, end: 12.5, text: "Udah, lihat.", start_state: "kasir berada di samping meja", framing: "medium shot", angle: "eye level", camera: "static camera", action: "kartu warna polos diletakkan di depan kasir", product_state: "hidden", expression: "relieved", audio_note: "", why: "payoff witnessed", mode: "GENERAL", saksi: "kasir off camera" },
  { block: "CTA", label: "BUTTON", start: 12.5, end: 15, text: "Tadi ragu, cocok nggak? Detailnya ada di bawah ya.", start_state: "kartu blank menghadap kamera", framing: "close shot", angle: "eye level", camera: "static camera", action: "talent menunjuk blok warna pada kartu blank", product_state: "hidden", expression: "warm", audio_note: "", why: "button payoff", mode: "GENERAL" },
];

test("A-03 keras di strict dan light, safe control tetap bebas A-03", async () => {
  const { keSegmentDraft } = await import("../lib/script-engine/llm");
  const { validateScript } = await import("../lib/script-engine/validator");
  const safe = keSegmentDraft(structuredClone(LIVE_ADS_SAFE) as never);
  const context = {
    hook_family: "H8", register: "netral", productName: "Kemeja Uji", priceIdr: 189000,
    productCategory: "fashion", qualityTier: "high_quality", durationSec: 15,
    contentType: "ads", templateId: "ads-unboxing-pov", segments: safe,
  } as const;
  assert.ok(!validateScript(context as never, "strict").errors.some((issue) => issue.rule === "A-03"));
  for (const action of [
    "talent memutar kemasannya di samping swatch blank",
    "talent mengangkat botolnya sambil memegang kartu blank",
    "talent mengangkat Kemeja Uji di samping kartu blank",
    "talent mengangkat fashion di samping kartu blank",
  ]) {
    const unsafe = structuredClone(safe);
    unsafe[2].action = action;
    for (const mode of ["strict", "light"] as const) {
      assert.ok(validateScript({ ...context, segments: unsafe } as never, mode).errors.some((issue) => issue.rule === "A-03"), `${mode} meloloskan ${action}`);
    }
  }
});

test("live LLM Ads menolak aksi produk lalu menerima perbaikan prop netral sebelum provider", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const fetchAsli = globalThis.fetch;
  try {
    for (const unsafeAction of [
      "talent memutar kemasannya di samping swatch blank",
      "talent mengangkat botolnya sambil memegang kartu blank",
      "talent mengangkat Kemeja Uji di samping kartu blank",
      "talent mengangkat fashion di samping kartu blank",
    ]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        const segments = structuredClone(LIVE_ADS_SAFE);
        if (calls === 1) segments[2].action = unsafeAction;
        return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments }) }] }) };
      }) as never;
      const [result] = await generateScripts({
        product: { id: `live-ads-${calls}`, name: "Kemeja Uji", price_idr: 189000, category: "fashion" },
        register: "netral", qualityTier: "high_quality", durationSec: 15,
        contentType: "ads", templateId: "ads-unboxing-pov", count: 1,
        hookFamilies: ["H8"], lockHookFamily: true,
      });
      assert.equal(calls, 2, `aksi tidak aman harus direpair: ${unsafeAction}`);
      assert.equal(result.validation.passed, true, JSON.stringify(result.validation.errors));
    }
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

test("validator menolak naskah Ads yang gagal SA — bukan sekadar mencatat", async () => {
  const { validateScript } = await import("../lib/script-engine/validator");
  const rusak = JSON.parse(JSON.stringify(LULUS));
  rusak.segments[3].start_state = "Dia sendirian di ruangan kosong";
  rusak.segments[3].action = "dia tersenyum lepas ke arah cermin";
  rusak.segments[3].visual_direction = "ruang tunggu kosong";
  delete rusak.segments[3].saksi;
  const hasil = validateScript(
    {
      segments: rusak.segments,
      hookFamily: "H1", register: "netral", productName: "Serum Glow Bening",
      productPriceIdr: 89000, contentType: "ads", durationSec: 20, quality_tier: "super_hq",
    } as never,
    "light"
  );
  assert.ok(
    hasil.errors.some((e) => e.rule.startsWith("SA")),
    `gerbang SA harus jadi ERROR di semua mode: ${JSON.stringify(hasil.errors.concat(hasil.warnings))}`
  );
});
