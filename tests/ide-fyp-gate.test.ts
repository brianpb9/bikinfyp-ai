// Idea Stage + FYP Gate (PATCH 4, STEP 3).
//
// Gerbang ketiga — satu-satunya yang bertanya "kenapa orang berhenti scroll?".
// Dua gerbang lain bersifat melarang, dan semua yang mereka luluskan masih bisa
// terlupakan dalam tiga detik.
//
// Yang diuji di sini adalah bagian yang BOLEH deterministik: pembobotan,
// ambang per dimensi, penyaring ide generik, anti-ulang mekanik, dan larangan
// hook tanpa perangkat retoris. Penilaian rasanya sendiri milik model.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-ide-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-ide-storage-${process.pid}`;
process.env.SCRIPT_LLM = "1";
process.env.ANTHROPIC_API_KEY = "kunci-uji";

const { hitungNilai, AMBANG_TOTAL, DIMENSI_FYP, pilihIde, petunjukNaskah } = await import("../lib/script-engine/ide");
const { ideGenerik, urutkanMekanik, MEKANIK_IDE } = await import("../lib/script-engine/idea-mechanics");

const sempurna = { scroll_stop: 10, distinctiveness: 10, story_pull: 10, payoff: 10, brand_fidelity_plan: 10, nativeness: 10 };

test("bobot berjumlah 100 — kalau tidak, totalnya bukan skala 0-100", () => {
  assert.equal(DIMENSI_FYP.reduce((a, d) => a + d.bobot, 0), 100);
  assert.equal(hitungNilai(sempurna).total, 100);
});

test("satu dimensi di bawah ambang MENJATUHKAN, walau totalnya tinggi", () => {
  // Inilah alasan ambang per dimensi ada: scroll-stop jeblok bisa ditutupi
  // bobot besar dimensi lain, dan video yang tidak menghentikan siapa pun
  // akan lolos dengan nilai bagus.
  const n = hitungNilai({ ...sempurna, scroll_stop: 4 });
  assert.ok(n.total >= AMBANG_TOTAL, `total ${n.total} memang masih tinggi`);
  assert.equal(n.lulus, false);
  assert.ok(n.sebabGagal.some((s) => s.startsWith("scroll_stop")), n.sebabGagal.join(", "));
});

test("brand fidelity punya ambang lebih tinggi (8), bukan 7", () => {
  assert.equal(hitungNilai({ ...sempurna, brand_fidelity_plan: 7 }).lulus, false);
  assert.equal(hitungNilai({ ...sempurna, brand_fidelity_plan: 8 }).lulus, true);
});

test("dimensi yang TIDAK dinilai dihitung nol, bukan diabaikan", () => {
  // Penilai yang melewatkan satu dimensi tidak boleh menghasilkan skor yang
  // terlihat baik — itu cara paling halus untuk lolos tanpa dinilai.
  const n = hitungNilai({ scroll_stop: 10, distinctiveness: 10, story_pull: 10, payoff: 10, nativeness: 10 });
  assert.equal(n.perDimensi.brand_fidelity_plan, 0);
  assert.equal(n.lulus, false);
});

test("total di bawah 75 gagal walau semua dimensi di atas ambangnya", () => {
  const pas = { scroll_stop: 7, distinctiveness: 7, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 };
  const n = hitungNilai(pas);
  assert.ok(n.total < AMBANG_TOTAL, `total ${n.total}`);
  assert.equal(n.lulus, false);
  assert.ok(n.sebabGagal[0].startsWith("total"));
});

test("ide generik ditolak; ide yang menyebut benda konkret lolos", () => {
  const k = { productName: "Scarlett Acne Serum", kategoriNoun: "skincare" };
  assert.equal(ideGenerik("Produk ini bikin hidup kamu lebih mudah", k), true);
  assert.equal(ideGenerik("Barang yang wajib punya banget deh", k), true);
  assert.equal(ideGenerik("Serum yang nggak boleh dipakai sebelum jam enam pagi", k), false);
  assert.equal(ideGenerik("Aku sembunyiin botol ini di lemari dapur", k), false);
});

