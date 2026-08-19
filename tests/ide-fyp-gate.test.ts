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
    human_situation: "Ibu ngendap-ngendap ke kamar mandi jam lima pagi sebelum anak-anak bangun",
    mechanic: "forbidden", format: "secret_hack", hook_device: "larangan-terbalik", hook_level: "L2",
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

test("L-19 GATE KERAS di validator, dan menunjuk segmen hook", async () => {
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
  // Kalimat ini SEKARANG lolos: "sesuatu"/"baru saja" adalah perangkat
  // kejutan yang dulu tidak dikenali detektor (itu sebabnya L-19 belum bisa
  // dikeraskan). Detektornya dilengkapi lebih dulu, baru gatenya dikeraskan.
  assert.ok(!nilai("Sesuatu baru saja menembus dinding belakang").errors.some((e) => e.rule === "L-19"),
    "perangkat kejutan harus dikenali sesudah detektor dilengkapi");
  const polos = nilai("Botol kaca kecil berisi cairan bening di meja");
  const l19 = polos.errors.find((e) => e.rule === "L-19");
  assert.ok(l19, "hook tanpa perangkat harus jadi ERROR, bukan peringatan");
  assert.equal(l19.segment, "hook");
  assert.equal(polos.passed, false);

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
      // super_hq: tier yang memang menjalankan Idea Stage (IDEA_STAGE_TIERS).
      register: "bestie", qualityTier: "super_hq", durationSec: 15, count: 3,
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

test("mekanik ber-CGI dibatasi nativeness-nya di format sehari-hari, tidak di level tontonan", async () => {
  const { penaltiCgi } = await import("../lib/script-engine/ide");
  const { BATAS_NATIVENESS_CGI } = await import("../lib/script-engine/idea-mechanics");
  const pov = ideDummy({ mechanic: "anomaly_pov" });
  // hands_only / talking_head level normal: dibatasi, dan batasnya DI BAWAH
  // ambang 7 — jadi benar-benar tidak bisa lolos, bukan cuma kehilangan poin.
  assert.equal(penaltiCgi(pov, { format: "hands_only", hookLevel: "normal" }).berlaku, true);
  assert.equal(penaltiCgi(pov, { format: "talking_head", hookLevel: "normal" }).berlaku, true);
  assert.ok(BATAS_NATIVENESS_CGI < 7);
  // Level tontonan: penonton memang datang untuk yang mustahil.
  assert.equal(penaltiCgi(pov, { format: "hands_only", hookLevel: "gila" }).berlaku, false);
  assert.equal(penaltiCgi(pov, { format: "hands_only", hookLevel: "agak_gila" }).berlaku, false);
  // TVC memang dirakit dan penonton tahu itu.
  assert.equal(penaltiCgi(pov, { format: "tvc", hookLevel: "normal" }).berlaku, false);
  // Mekanik non-CGI tidak tersentuh.
  assert.equal(penaltiCgi(ideDummy({ mechanic: "social_theft" }), { format: "hands_only", hookLevel: "normal" }).berlaku, false);
});

test("situasi manusia dibedakan dari deskripsi benda", async () => {
  const { situasiManusiawi } = await import("../lib/script-engine/idea-mechanics");
  assert.equal(situasiManusiawi("Ibu ngendap-ngendap ke kamar mandi sebelum anak-anak bangun"), true);
  assert.equal(situasiManusiawi("Bestie nanya terus sampai aku ketahuan nyimpen botolnya"), true);
  assert.equal(situasiManusiawi("Anak kos rebutan satu botol di meja bersama"), true);
  // Yang berangkat dari benda — persis 10 dari 10 kandidat pada jalankan 17 Agu.
  assert.equal(situasiManusiawi("Kamera dipasang di dasar botol, pipet turun menyedot cairan"), false);
  assert.equal(situasiManusiawi("Satu tetes menyusut sampai hilang di permukaan datar"), false);
});

test("gate GAGAL: naskah TIDAK ditulis dari ide gagal, dan tiga terbaik dikembalikan", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const lemah = { scroll_stop: 4, distinctiveness: 4, story_pull: 4, payoff: 4, brand_fidelity_plan: 4, nativeness: 4 };
  const promptNaskah: string[] = [];
  const daftar = [
    ideDummy(),
    ideDummy({ mechanic: "absence", one_liner: "Meja rias aku dikosongin satu per satu sampai sisa satu botol" }),
    ideDummy({ mechanic: "stakes", one_liner: "Kalau ini bikin kulitku perih, aku balikin ke toko besok pagi" }),
  ];
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { system: { text: string }[]; messages: { content: string }[] };
    const sistem = body.system.map((s) => s.text).join("\n");
    if (sistem.includes("You are the FYP gate")) {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ scores: lemah, reason: "alasan uji yang cukup panjang" }) }] }) };
    }
    if (sistem.includes("You invent ONE IDEA")) {
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ ideas: daftar }) }] }) };
    }
    promptNaskah.push(body.messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: [
      { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, aku dulu gitu juga sih",
        start_state: "dia sudah memegang pipinya", framing: "medium", angle: "eye level", camera: "static",
        action: "dia mendekat, lalu menunjuk", product_state: "hidden", expression: "worried",
        audio_note: "", why: "setup", mode: "SELFIE" },
      { block: "BODY", label: "DEMO", start: 4, end: 10, text: "aku pakai ini tiap malam deh",
        start_state: "botolnya sudah di tangan", framing: "medium", angle: "eye level", camera: "push in",
        action: "dia memutar botol, lalu memiringkan labelnya", product_state: "partial", expression: "warm",
        audio_note: "", why: "tension", mode: "SELLING" },
      { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "cek keranjang kuning ya",
        start_state: "botolnya sudah terangkat", framing: "tight", angle: "eye level", camera: "static",
        action: "dia menahannya diam, lalu menunjuk ke bawah", product_state: "hero", expression: "bright",
        audio_note: "", why: "payoff", mode: "SELLING" },
    ] }) }] }) };
  }) as never;

  try {
    const hasil = await generateScripts({
      product: { id: "p2", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "bestie", qualityTier: "super_hq", durationSec: 15, count: 1,
    });
    // Tidak satu pun prompt naskah membawa ide — itu inti perubahannya.
    assert.ok(promptNaskah.length > 0, "penulis naskah tetap dipanggil");
    for (const p of promptNaskah) {
      assert.ok(!p.startsWith("THE IDEA"), `naskah tidak boleh ditulis dari ide yang gagal gate:\n${p.slice(0, 200)}`);
    }
    // Tiga terbaik ikut keluar supaya bisa ditawarkan ke pengguna.
    const k = hasil[0].ideKandidat;
    assert.ok(k, "kandidat ide harus dikembalikan saat gate gagal");
    assert.ok(k.length >= 1 && k.length <= 3, `maksimal tiga, dapat ${k.length}`);
    assert.ok(k[0].sebabGagal.length > 0, "sebab gagalnya harus ikut");
    assert.ok(typeof k[0].total === "number" && k[0].human_situation.length > 0);
  } finally { globalThis.fetch = aslinya; }
});