test("anti-ulang menurunkan mekanik yang baru dipakai, TIDAK membuangnya", () => {
  const urut = urutkanMekanik(["forbidden", "absence"]);
  assert.equal(urut.length, MEKANIK_IDE.length, "tidak ada mekanik yang hilang");
  const posisi = (id: string) => urut.findIndex((m) => m.id === id);
  assert.ok(posisi("forbidden") > posisi("contrast"), "yang baru dipakai harus turun");
  assert.ok(posisi("absence") > posisi("contrast"));
});

// ---- alur pilihIde dengan model di-stub ----

const aslinya = globalThis.fetch;

function ideDummy(over: Record<string, unknown> = {}) {
  return {
    one_liner: "Serum yang nggak boleh dipakai sebelum jam enam pagi",
    mechanic: "forbidden", hook_device: "larangan-terbalik", hook_level: "L2",
    why_stop: "Larangan bikin penonton nunggu alasannya",
    story: { setup: "dia ngendap ke kamar mandi", tension: "kenapa sembunyi-sembunyi?", payoff: "kalau ketahuan, habis dipakai rame-rame" },
    product_role: "benda yang direbutin, bukan yang dijelaskan",
    claim_safety: "tanpa klaim mencerahkan",
    suggested_mode: "CCTV lalu SELFIE", suggested_format: "social theft",
    brand_fidelity_plan: "label terbaca saat diambil dari lemari dan saat CTA hero statis satu detik",
    risk: "kalau terlalu gelap label tidak terbaca",
    ...over,
  };
}

/** Lengkapi jadi minimal 3 kandidat bermekanik BERBEDA — skema menuntut itu,
 *  dan spesifikasinya meminta lima. Pengganjalnya sengaja bermekanik lain
 *  supaya uji dedup di bawah tetap punya arti. */
function lengkapi(ideas: ReturnType<typeof ideDummy>[]) {
  const cadangan = ["absence", "stakes", "scale", "confession", "secret"];
  const out = [...ideas];
  let i = 0;
  while (out.length < 3) {
    const m = cadangan[i++];
    if (out.some((x) => x.mechanic === m)) continue;
    out.push(ideDummy({ mechanic: m, one_liner: `Aku berhenti beli botol lain sejak ada ini nomor ${i}` }));
  }
  return out;
}

/** Balas ide lalu nilai, bergantian, sambil merekam permintaannya. */
function stubModel(ideas: ReturnType<typeof ideDummy>[], nilai: Record<string, number>[]) {
  const daftar = lengkapi(ideas);
  const dikirim: string[] = [];
  let iNilai = 0;
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { system: { text: string }[]; messages: { content: string }[] };
    const sistem = body.system.map((s) => s.text).join("\n");
    dikirim.push(`${sistem}\n---\n${body.messages[0].content}`);
    const balas = sistem.includes("You are the FYP gate")
      ? { scores: nilai[Math.min(iNilai++, nilai.length - 1)], reason: "alasan uji yang cukup panjang" }
      : { ideas: daftar };
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(balas) }] }) };
  }) as never;
  return dikirim;
}

const permintaan = {
  productName: "Scarlett Acne Serum", productCategory: "beauty", kategoriNoun: "skincare",
  priceIdr: 75000, durationSec: 15, contentType: "affiliate" as const, register: "bestie",
};

test("ide yang lulus gate dipakai, dan petunjuknya membawa story ke penulis naskah", async () => {
  stubModel([ideDummy()], [sempurna]);
  try {
    const hasil = await pilihIde(permintaan);
    assert.equal(hasil.nilai.lulus, true);
    assert.equal(hasil.putaran, 1);
    const p = petunjukNaskah(hasil.ide);
    assert.match(p, /THE IDEA/);
    assert.ok(p.includes("kenapa sembunyi-sembunyi?"), "tension harus ikut — itu yang dilayani segmen");
    assert.ok(p.includes("label terbaca"), "brand fidelity plan harus mengikat product_state");
  } finally { globalThis.fetch = aslinya; }
});