test("penambal kuota tidak boleh menggandakan mekanik walau model mengabaikan larangan", async () => {
  // Larangan yang cuma ditulis di prompt bukan larangan. Model yang
  // mengembalikan daftar sama harus tetap menghasilkan peringkat tanpa
  // duplikat — kalau tidak, satu ide dihitung dua kali dan varian naskah
  // kedua memakai ide yang sama dengan varian pertama.
  const dua = [
    ideDummy(),
    ideDummy({ mechanic: "absence", one_liner: "Meja rias dikosongin satu per satu sampai sisa satu botol" }),
  ];
  stubModel(dua, [sempurna]);
  try {
    const hasil = await pilihIde(permintaan);
    const mekanik = hasil.peringkat.map((p) => p.ide.mechanic);
    assert.equal(new Set(mekanik).size, mekanik.length, `mekanik terduplikasi: ${mekanik.join(", ")}`);
  } finally { globalThis.fetch = aslinya; }
});

test("Idea Stage bergerbang tier; Enterprise selalu ikut", async () => {
  const { bolehIdeaStage } = await import("../lib/script-engine/ide");
  // Bawaan IDEA_STAGE_TIERS = "super_hq".
  assert.equal(bolehIdeaStage({ tier: "super_hq" }), true);
  assert.equal(bolehIdeaStage({ tier: "high_quality" }), false);
  assert.equal(bolehIdeaStage({ tier: "silent_caption" }), false);
  // Enterprise tidak melihat tier — jalurnya memang dibayar berbeda.
  assert.equal(bolehIdeaStage({ tier: "high_quality", orgId: "org-1" }), true);
  assert.equal(bolehIdeaStage({ tier: "silent_caption", orgId: "org-1" }), true);
});

test("high_quality tetap memakai penulis LLM, hanya tanpa Idea Stage", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  let panggilanIde = 0;
  const promptNaskah: string[] = [];
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { system: { text: string }[]; messages: { content: string }[] };
    const sistem = body.system.map((s) => s.text).join("\n");
    if (sistem.includes("You invent ONE IDEA") || sistem.includes("You are the FYP gate")) {
      panggilanIde++;
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) };
    }
    promptNaskah.push(body.messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: [
      { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, aku dulu gitu juga sih",
        start_state: "dia sudah memegang pipinya", framing: "medium", angle: "eye level", camera: "static",
        action: "dia mendekat, lalu menunjuk", product_state: "hidden", expression: "worried",
        audio_note: "", why: "setup", mode: "SELFIE" },
      { block: "BODY", label: "DEMO", start: 4, end: 10, text: "aku pakai ini tiap malam deh",
        start_state: "botolnya sudah di tangan", framing: "medium", angle: "eye level", camera: "push in",
        action: "dia memutar botol, lalu memiringkan label", product_state: "partial", expression: "warm",
        audio_note: "", why: "tension", mode: "SELLING" },
      { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "cek keranjang kuning ya",
        start_state: "botolnya sudah terangkat", framing: "tight", angle: "eye level", camera: "static",
        action: "dia menahannya diam, lalu menunjuk", product_state: "hero", expression: "bright",
        audio_note: "", why: "payoff", mode: "SELLING" },
    ] }) }] }) };
  }) as never;
  try {
    await generateScripts({
      product: { id: "p3", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "bestie", qualityTier: "high_quality", durationSec: 15, count: 1,
    });
    assert.equal(panggilanIde, 0, "Idea Stage tidak boleh jalan di high_quality retail");
    assert.ok(promptNaskah.length > 0, "penulis LLM TETAP dipakai — yang hilang cuma Gate 3");
  } finally { globalThis.fetch = aslinya; }
});

test("tanpaLlm memaksa jalur template — jalur anonim tidak boleh keluar uang", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  let panggilan = 0;
  globalThis.fetch = (async () => { panggilan++; throw new Error("tidak boleh ada panggilan model"); }) as never;
  try {
    const hasil = await generateScripts({
      product: { id: "p4", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "netral", tanpaLlm: true,
    });
    assert.equal(panggilan, 0, "/api/try tidak boleh memanggil model berbayar");
    assert.ok(hasil.length >= 1 && hasil[0].segments.length >= 3, "naskah template tetap keluar");
  } finally { globalThis.fetch = aslinya; }
});

test("LULUS TIPIS: semua dimensi lewat dan total 72-74", async () => {
  const { AMBANG_BORDERLINE, AMBANG_TOTAL } = await import("../lib/script-engine/ide");
  // Kasus nyata yang melahirkan aturan ini (Scarlett, 17 Agu): 7·8·7·7·8·7 = 73.
  const nyata = { scroll_stop: 7, distinctiveness: 8, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 };
  const n = hitungNilai(nyata);
  assert.equal(n.total, 73);
  assert.equal(n.lulus, true);
  assert.equal(n.borderline, true, "harus ditandai tipis, bukan disamakan dengan lulus bersih");
  assert.deepEqual(n.sebabGagal, []);
});

test("LULUS BERSIH tidak ikut ditandai tipis", () => {
  const n = hitungNilai(sempurna);
  assert.equal(n.total, 100);
  assert.equal(n.lulus, true);
  assert.equal(n.borderline, false);
});