test("perangkat retoris TIDAK dinilai di tahap ide — itu artefak yang salah", async () => {
  // Koreksi, bukan pelonggaran. POLA_PERANGKAT mengukur bentuk KALIMAT YANG
  // DIUCAPKAN; one_liner adalah DESKRIPSI ide. Menerapkannya di sini membunuh
  // 4 dari 10 kandidat pada jalankan Scarlett 17 Agu, termasuk "Botol setinggi
  // pintu kos" — ide yang justru kuat. Aturannya pindah ke validator (L-19),
  // pada teks segmen hook yang memang diucapkan.
  const polos = ideDummy({ one_liner: "Botol serum setinggi pintu kos berdiri di tengah kamar" });
  stubModel([polos], [sempurna]);
  try {
    const hasil = await pilihIde(permintaan);
    const kandidat = hasil.peringkat.find((p) => p.ide.one_liner === polos.one_liner);
    assert.ok(kandidat, "kandidat harus tetap ada");
    assert.ok(kandidat.nilai.total > 0, "harus DINILAI, bukan digugurkan tanpa dinilai");
    assert.ok(!kandidat.nilai.sebabGagal.includes("hook tanpa perangkat retoris"));
  } finally { globalThis.fetch = aslinya; }
});

test("L-19 ada di validator sebagai PERINGATAN, dan menunjuk segmen hook", async () => {
  const { validateScript } = await import("../lib/script-engine/validator");
  const segmen = (hook: string) => [
    { role: "hook", text: hook },
    { role: "demo", text: "Nah, aku pakai ini tiap malam deh soalnya teksturnya ringan banget di kulit" },
    { role: "cta", text: "cek keranjang kuning ya" },
  ];
  const nilai = (hook: string) => validateScript({
    hook_family: "H1", register: "bestie", segments: segmen(hook),
    productName: "Scarlett Acne Serum", priceIdr: 75000,
    qualityTier: "high_quality", durationSec: 15,
  } as never, "strict");

  // Hook tanpa perangkat yang dikenali: DILAPORKAN, tapi tidak menjatuhkan.
  const tanpa = nilai("Sesuatu baru saja menembus dinding belakang");
  const l19 = tanpa.warnings.find((w) => w.rule === "L-19");
  assert.ok(l19, "L-19 harus muncul sebagai peringatan");
  assert.equal(l19.segment, "hook");
  assert.ok(!tanpa.errors.some((e) => e.rule === "L-19"), "L-19 belum boleh jadi error — 24 dari 132 hook template gagal, sebagiannya bagus");

  // Hook berpertanyaan: tidak dilaporkan sama sekali.
  const dengan = nilai("Jerawat udah hilang, bekasnya masih bandel?");
  assert.ok(!dengan.warnings.some((w) => w.rule === "L-19"));
});

test("kandidat dengan mekanik ganda dibuang — lima ide harus lima pilihan", async () => {
  const kembar = [ideDummy(), ideDummy({ one_liner: "Serum yang nggak boleh dipakai sebelum jam tujuh pagi" })];
  stubModel(kembar, [sempurna]);
  try {
    const hasil = await pilihIde(permintaan);
    // Yang kedua memakai mekanik sama, jadi tidak pernah ikut dinilai.
    const forbidden = hasil.peringkat.filter((p) => p.ide.mechanic === "forbidden");
    assert.equal(forbidden.length, 1, "mekanik yang sama tidak boleh muncul dua kali di peringkat");
    assert.ok(!hasil.peringkat.some((p) => p.ide.one_liner.includes("jam tujuh pagi")),
      "kandidat kembar harus dibuang sebelum dinilai");
  } finally { globalThis.fetch = aslinya; }
});

test("gagal dua putaran: TIDAK dirender diam-diam, peringkat dikembalikan untuk dipilih", async () => {
  const lemah = { scroll_stop: 4, distinctiveness: 4, story_pull: 4, payoff: 4, brand_fidelity_plan: 4, nativeness: 4 };
  const dikirim = stubModel([ideDummy()], [lemah]);
  try {
    const hasil = await pilihIde(permintaan);
    assert.equal(hasil.nilai.lulus, false);
    assert.equal(hasil.putaran, 2);
    assert.ok(hasil.peringkat.length >= 1, "kandidat terbaik tetap dikembalikan untuk ditawarkan ke pengguna");
    // Putaran kedua HARUS melarang mekanik yang barusan gagal — kalau tidak,
    // ia cuma mengocok dadu dengan ide yang sama.
    assert.ok(dikirim.some((p) => /FORBIDDEN MECHANICS this round.*forbidden/s.test(p)),
      "mekanik yang gagal harus dilarang di putaran kedua");
  } finally { globalThis.fetch = aslinya; }
});