test("batas bawah jalur tipis: 72 lulus, di bawahnya tidak", () => {
  // 8·7·7·7·8·7 = 74 (tipis). Turunkan sampai di bawah 72 -> gagal.
  assert.equal(hitungNilai({ scroll_stop: 8, distinctiveness: 7, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 }).borderline, true);
  const pas = { scroll_stop: 7, distinctiveness: 7, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 };
  const n = hitungNilai(pas);
  assert.equal(n.total, 71);
  assert.equal(n.lulus, false, "71 di bawah ambang tipis 72");
  assert.ok(n.sebabGagal[0].includes("ambang 72"), `pesannya harus menyebut ambang yang berlaku: ${n.sebabGagal[0]}`);
});

test("jalur tipis TIDAK membuka celah untuk kelemahan kritis", async () => {
  // Inti aturannya: satu dimensi jeblok tetap menjatuhkan, berapa pun totalnya.
  // Kalau tidak, "total >= 72" akan jadi pintu belakang untuk scroll-stop 4.
  const n = hitungNilai({ ...sempurna, scroll_stop: 4 });
  assert.ok(n.total >= 72, `totalnya ${n.total} — memang masih tinggi`);
  assert.equal(n.lulus, false);
  assert.equal(n.borderline, false);
  assert.ok(n.sebabGagal.some((s) => s.startsWith("scroll_stop")));
  // Pesan totalnya memakai ambang BERSIH, karena dimensinya belum semua lewat.
  const { AMBANG_TOTAL } = await import("../lib/script-engine/ide");
  assert.ok(n.sebabGagal.some((s) => s.includes(`ambang ${AMBANG_TOTAL}`)));
});

test("ide yang lulus TIPIS tetap menulis naskah, dan naskahnya ditandai", async () => {
  const { generateScripts } = await import("../lib/script-engine");
  const tipis = { scroll_stop: 7, distinctiveness: 8, story_pull: 7, payoff: 7, brand_fidelity_plan: 8, nativeness: 7 };
  const promptNaskah: string[] = [];
  const daftar = [
    ideDummy(),
    ideDummy({ mechanic: "absence", one_liner: "Meja rias aku dikosongin satu per satu sampai sisa satu botol" }),
    ideDummy({ mechanic: "stakes", one_liner: "Kalau ini bikin kulitku perih, aku balikin ke toko besok pagi" }),
  ];
  globalThis.fetch = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { system: { text: string }[]; messages: { content: string }[] };
    const sistem = body.system.map((s) => s.text).join("\n");
    if (sistem.includes("You are the FYP gate"))
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ scores: tipis, reason: "alasan uji yang cukup panjang" }) }] }) };
    if (sistem.includes("You invent ONE IDEA"))
      return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ ideas: daftar }) }] }) };
    promptNaskah.push(body.messages[0].content);
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: [
      { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Nah, jerawat aku dulu bandel banget sih",
        start_state: "dia sudah memegang pipinya", framing: "medium", angle: "eye level", camera: "static",
        action: "dia mendekat, lalu menunjuk", product_state: "hidden", expression: "worried",
        audio_note: "", why: "setup", mode: "SELFIE" },
      { block: "BODY", label: "DEMO", start: 4, end: 10,
        // Diperpendek 20 Agu: kalimat lama 13 kata melanggar L-05 (total 24 kata
        // untuk 15 detik) dan S-09 (batas per shot). Dulu itu tidak terlihat
        // karena naskahnya diam-diam jatuh ke template; sejak template tidak
        // lagi disajikan, stub yang melanggar gate membuat tes ini gagal —
        // dan itu benar: yang diuji di sini ide borderline menulis naskah,
        // bukan jalur cadangan.
        text: "aku pakai tiap malam deh, enak banget",
        start_state: "botolnya sudah di tangan", framing: "medium", angle: "eye level", camera: "push in",
        action: "dia memutar botol, lalu memiringkan label", product_state: "partial", expression: "warm",
        audio_note: "", why: "tension", mode: "SELLING" },
      { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "cek keranjang kuning ya",
        start_state: "botolnya sudah terangkat", framing: "tight", angle: "eye level", camera: "static",
        action: "dia menahannya diam, lalu menunjuk", product_state: "hero", expression: "bright",
        audio_note: "", why: "payoff", mode: "SELLING" },
    ] }) }] }) };
  }) as never;
  try {
    const hasil = await generateScripts({
      product: { id: "p5", name: "Scarlett Acne Serum", price_idr: 75000, category: "beauty" },
      register: "bestie", qualityTier: "super_hq", durationSec: 15, count: 1,
    });
    // Naskah DITULIS dari idenya — bedanya dengan gate gagal.
    assert.ok(promptNaskah.some((p) => p.startsWith("THE IDEA")), "lulus tipis tetap menulis naskah dari idenya");
    assert.equal(hasil[0].ideBorderline, true, "naskahnya harus ditandai tipis untuk UI");
    assert.equal(hasil[0].ideSkor, 73);
    assert.equal(hasil[0].ideKandidat, undefined, "bukan kegagalan, jadi tidak menawarkan kandidat lain");
  } finally { globalThis.fetch = aslinya; }
});

test("kandidat dengan format terlarang dijatuhkan di KODE, bukan cuma dilarang di prompt", async () => {
  // Model yang mengabaikan katalog harus tetap gugur. Larangan yang cuma
  // ditulis di prompt bukan larangan.
  const nakal = [
    ideDummy({ format: "giant_figure", one_liner: "Botol setinggi pintu kos berdiri di tengah alun-alun kota" }),
    ideDummy({ mechanic: "absence", format: "couple_sharing_at_home", one_liner: "Aku dan pacarku berhenti beli botol lain" }),
    ideDummy({ mechanic: "stakes", format: "crush_test", one_liner: "Kalau botolnya penyok, aku ganti rugi ke bestie-ku" }),
  ];
  stubModel(nakal, [sempurna]);
  try {
    // hookLevel normal: giant_figure (CGI) dan couple (dua orang) harus gugur.
    const hasil = await pilihIde({ ...permintaan, hookLevel: "normal" });
    const format = hasil.peringkat.map((p) => p.ide.format);
    assert.ok(!format.includes("giant_figure"), `giant_figure lolos di level normal: ${format.join(", ")}`);
    assert.ok(!format.includes("couple_sharing_at_home"), `format dua-orang lolos: ${format.join(", ")}`);
    assert.ok(format.includes("crush_test"), "format yang sah harus tetap lolos");
  } finally { globalThis.fetch = aslinya; }
});

test("dedup memakai PASANGAN mekanik+format, bukan mekanik saja", async () => {
  // forbidden x mystery_box dan forbidden x mess_to_fresh adalah dua ide
  // berbeda; membuang yang kedua akan membuang ide yang sah.
  const dua = [
    ideDummy({ format: "mystery_box" }),
    ideDummy({ format: "mess_to_fresh", one_liner: "Adik ngumpetin botol itu di rak paling atas kamar mandi" }),
    ideDummy({ format: "mystery_box", one_liner: "Kotak itu digoyang adik sebelum kakaknya pulang kerja" }),
  ];
  stubModel(dua, [sempurna]);
  try {
    const hasil = await pilihIde(permintaan);
    const pasangan = hasil.peringkat.map((p) => `${p.ide.mechanic}|${p.ide.format}`);
    assert.equal(new Set(pasangan).size, pasangan.length, `pasangan terduplikasi: ${pasangan.join(", ")}`);
    // Mekanik sama dengan format BERBEDA harus tetap hidup.
    assert.ok(pasangan.includes("forbidden|mystery_box"));
    assert.ok(pasangan.includes("forbidden|mess_to_fresh"));
  } finally { globalThis.fetch = aslinya; }
});

test("petunjuk naskah membawa beat, technique, dan cara gagal formatnya", async () => {
  const { petunjukNaskah } = await import("../lib/script-engine/ide");
  const p = petunjukNaskah(ideDummy({ format: "mystery_box" }));
  assert.match(p, /FORMAT: mystery_box/);
  assert.match(p, /BEATS \(follow these durations\)/);
  assert.match(p, /TECHNIQUE:/);
  // Cara gagalnya ikut — itu yang paling sering menyelamatkan formatnya.
  assert.match(p, /THIS FORMAT FAILS WHEN:.*membocorkan isinya/s);

  // Format tanpa wajah menyatakannya eksplisit ke penulis.
  assert.match(petunjukNaskah(ideDummy({ format: "mess_to_fresh" })), /NO FACE/);
  assert.ok(!/NO FACE/.test(petunjukNaskah(ideDummy({ format: "tutorial" }))));
});