test("kategori jenuh diberi tahu bahwa pain-hook polos dilarang", async () => {
  const dikirim = stubModel([ideDummy()], [sempurna]);
  try {
    await pilihIde(permintaan); // beauty = jenuh
    assert.ok(dikirim.some((p) => /SATURATED CATEGORY/.test(p)));
  } finally { globalThis.fetch = aslinya; }

  const dikirim2 = stubModel([ideDummy()], [sempurna]);
  try {
    await pilihIde({ ...permintaan, productCategory: "gadget" });
    assert.ok(!dikirim2.some((p) => /SATURATED CATEGORY/.test(p)), "kategori tidak jenuh tidak diberi larangan itu");
  } finally { globalThis.fetch = aslinya; }
});

test("ide sampai ke prompt penulis naskah, dan tiap varian dapat sudut berbeda", async () => {
  const { blokAturan } = await import("../lib/script-engine/llm");
  void blokAturan;
  const { generateScripts } = await import("../lib/script-engine");

  const ideA = ideDummy();
  const ideB = ideDummy({ mechanic: "absence", one_liner: "Aku berhenti beli botol lain sejak ada yang ini" });
  const ideC = ideDummy({ mechanic: "stakes", one_liner: "Kalau ini bikin kulitku perih, aku balikin ke toko" });

  const promptNaskah: string[] = [];
  const daftar = [ideA, ideB, ideC];
  let iNilai = 0;
  const nilai = [sempurna, { ...sempurna, scroll_stop: 9 }, { ...sempurna, scroll_stop: 8 }];
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { system: { text: string }[]; messages: { content: string }[] };
    const sistem = body.system.map((s) => s.text).join("\n");
    if (sistem.includes("You are the FYP gate")) {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ scores: nilai[Math.min(iNilai++, 2)], reason: "alasan uji yang cukup panjang" }) }] }) };
    }
    if (sistem.includes("You invent ONE IDEA")) {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ ideas: daftar }) }] }) };
    }
    // Penulis adegan: rekam promptnya, balas naskah apa adanya.
    promptNaskah.push(body.messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: [
      { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, aku dulu gitu juga sih",
        start_state: "dia sudah memegang pipinya", framing: "medium", angle: "eye level", camera: "static",
        action: "dia mendekat, lalu menunjuk", product_state: "hidden", expression: "worried",
        audio_note: "", why: "setup — menamai masalahnya", mode: "SELFIE" },
      { block: "BODY", label: "DEMO", start: 4, end: 10, text: "aku pakai ini tiap malam deh",
        start_state: "botolnya sudah di tangan", framing: "medium", angle: "eye level", camera: "push in",
        action: "dia memutar botol, lalu memiringkan labelnya", product_state: "partial", expression: "warm",
        audio_note: "", why: "tension — menunjukkan jalan keluarnya", mode: "SELLING" },
      { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "cek keranjang kuning ya",
        start_state: "botolnya sudah terangkat", framing: "tight", angle: "eye level", camera: "static",
        action: "dia menahannya diam, lalu menunjuk ke bawah", product_state: "hero", expression: "bright",
        audio_note: "", why: "payoff — labelnya akhirnya terbaca", mode: "SELLING" },
    ] }) }] }) };
  }) as never;

  try {
    await generateScripts({
      product: { id: "p1", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "bestie", qualityTier: "high_quality", durationSec: 15, count: 3,
    });
    assert.ok(promptNaskah.length >= 3, `butuh >=3 prompt naskah, dapat ${promptNaskah.length}`);
    // Ide ada di prompt, dan PALING DEPAN — ia tujuan, bukan catatan tambahan.
    assert.match(promptNaskah[0], /^THE IDEA/);
    // KETIGA ide terpakai. Dihitung sebagai himpunan, bukan per posisi: satu
    // varian bisa memanggil penulis dua kali karena lingkar perbaikan
    // validator, jadi prompt tidak 1:1 dengan varian.
    const oneLiners = new Set(promptNaskah.map((p) => p.split("\n")[0]));
    assert.equal(oneLiners.size, 3, `tiga varian harus memakai tiga sudut:\n${[...oneLiners].join("\n")}`);
  } finally { globalThis.fetch = aslinya; }
});
