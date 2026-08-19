/**
 * IDEA STAGE + FYP GATE (PATCH 4, STEP 3).
 *
 * Gerbang ketiga dari standar produk. Gate 1 menjaga kesetiaan merek, Gate 2
 * menjaga video tidak terlihat AI-slop — keduanya NEGATIF: mereka melarang.
 * Gate 3 satu-satunya yang bertanya "kenapa orang berhenti scroll?".
 *
 * Urutannya penting dan sengaja dibalik dari pipeline lama: ide dipilih SEBELUM
 * format dan mode. Format adalah KONSEKUENSI ide, bukan pilihan awal. Memilih
 * format duluan berarti idenya harus muat ke cetakan yang sudah ada — dan itu
 * persis bagaimana kita sampai pada 33 template yang semuanya terasa sama.
 *
 * Modelnya kelas atas dan dipanggil SEKALI per naskah/batch, bukan per varian:
 * ide adalah keputusan paling menentukan di seluruh pipeline dan paling jarang
 * diulang, jadi di sinilah anggaran model paling layak dibelanjakan.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../config";
import {
  ideGenerik, situasiManusiawi, urutkanMekanik,
  BATAS_NATIVENESS_CGI, KATEGORI_JENUH, LEVEL_TONTONAN, MEKANIK_BUTUH_CGI, MEKANIK_BY_ID,
  type IdMekanik,
} from "./idea-mechanics";
import { LlmTidakTersedia, ambilObjekJson } from "./llm";
import { bolehPasangan, formatById, formatTersedia, muatPrior, ringkasUntukPrompt } from "./format-katalog";
import { nilaiBarisIde, skor12, ujiCepatGenre, ujiTukarProduk, type Skor12 } from "./standar-10";
import { blokMaster, blokStandar } from "./standar-10-teks";
import { periksaPemicu } from "../media/pemicu-filter";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSI_API = "2023-06-01";

export const SkemaIde = z.object({
  one_liner: z.string().min(10).max(160),
  /**
   * Situasi MANUSIA tempat ide ini berdiri: orang, momen, atau ketegangan
   * sosial — bukan benda.
   *
   * Wajib, dan itu koreksi berdasar bukti. Jalankan Scarlett 17 Agu
   * menghasilkan sepuluh kandidat yang SEMUANYA tentang bendanya: botol,
   * tetesan, pipet, harga. Skor distinctiveness-nya 3-6 semua, dan jurinya
   * mengulang kalimat yang sama — "bisa ditiru siapa pun besok". Memang bisa:
   * kompetitor punya botol juga. Yang tidak bisa mereka tiru adalah momen
   * manusianya.
   */
  human_situation: z.string().min(15),
  mechanic: z.string().min(3),
  /**
   * Format produksi dari katalog (knowledge/formats). Kandidat sekarang adalah
   * PASANGAN mekanik x format, bukan mekanik saja — mekanik menjawab "kenapa
   * ditonton", format menjawab "bagaimana direkam", dan ide yang punya satu
   * tanpa yang lain selalu berakhir jadi salah satu dari dua kegagalan: ide
   * bagus yang tidak bisa diproduksi, atau produksi rapi tanpa alasan ditonton.
   */
  format: z.string().min(3),
  hook_device: z.string().min(3),
  hook_level: z.string().min(2),
  why_stop: z.string().min(10),
  story: z.object({
    setup: z.string().min(5),
    tension: z.string().min(5),
    payoff: z.string().min(5),
  }),
  product_role: z.string().min(5),
  claim_safety: z.string().min(5),
  suggested_mode: z.string().min(3),
  suggested_format: z.string().min(3),
  brand_fidelity_plan: z.string().min(10),
  risk: z.string().min(5),
});
export type Ide = z.infer<typeof SkemaIde>;

/** min(1): gelombang paralel hanya meminta 1-2 ide, bukan lima sekaligus. */
export const SkemaDaftarIde = z.object({ ideas: z.array(SkemaIde).min(1).max(8) });

/** Bobot dan ambang FYP Gate — PATCH 4 §6, angkanya milik Brian. */
export const DIMENSI_FYP = [
  { id: "scroll_stop", bobot: 30, ambang: 7, tanya: "Kalau ini muncul di antara 20 video sejenis, apakah kamu berhenti di detik pertama? Kenapa?" },
  { id: "distinctiveness", bobot: 20, ambang: 7, tanya: "Bisa dibedakan dari 100 video kompetitor? Apa yang tidak bisa mereka tiru besok?" },
  { id: "story_pull", bobot: 20, ambang: 7, tanya: "Ada pertanyaan yang belum terjawab sampai detik terakhir?" },
  { id: "payoff", bobot: 10, ambang: 7, tanya: "Ada satu momen yang terasa worth it? Produknya terlibat di momen itu?" },
  { id: "brand_fidelity_plan", bobot: 10, ambang: 8, tanya: "Label terbaca di minimal dua titik, hero statis minimal satu detik, peran produk tidak berubah?" },
  { id: "nativeness", bobot: 10, ambang: 7, tanya: "Terasa direkam spontan, bukan dirakit?" },
] as const;

export type IdDimensi = (typeof DIMENSI_FYP)[number]["id"];

export const SkemaNilai = z.object({
  scores: z.record(z.string(), z.number().min(0).max(10)),
  reason: z.string().min(10),
});

/** Ambang total untuk LULUS BERSIH. */
export const AMBANG_TOTAL = 75;

/**
 * Ambang total untuk LULUS TIPIS (borderline), dan syaratnya lebih keras dari
 * sekadar angka: SELURUH enam dimensi harus sudah lewat ambangnya
 * masing-masing.
 *
 * Kenapa ada. Jalankan Scarlett 17 Agu menghasilkan ide bernilai 73 yang gagal
 * HANYA di total — keenam dimensinya sudah lewat (7·8·7·7·8·7). Menolaknya
 * berarti membuang ide yang tidak punya satu pun kelemahan kritis, hanya
 * karena tidak ada satu pun dimensi yang menonjol. Itu bukan yang dijaga
 * ambang 75.
 *
 * Yang TETAP dijaga: satu dimensi di bawah ambangnya tetap menjatuhkan, berapa
 * pun totalnya. Kelemahan kritis tidak bisa dirata-ratakan sampai hilang, dan
 * jalur tipis ini tidak membuka celah untuk itu — ia hanya melonggarkan syarat
 * "harus ada yang menonjol", bukan syarat "tidak boleh ada yang jeblok".
 */
export const AMBANG_BORDERLINE = 72;

export interface HasilNilai {
  total: number;
  perDimensi: Record<string, number>;
  lulus: boolean;
  /**
   * Lulus lewat jalur TIPIS: semua dimensi lewat ambangnya, total 72-74.
   *
   * Wajib ikut sampai UI dan catatan. Lulus tipis dan lulus bersih adalah dua
   * keadaan berbeda, dan menyamakannya di layar berarti pengguna tidak pernah
   * tahu bahwa idenya lolos karena tidak ada cacat — bukan karena ada yang
   * kuat.
   */
  borderline: boolean;
  /** Kenapa gagal, siap dibaca manusia. Kosong kalau lulus. */
  sebabGagal: string[];
  alasan: string;
}

/**
 * Hitung total berbobot dan tentukan lolos.
 *
 * DUA syarat, bukan satu. Total >= 75 saja tidak cukup: satu dimensi boleh
 * jeblok sementara bobot besar menutupinya, dan itu persis cara "scroll-stop 4"
 * bisa lolos dengan brand fidelity 10. Ambang per dimensi ada supaya kelemahan
 * kritis tidak bisa dirata-ratakan sampai hilang.
 */
export function hitungNilai(scores: Record<string, number>, alasan = ""): HasilNilai {
  const perDimensi: Record<string, number> = {};
  let total = 0;
  const sebabGagal: string[] = [];
  for (const d of DIMENSI_FYP) {
    // Dimensi yang tidak dinilai dianggap NOL, bukan diabaikan. Penilai yang
    // melewatkan satu dimensi tidak boleh menghasilkan skor yang terlihat baik.
    const n = Number.isFinite(scores[d.id]) ? scores[d.id] : 0;
    perDimensi[d.id] = n;
    total += (n * d.bobot) / 10;
    if (n < d.ambang) sebabGagal.push(`${d.id} ${n} (ambang ${d.ambang})`);
  }
  total = Math.round(total * 10) / 10;

  // SYARAT PERTAMA, tidak bisa ditawar: tidak boleh ada dimensi yang jeblok.
  // Kalau ada, totalnya tidak lagi relevan — inilah yang mencegah kelemahan
  // kritis dirata-ratakan sampai hilang.
  const semuaDimensiLulus = sebabGagal.length === 0;
  const bersih = semuaDimensiLulus && total >= AMBANG_TOTAL;
  const tipis = semuaDimensiLulus && !bersih && total >= AMBANG_BORDERLINE;
  if (!bersih && !tipis) {
    sebabGagal.unshift(`total ${total} (ambang ${semuaDimensiLulus ? AMBANG_BORDERLINE : AMBANG_TOTAL})`);
  }
  return { total, perDimensi, lulus: bersih || tipis, borderline: tipis, sebabGagal, alasan };
}

/**
 * Jawaban yang TERPOTONG harus mengaku terpotong.
 *
 * Jalankan pertama 17 Agu: lima ide selengkap ini butuh ~6-8k token, dan batas
 * 4000 memotongnya di tengah ide keempat. Yang muncul ke permukaan cuma
 * "Unterminated string in JSON at position 6163" — pesan yang menuduh format
 * jawaban model padahal batas kitalah yang kekecilan, dan itu mengarahkan
 * pembedahan ke tempat yang salah.
 */
class JawabanTerpotong extends LlmTidakTersedia {
  constructor(maxTokens: number) {
    super(
      `jawaban terpotong di batas ${maxTokens} token — bukan format jawaban yang salah, ` +
        `melainkan batasnya kekecilan untuk jumlah kandidat yang diminta`
    );
    this.name = "JawabanTerpotong";
  }
}

async function panggil(system: string, user: string, maxTokens: number, biaya?: AkumulasiBiaya): Promise<string> {
  if (!config.scriptLlmEnabled || config.anthropicApiKey === "") {
    throw new LlmTidakTersedia("Idea Stage butuh ANTHROPIC_API_KEY dan SCRIPT_LLM aktif");
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": VERSI_API,
    },
    body: JSON.stringify({
      model: config.anthropicModelIdeas,
      max_tokens: maxTokens,
      temperature: 1,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new LlmTidakTersedia(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (biaya) {
    biaya.panggilan += 1;
    biaya.tokenMasuk += data.usage?.input_tokens ?? 0;
    biaya.tokenKeluar += data.usage?.output_tokens ?? 0;
  }
  if (data.stop_reason === "max_tokens") throw new JawabanTerpotong(maxTokens);
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

/**
 * Bolehkah Idea Stage dijalankan untuk permintaan ini?
 *
 * Aturannya sama bentuknya dengan bolehFrameTurunan() di worker, dan sengaja:
 * dua-duanya keputusan BIAYA, bukan keputusan mutu, jadi keduanya berdiri di
 * satu fungsi yang bisa dibaca dan diuji sendiri.
 *
 * Enterprise selalu ikut tanpa melihat tier — jalur itu memang dibayar berbeda.
 */
export function bolehIdeaStage(input: { tier: string; orgId?: string | null }): boolean {
  if (input.orgId) return true;
  return config.ideaStageTiers.includes(input.tier);
}

/** Pemakaian token satu jalankan gate — dipakai mencatat biaya per ide. */
export interface AkumulasiBiaya {
  panggilan: number;
  tokenMasuk: number;
  tokenKeluar: number;
}

export function biayaKosong(): AkumulasiBiaya {
  return { panggilan: 0, tokenMasuk: 0, tokenKeluar: 0 };
}

export interface PermintaanIde {
  productName: string;
  productCategory: string;
  /** Kata benda kategori, mis. "skincare" — dipakai menilai keumuman one-liner. */
  kategoriNoun: string;
  priceIdr: number;
  durationSec: number;
  contentType: "affiliate" | "ads";
  register: string;
  /** Klaim yang BOLEH disebut. Kosong = tidak ada klaim yang boleh. */
  klaim?: string[];
  /** Mekanik yang sudah dipakai merek ini <30 hari — diturunkan prioritasnya. */
  mekanikBaruDipakai?: IdMekanik[];
  /** Mekanik yang DILARANG di putaran ini (putaran kedua setelah gagal gate). */
  mekanikDilarang?: IdMekanik[];
  /** Format render. Menentukan apakah mekanik ber-CGI masih masuk akal. */
  format?: string;
  /** Level hook. Mekanik ber-CGI hanya milik level tontonan (agak_gila/gila). */
  hookLevel?: string;
  /** Putaran penambal: SEMUA kandidat harus berangkat dari situasi manusia. */
  wajibSemuaManusiawi?: boolean;
  /** Jatah mekanik untuk SATU gelombang paralel — bukan seluruh bank. */
  jatahMekanik?: IdMekanik[];
  /** Berapa ide diminta dari panggilan ini. Kosong = lima (perilaku lama). */
  jumlahDiminta?: number;
}

/**
 * Berapa kandidat per putaran yang WAJIB berangkat dari situasi manusia.
 *
 * Tiga dari lima. Bukan lima dari lima: mekanik yang berangkat dari benda
 * (transformation, time_compression) kadang memang jawaban yang benar, dan
 * melarangnya total akan membuang separuh bank mekanik. Tapi tiga dari lima
 * membalik bawaannya — dan bawaan itulah yang bermasalah, bukan pengecualiannya.
 *
 * Dari jalankan Scarlett 17 Agu: 10 dari 10 kandidat berangkat dari bendanya
 * (botol, tetesan, pipet, harga), dan distinctiveness-nya 3-6 semua.
 */
export const MIN_MANUSIAWI_PER_PUTARAN = 3;

function blokPengetahuan(r: PermintaanIde): string {
  const daftar = urutkanMekanik(r.mekanikBaruDipakai ?? [])
    .filter((m) => !(r.mekanikDilarang ?? []).includes(m.id))
    // Gelombang paralel hanya melihat JATAHNYA. Menyodorkan seluruh bank ke
    // tiap gelombang membuat ketiganya cenderung memilih mekanik terkuat yang
    // sama, dan keragaman yang justru jadi alasan memecahnya ikut hilang.
    .filter((m) => !r.jatahMekanik || r.jatahMekanik.includes(m.id))
    .map((m) => `- ${m.id}: ${m.mekanik} (contoh: ${m.contoh}; cocok: ${m.cocok})`)
    .join("\n");
  // HANYA format yang boleh dipasangkan untuk konteks ini yang disebut. Format
  // ber-CGI di level normal, dan format dua-orang, tidak pernah muncul di
  // daftar — melarang setelah model mengusulkannya berarti membuang panggilan
  // termahal di pipeline untuk kandidat yang sudah pasti gugur.
  const formatBoleh = formatTersedia({ hookLevel: r.hookLevel, productCategory: r.productCategory })
    .map(ringkasUntukPrompt)
    .join("\n");
  const prior = muatPrior().map((p) => `${p.sifat_produk} -> ${p.format}`).join("; ");
  return [
    "You invent ONE IDEA that makes a short-form Indonesian product video worth watching.",
    "",
    "The winning videos in our library are good because each has ONE idea — a handheld fan in a lava field,",
    "an unboxing filmed from INSIDE the box, studio equipment vanishing one by one. The product merely rides",
    "on the idea. They are NOT good because the sentences are tidy.",
    "",
    "MECHANIC BANK — every idea must pick EXACTLY ONE. Listed best-first for this brand:",
    daftar,
    "",
    "FORMAT CATALOGUE — every idea must also pick EXACTLY ONE format. These are production",
    "structures with known beat tables and known ways of failing. Mechanic answers WHY anyone watches;",
    "format answers HOW it is filmed. An idea with only one of the two always fails the same way:",
    "either a good idea nobody can shoot, or a tidy shoot with no reason to watch.",
    formatBoleh,
    r.productCategory ? `    Prior for this product type: ${prior}` : "",
    "",
    "RULES:",
    "- START FROM A HUMAN SITUATION, not from the object.",
    `  At least ${MIN_MANUSIAWI_PER_PUTARAN} of your 5 candidates must begin with a person, a moment, or a social tension —`,
    "  someone hiding something, someone asked a question they cannot answer, someone late, someone caught.",
    "  The product only TAGS ALONG in those. A competitor also owns a bottle; they do not own your moment.",
    "  Ideas that begin with the object (the bottle, the drop, the pipette, the price) all score alike and",
    "  all get the same verdict: anyone could copy this tomorrow.",
    "- Pick exactly one mechanic AND exactly one format. Do not invent format names —",
    "  use an id from the catalogue above, exactly as written.",
    "- Different candidates should not all share the same format. Two candidates with the same",
    "  mechanic AND the same format are one idea written twice.",
    "- The one_liner must be ONE sentence of AT MOST 160 characters. Count them.",
    "  If the idea does not fit in 160 characters, the idea is not found yet — that compression IS the test.",
    "  Put the staging detail in story/brand_fidelity_plan, not in the one_liner.",
    "- An idea whose one_liner would work for a different product unchanged is GENERIC and will be thrown away.",
    "- Each of the five candidates must use a DIFFERENT mechanic.",
    "- story must be a real setup -> tension -> payoff. Tension means a question the viewer cannot answer yet.",
    "- brand_fidelity_plan must name at least TWO moments where the label is readable, one of them a static hero.",
    "- Never invent claims. Only what is visible on camera or clearly subjective.",
    "- human_situation: one line naming WHO is in the scene and what is happening to them, in Indonesian.",
    "  If you cannot fill it without describing the product, the idea started from the wrong end.",
    "- Write one_liner, why_stop, story and product_role in Indonesian. Everything else in English.",
    "",
    blokStandar(),
    "",
    // MASTER genre (slice 1, 19 Agu) — ide harus lahir di kamar yang benar,
    // dan "uji kamar" ada di seksi ini.
    blokMaster(r.contentType),
    "",
    "OUTPUT SHAPE — exact field names, no others:",
    '{"ideas":[{"one_liner":"","human_situation":"","mechanic":"","format":"","hook_device":"","hook_level":"",',
    '"why_stop":"","story":{"setup":"","tension":"","payoff":""},"product_role":"","claim_safety":"",',
    '"suggested_mode":"","suggested_format":"","brand_fidelity_plan":"","risk":""}]}',
  ].join("\n");
}

function blokTugasIde(r: PermintaanIde): string {
  const jenuh = KATEGORI_JENUH.has(r.productCategory);
  // GENRE MENGUBAH RUANG IDENYA, bukan cuma CTA-nya (STANDAR 10/10 §A).
  //
  // Affiliate menjual "aku beli/pakai ini" — yang menang social proof dan
  // kejadian pribadi. Ads menjual satu perasaan yang tahan ditonton berkali-
  // kali sebagai iklan berbayar, dan kata belanja justru merusaknya. Tanpa
  // pembedaan ini, kedua genre menghasilkan kandidat yang sama dan cuma
  // ditempeli CTA berbeda di akhir.
  const ruangIde = r.contentType === "ads"
    ? [
        "GENRE: ADS (paid brand ad, spoken by an ordinary face).",
        "- Sell ONE feeling or situation that stays watchable on the fifth viewing. It runs for days.",
        "- Human situations that repeat well: an odd object in an ordinary place, a small everyday stake,",
        "  a quiet contrast. One joke at most; no hard sell.",
        "- FORBIDDEN in the idea itself: keranjang, checkout, diskon, promo, harga, stok, borong.",
        "  If the idea still works with a 'keranjang kuning' CTA, it is an Affiliate idea wearing an Ads coat.",
      ]
    : [
        "GENRE: AFFILIATE (an affiliator on a personal account).",
        "- Sell social proof plus a personal event: borong, rebutan, dititip, dijaga, kehabisan, disembunyikan.",
        "- The idea MUST contain a personal action by the speaker (beli/pakai/simpan/rebutan/kehabisan).",
        "  An idea with no personal action is an Ads idea in the wrong room.",
      ];
  return [
    `PRODUCT: ${r.productName} (${r.productCategory}), price ${r.priceIdr} rupiah.`,
    `VIDEO: ${r.durationSec} seconds, ${r.contentType}, register ${r.register}.`,
    ...ruangIde,
    r.klaim?.length ? `ALLOWED CLAIMS (nothing beyond these): ${r.klaim.join("; ")}` : "ALLOWED CLAIMS: none.",
    r.wajibSemuaManusiawi
      ? "EVERY candidate this round must start from a human situation. Not one may start from the object."
      : "",
    jenuh
      ? `SATURATED CATEGORY. A plain everyday-complaint hook with no twist is FORBIDDEN as the sole mechanic — the feed is already full of it.`
      : "",
    (r.mekanikDilarang ?? []).length
      ? `FORBIDDEN MECHANICS this round (they already failed the gate): ${(r.mekanikDilarang ?? []).join(", ")}.`
      : "",
    "",
    `Give exactly ${r.jumlahDiminta ?? 5} candidate${(r.jumlahDiminta ?? 5) === 1 ? "" : "s"}, each with a different mechanic. JSON only.`,
  ].filter(Boolean).join("\n");
}

/**
 * Hasilkan kandidat, lalu PASTIKAN kuota situasi manusia terpenuhi.
 *
 * Kalau kurang, diminta SEKALI lagi khusus kandidat manusiawi — bukan seluruh
 * putaran diulang. Membuang kandidat yang sudah ada karena kuotanya kurang
 * berarti membayar panggilan termahal di pipeline lalu membuang hasilnya;
 * menambal kekurangannya jauh lebih murah dan hasilnya sama.
 */
export async function usulkanIdeBerkuota(r: PermintaanIde, biaya?: AkumulasiBiaya): Promise<Ide[]> {
  const awal = await usulkanIde(r, biaya);
  const manusiawi = awal.filter((i) => situasiManusiawi(i.human_situation));
  const kurang = MIN_MANUSIAWI_PER_PUTARAN - manusiawi.length;
  if (kurang <= 0) return awal;

  console.warn(
    `[idea] baru ${manusiawi.length}/${MIN_MANUSIAWI_PER_PUTARAN} kandidat berangkat dari situasi manusia — meminta ${kurang} tambahan`
  );
  try {
    const tambahan = await usulkanIde({
      ...r,
      // Mekanik yang sudah terpakai dilarang, supaya tambahannya benar-benar
      // sudut baru dan bukan tulis-ulang kandidat yang sama.
      mekanikDilarang: [...(r.mekanikDilarang ?? []), ...awal.map((i) => i.mechanic as IdMekanik)],
      wajibSemuaManusiawi: true,
    }, biaya);
    // Disaring DI SINI, bukan sekadar dilarang di prompt. Larangan yang tidak
    // ditegakkan kode bukan larangan: pada uji dengan model yang mengabaikannya,
    // penambalan mengembalikan mekanik yang sama dan peringkatnya berisi
    // "forbidden" dua kali — yaitu satu ide yang dihitung dua kali.
    const sudahAda = new Set(awal.map((i) => `${i.mechanic}|${i.format}`));
    return [
      ...awal,
      ...tambahan.filter((i) => situasiManusiawi(i.human_situation) && !sudahAda.has(`${i.mechanic}|${i.format}`)),
    ];
  } catch (err) {
    // Gagal menambal bukan alasan membuang kandidat yang sudah ada.
    console.warn(`[idea] penambalan kuota manusia gagal, lanjut dengan yang ada: ${(err as Error).message}`);
    return awal;
  }
}

/** Hasilkan kandidat ide, buang yang generik dan yang mekaniknya tidak dikenal. */
/**
 * Bagi pembuatan ide jadi beberapa panggilan PARALEL.
 *
 * Terukur 18 Agu: satu panggilan yang meminta lima ide selengkap spesifikasi
 * menghasilkan ~7k token keluaran, dan di model kelas atas itu sekitar 90
 * detik — dua putaran jadi 214 detik. Yang lama BUKAN penilaiannya (sudah
 * paralel), melainkan mengarang lima ide sekaligus dalam satu aliran.
 *
 * Dipecah jadi beberapa panggilan yang menulis lebih sedikit ide dan berjalan
 * bersamaan. Jumlah idenya sama; yang hilang cuma waktu menunggu.
 *
 * Efek samping yang justru diinginkan: tiap panggilan diberi JATAH MEKANIK
 * berbeda, jadi keragaman mekanik tidak lagi bergantung pada model mengingat
 * apa yang sudah ia tulis di paragraf sebelumnya.
 */
const IDE_PER_PANGGILAN = 2;
const MAKS_GELOMBANG = 3;

export async function usulkanIde(r: PermintaanIde, biaya?: AkumulasiBiaya): Promise<Ide[]> {
  const bank = urutkanMekanik(r.mekanikBaruDipakai ?? [])
    .filter((m) => !(r.mekanikDilarang ?? []).includes(m.id))
    .map((m) => m.id);
  const jatah: IdMekanik[][] = [];
  for (let i = 0; i < bank.length && jatah.length < MAKS_GELOMBANG; i += IDE_PER_PANGGILAN) {
    jatah.push(bank.slice(i, i + IDE_PER_PANGGILAN));
  }
  if (jatah.length <= 1) return usulkanIdeSekali(r, biaya);

  const gelombang = await Promise.all(
    jatah.map((mekanik) =>
      usulkanIdeSekali({ ...r, jatahMekanik: mekanik, jumlahDiminta: mekanik.length }, biaya).catch((err) => {
        // Satu gelombang gagal tidak boleh menjatuhkan sisanya — yang lain
        // sudah dibayar dan hasilnya sah.
        console.warn(`[idea] satu gelombang gagal, dilanjut dengan sisanya: ${(err as Error).message}`);
        return [] as Ide[];
      })
    )
  );
  const gabung = gelombang.flat();
  if (gabung.length === 0) throw new LlmTidakTersedia("semua gelombang pembuat ide gagal");
  // Dedup lintas gelombang: dua gelombang bisa memilih format yang sama.
  const terpakai = new Set<string>();
  return gabung.filter((i) => {
    const k = `${i.mechanic}|${i.format}`;
    if (terpakai.has(k)) return false;
    terpakai.add(k);
    return true;
  });
}

async function usulkanIdeSekali(r: PermintaanIde, biaya?: AkumulasiBiaya): Promise<Ide[]> {
  // Batas token mengikuti jumlah ide yang diminta — panggilan yang menulis dua
  // ide tidak perlu jatah untuk lima. Batas 4000 dulu memotong jawaban di
  // tengah kandidat keempat, jadi jatahnya dihitung per ide, bukan dipukul rata.
  const batas = Math.max(4000, (r.jumlahDiminta ?? 5) * 2600);
  const teks = await panggil(blokPengetahuan(r), blokTugasIde(r), batas, biaya);
  const mentah = JSON.parse(ambilObjekJson(teks)) as { ideas?: unknown[] };
  // Divalidasi SATU PER SATU, bukan sebagai satu daftar.
  //
  // Sekali jalankan menghasilkan lima kandidat; satu di antaranya menulis
  // one_liner 180 karakter dan skema daftar menolak SELURUH batch — empat ide
  // bagus ikut terbuang, dan panggilan model termahal di pipeline dibayar untuk
  // tidak menghasilkan apa pun. Kandidat cacat dijatuhkan sendiri-sendiri.
  const sah: Ide[] = [];
  for (const kandidat of mentah.ideas ?? []) {
    const hasil = SkemaIde.safeParse(kandidat);
    if (hasil.success) sah.push(hasil.data);
    else {
      const soal = hasil.error.issues[0];
      console.warn(`[idea] satu kandidat dijatuhkan: ${soal.path.join(".")} — ${soal.message}`);
    }
  }
  if (sah.length === 0) throw new LlmTidakTersedia("tidak ada kandidat ide yang sesuai skema");
  const terpakai = new Set<string>();
  return sah.filter((ide) => {
    if (!(ide.mechanic in MEKANIK_BY_ID)) return false;
    // Pasangan DITEGAKKAN di kode, bukan cuma diminta di prompt. Model yang
    // mengusulkan giant_figure di level normal, atau format dua-orang, harus
    // gugur di sini — kalau tidak, aturan pemasangannya cuma saran.
    const pasangan = bolehPasangan({
      formatId: ide.format,
      hookLevel: r.hookLevel,
      productCategory: r.productCategory,
    });
    if (!pasangan.boleh) {
      console.warn(`[idea] kandidat dijatuhkan: ${pasangan.sebab}`);
      return false;
    }
    // Yang didedup PASANGANNYA, bukan mekaniknya saja: satu mekanik bisa
    // melahirkan ide berbeda di format berbeda (forbidden x mystery_box tidak
    // sama dengan forbidden x mess_to_fresh), dan membuang yang kedua akan
    // membuang ide yang sah. Yang tidak sah adalah pasangan yang sama persis.
    const pasanganKunci = `${ide.mechanic}|${ide.format}`;
    if (terpakai.has(pasanganKunci)) return false;
    if (ideGenerik(ide.one_liner, { productName: r.productName, kategoriNoun: r.kategoriNoun })) return false;
    // UJI CEPAT §A dan uji tukar produk §B baris 2 DITANDAI, bukan dibuang.
    //
    // Keduanya sudah masuk skor 12 baris (baris 10 dan baris 2), dan baris 2
    // termasuk baris kritis yang menahan nilai di 6 — di bawah ambang gate.
    // Jadi ide yang salah genre tetap tidak akan terpakai, TAPI ia tetap
    // muncul di peringkat: kalau semua kandidat ditandai, pengguna melihat
    // tiga terbaik beserta sebabnya, bukan pesan "tidak ada kandidat sah".
    const genre = ujiCepatGenre({
      contentType: r.contentType,
      one_liner: ide.one_liner,
      human_situation: ide.human_situation,
      mechanic: ide.mechanic,
    });
    if (!genre.lolos) console.warn(`[idea] kandidat DITANDAI: ${genre.sebab.join("; ")}`);
    const tukar = ujiTukarProduk({
      one_liner: ide.one_liner,
      productName: r.productName,
      productCategory: r.productCategory,
    });
    if (!tukar.lolos) console.warn(`[idea] kandidat DITANDAI: ${tukar.sebab}`);
    terpakai.add(pasanganKunci);
    return true;
  });
}

function blokPenilai(): string {
  return [
    "You are the FYP gate. You judge whether a video idea deserves to stop a thumb, by imagining a feed",
    "already full of similar videos in that category. You are not judging politeness or correctness —",
    "other gates already do that, and everything they pass is still forgettable.",
    "",
    "Score each dimension 0-10. Be strict: 7 means 'yes, clearly'. 5 means 'maybe'. Most ideas are 4-6.",
    ...DIMENSI_FYP.map((d) => `- ${d.id}: ${d.tanya}`),
    "",
    'OUTPUT: {"scores":{"scroll_stop":0,"distinctiveness":0,"story_pull":0,"payoff":0,"brand_fidelity_plan":0,"nativeness":0},"reason":"<=40 words"}',
  ].join("\n");
}

/**
 * Turunkan nativeness untuk mekanik yang menuntut CGI di format sehari-hari.
 *
 * Dipasang SETELAH model menilai, bukan sebagai instruksi ke model. Alasannya:
 * ini batas produksi kita, bukan penilaian rasa. Model boleh saja menganggap
 * "kamera di dasar botol" terasa segar — tetap saja kita tidak bisa merekamnya
 * dengan satu talent dan satu HP, dan hasilnya akan terasa dirakit.
 *
 * Batasnya di BAWAH ambang, jadi mekanik ini benar-benar tidak bisa lolos di
 * level normal. Itu memang maksud Brian: mereka milik level tontonan.
 */
export function penaltiCgi(
  ide: Ide,
  konteks: { format?: string; hookLevel?: string }
): { berlaku: boolean; sebab: string } {
  if (!MEKANIK_BUTUH_CGI.has(ide.mechanic as IdMekanik)) return { berlaku: false, sebab: "" };
  if (LEVEL_TONTONAN.has(konteks.hookLevel ?? "normal")) return { berlaku: false, sebab: "" };
  // Format sinematik (tvc) memang dirakit dan penonton tahu itu.
  if (konteks.format === "tvc") return { berlaku: false, sebab: "" };
  return {
    berlaku: true,
    sebab: `mekanik ${ide.mechanic} butuh CGI/kamera mustahil — di format ${konteks.format ?? "sehari-hari"} level ${konteks.hookLevel ?? "normal"} ia tidak bisa terasa spontan`,
  };
}

export async function nilaiIde(
  ide: Ide,
  konteks: { productName: string; productCategory: string; format?: string; hookLevel?: string },
  biaya?: AkumulasiBiaya
): Promise<HasilNilai> {
  const user = [
    `CATEGORY: ${konteks.productCategory}. PRODUCT: ${konteks.productName}.`,
    `IDEA: ${ide.one_liner}`,
    `MECHANIC: ${ide.mechanic} — ${MEKANIK_BY_ID[ide.mechanic as IdMekanik]?.mekanik ?? ide.mechanic}`,
    `WHY IT STOPS: ${ide.why_stop}`,
    `STORY: setup=${ide.story.setup} | tension=${ide.story.tension} | payoff=${ide.story.payoff}`,
    `PRODUCT ROLE: ${ide.product_role}`,
    `BRAND FIDELITY PLAN: ${ide.brand_fidelity_plan}`,
    `RISK: ${ide.risk}`,
    "",
    "JSON only.",
  ].join("\n");
  const teks = await panggil(blokPenilai(), user, 800, biaya);
  const parsed = SkemaNilai.parse(JSON.parse(ambilObjekJson(teks)));
  const cgi = penaltiCgi(ide, konteks);
  const scores = cgi.berlaku
    ? { ...parsed.scores, nativeness: Math.min(parsed.scores.nativeness ?? 0, BATAS_NATIVENESS_CGI) }
    : parsed.scores;
  const alasan = cgi.berlaku ? `${parsed.reason} [nativeness dibatasi: ${cgi.sebab}]` : parsed.reason;
  return hitungNilai(scores, alasan);
}

export interface IdeTerpilih {
  ide: Ide;
  nilai: HasilNilai;
  /** Skor 12 baris STANDAR 10/10 untuk ide terpilih — dicetak di UI dan log. */
  standar: Skor12;
  /** Semua kandidat yang dinilai, urut skor turun — dipakai kalau gate gagal. */
  peringkat: { ide: Ide; nilai: HasilNilai }[];
  putaran: number;
}

/**
 * Jalankan Idea Stage sampai ada ide yang LULUS gate, maksimal dua putaran.
 *
 * Kalau gagal: TIDAK dirender diam-diam. Fungsi ini mengembalikan tiga ide
 * terbaik beserta skornya supaya pemanggil bisa meminta pengguna memilih.
 * Merender ide yang gagal gate sambil pura-pura tidak tahu adalah cara paling
 * cepat mengembalikan kondisi "benar tapi datar" — kali ini dengan bukti
 * tertulis bahwa kita sudah tahu.
 *
 * Dua putaran, bukan lima: putaran kedua sudah tahu mekanik mana yang gagal dan
 * melarangnya. Kalau dua putaran tetap gagal, yang salah biasanya bukan
 * kandidatnya melainkan produknya sedang tidak punya sudut kuat — dan itu
 * keputusan manusia, bukan keputusan yang layak diborong ulang berbayar.
 */
export const MAKS_PUTARAN_IDE = 2;

/**
 * Berapa penilaian boleh berjalan bersamaan.
 *
 * EMPAT. Cukup untuk memotong waktu tunggu sepuluh kandidat jadi tiga
 * gelombang, dan masih jauh di bawah batas laju akun. Angka yang lebih besar
 * memperbaiki waktu makin sedikit sementara risiko 429-nya naik terus — dan
 * satu 429 di tengah menghabiskan lebih banyak waktu daripada yang dihemat.
 */
export const BATAS_PARALEL = 4;

/** Jalankan tugas berbarengan, maksimal `batas` sekaligus, urutan hasil dijaga. */
async function petaTerbatas<T, H>(item: T[], batas: number, tugas: (x: T) => Promise<H>): Promise<H[]> {
  const hasil: H[] = new Array(item.length);
  let berikut = 0;
  const pekerja = Array.from({ length: Math.min(batas, item.length) }, async () => {
    for (;;) {
      const i = berikut++;
      if (i >= item.length) return;
      hasil[i] = await tugas(item[i]);
    }
  });
  await Promise.all(pekerja);
  return hasil;
}

export async function pilihIde(r: PermintaanIde): Promise<IdeTerpilih> {
  // Akumulator dibuat PER PANGGILAN, bukan modul-global: dua permintaan yang
  // berjalan bersamaan di satu proses akan saling mencampur biayanya.
  const biaya = biayaKosong();
  const semua: { ide: Ide; nilai: HasilNilai }[] = [];
  const dilarang = new Set<IdMekanik>(r.mekanikDilarang ?? []);

  for (let putaran = 1; putaran <= MAKS_PUTARAN_IDE; putaran++) {
    const kandidat = await usulkanIdeBerkuota({ ...r, mekanikDilarang: [...dilarang] }, biaya);
    // SEMUA kandidat dinilai, tidak berhenti di yang pertama lulus.
    //
    // Berhenti lebih awal memang lebih murah — dan salah. Peringkatnya dipakai
    // membagi sudut ke tiap varian naskah (varian ke-i dapat ide peringkat
    // ke-i), jadi peringkat yang cuma berisi satu entri membuat tiga varian
    // memakai ide yang sama persis. Itu kembali menjadikan layar "pilih naskah"
    // pilihan palsu, yang justru salah satu sebab keluaran terasa datar.
    //
    // Biayanya wajar: satu panggilan pembuat ide, lalu beberapa panggilan
    // penilai yang pendek (800 token) — bukan lima kali ongkos pembuat ide.
    // PENILAIAN BERBARENGAN, bukan berurutan.
    //
    // Sepuluh kandidat dinilai satu per satu adalah sepuluh bolak-balik
    // jaringan yang saling menunggu tanpa alasan — tiap penilaian berdiri
    // sendiri dan tidak membaca hasil penilaian lain. Terukur pada jalankan
    // Scarlett: 12 panggilan berurutan, dan bagian penilaian itu yang paling
    // lama sekaligus paling mudah diperbaiki.
    //
    // Dibatasi BATAS_PARALEL, bukan dilepas semua: menembakkan sepuluh
    // permintaan sekaligus ke satu akun akan menabrak rate limit persis saat
    // pengguna paling menunggu, dan gagal karena rate limit jauh lebih mahal
    // daripada menunggu satu gelombang.
    const dinilai = await petaTerbatas(kandidat, BATAS_PARALEL, async (ide) => {
      // TIDAK ADA pemeriksaan perangkat retoris di sini, dan itu KOREKSI.
      //
      // Versi pertama menjatuhkan kandidat yang one_liner-nya tidak cocok
      // POLA_PERANGKAT. Salah artefak: POLA_PERANGKAT mengukur bentuk KALIMAT
      // YANG DIUCAPKAN (pertanyaan, negasi, sebut harga, kata ganti orang),
      // sedangkan one_liner adalah DESKRIPSI ide.
      //
      // Akibatnya terukur pada jalankan Scarlett 17 Agu: 4 dari 10 kandidat
      // dibunuh tanpa dinilai, termasuk "Botol setinggi pintu kos" dan "satu
      // botol dioper enam anak kos" — keduanya ide yang justru kuat. Aturan
      // yang membunuh ide bagus karena mengukur benda yang salah lebih
      // berbahaya daripada tidak ada aturan.
      //
      // Tempat aturan ini yang benar adalah validator naskah (L-19), pada teks
      // segmen HOOK yang memang diucapkan. Lihat catatan L-19 di validator.ts.
      const nilai = await nilaiIde(ide, {
        productName: r.productName, productCategory: r.productCategory,
        format: r.format, hookLevel: r.hookLevel,
      }, biaya);
      return { ide, nilai };
    });
    // Mutasi `dilarang` dikumpulkan SESUDAH semua selesai. Menyentuhnya di
    // dalam tugas paralel membuat larangan putaran kedua bergantung pada
    // urutan penyelesaian — yaitu hasil yang berbeda tiap dijalankan.
    for (const d of dinilai) {
      semua.push(d);
      if (!d.nilai.lulus) dilarang.add(d.ide.mechanic as IdMekanik);
    }
    const peringkat = peringkatkan(semua);
    const menang = peringkat.find((p) => p.nilai.lulus);
    if (menang) {
      const hasilMenang: IdeTerpilih = {
        ide: menang.ide, nilai: menang.nilai, peringkat, putaran,
        standar: standarIde(r, menang.ide),
      };
      catat(r, hasilMenang, biaya);
      return hasilMenang;
    }
  }
  const peringkat = peringkatkan(semua);
  if (peringkat.length === 0) throw new LlmTidakTersedia("Idea Stage tidak menghasilkan satu pun kandidat sah");
  const hasil: IdeTerpilih = {
    ide: peringkat[0].ide, nilai: peringkat[0].nilai, peringkat, putaran: MAKS_PUTARAN_IDE,
    standar: standarIde(r, peringkat[0].ide),
  };
  catat(r, hasil, biaya);
  return hasil;
}

/** Nilai 12 baris untuk satu ide, memakai konteks permintaan. */
export function standarIde(r: PermintaanIde, ide: Ide): Skor12 {
  const teks = `${ide.one_liner} ${ide.human_situation} ${ide.story.setup} ${ide.story.tension} ${ide.story.payoff}`;
  const { gagal } = nilaiBarisIde({
    contentType: r.contentType,
    one_liner: ide.one_liner,
    human_situation: ide.human_situation,
    mechanic: ide.mechanic,
    why_stop: ide.why_stop,
    hookLevel: (r.hookLevel ?? "normal") as never,
    productName: r.productName,
    productCategory: r.productCategory,
    pemicu: periksaPemicu(teks, { namaProduk: r.productName }).map((t) => t.cocok),
    claim_safety: ide.claim_safety,
  });
  return skor12(gagal);
}

function catat(r: PermintaanIde, hasil: IdeTerpilih, biaya: AkumulasiBiaya): void {
  catatSkorGate({
    standar: hasil.standar.garis,
    standarNilai: hasil.standar.nilai,
    standarGagal: hasil.standar.gagal.map((g) => g.no),
    productName: r.productName, productCategory: r.productCategory,
    mechanic: hasil.ide.mechanic, total: hasil.nilai.total, lulus: hasil.nilai.lulus,
    borderline: hasil.nilai.borderline,
    perDimensi: hasil.nilai.perDimensi,
    putaran: hasil.putaran, jumlahKandidat: hasil.peringkat.length,
    manusiawi: hasil.peringkat.filter((p) => situasiManusiawi(p.ide.human_situation)).length,
    panggilan: biaya.panggilan,
    tokenMasuk: biaya.tokenMasuk,
    tokenKeluar: biaya.tokenKeluar,
    model: config.anthropicModelIdeas,
    waktu: new Date().toISOString(),
  });
  console.log(
    `[idea] standar 10/10 "${r.productName}": ${hasil.standar.garis} -> nilai ${hasil.standar.nilai}` +
      `${hasil.standar.capKritis ? " (ditahan di 6: baris kritis gagal)" : ""}` +
      `${hasil.standar.gagal.length ? ` · gagal: ${hasil.standar.gagal.map((g) => `#${g.no} ${g.sebab}`).join(" | ")}` : ""}`
  );
  console.log(
    `[idea] gate "${r.productName}": tertinggi ${hasil.nilai.total} (${hasil.ide.mechanic}) · ` +
      `${hasil.nilai.lulus ? (hasil.nilai.borderline ? "LULUS TIPIS" : "LULUS") : "gagal"} · ${hasil.peringkat.length} kandidat, ` +
      `${hasil.peringkat.filter((p) => situasiManusiawi(p.ide.human_situation)).length} berangkat dari situasi manusia · ` +
      `biaya ${biaya.panggilan} panggilan, ${biaya.tokenMasuk} token masuk / ${biaya.tokenKeluar} keluar`
  );
}

function peringkatkan(semua: { ide: Ide; nilai: HasilNilai }[]) {
  return [...semua].sort((a, b) => b.nilai.total - a.nilai.total);
}

/** Ringkas ide jadi petunjuk untuk penulis adegan — inilah yang dilayani naskah. */
export function petunjukNaskah(ide: Ide): string {
  const f = formatById(ide.format);
  return [
    `THE IDEA (every segment must serve it): ${ide.one_liner}`,
    `MECHANIC: ${ide.mechanic}. WHY IT STOPS: ${ide.why_stop}`,
    `STORY — setup: ${ide.story.setup} | tension: ${ide.story.tension} | payoff: ${ide.story.payoff}`,
    `PRODUCT ROLE: ${ide.product_role}`,
    `BRAND FIDELITY PLAN (product_state must follow this): ${ide.brand_fidelity_plan}`,
    `MODE: ${ide.suggested_mode}`,
    ...(f
      ? [
          `FORMAT: ${f.id} (${f.nama}) — ${f.kekuatan}`,
          `BEATS (follow these durations): ${f.beat_table.map((b) => `${b.durasi}s ${b.isi}`).join(" | ")}`,
          `TECHNIQUE: ${f.technique}`,
          `THIS FORMAT FAILS WHEN: ${f.failure_mode}`,
          ...(f.no_face_recommended ? ["NO FACE: this format works hands-only. Write it that way."] : []),
        ]
      : []),
    `Each segment's "why" must name which of setup/tension/payoff it serves, in THIS story.`,
  ].join("\n");
}

/**
 * Catat skor tertinggi tiap jalankan gate.
 *
 * Ambang 75 TIDAK diturunkan (keputusan Brian 17 Agu), dan justru karena itu
 * angkanya harus dikumpulkan: kalau setelah 20+ produk tidak ada yang pernah
 * mendekati 75, yang perlu ditinjau adalah penilainya atau bank mekaniknya —
 * bukan ambangnya. Tanpa catatan, peninjauan itu cuma jadi soal ingatan.
 *
 * JSONL di storage, bukan tabel: ini catatan penelitian, bukan bagian produk,
 * dan kegagalan menulisnya tidak boleh menggagalkan apa pun.
 */
export function catatSkorGate(baris: {
  /** Garis "9/12 baris standar" — STANDAR 10/10. */
  standar?: string;
  standarNilai?: number;
  standarGagal?: number[];
  productName: string;
  productCategory: string;
  mechanic: string;
  total: number;
  lulus: boolean;
  borderline: boolean;
  /** Skor per dimensi. Tanpa ini, tinjauan 20-produk cuma melihat total —
   *  padahal yang menentukan justru dimensi mana yang jeblok. */
  perDimensi: Record<string, number>;
  putaran: number;
  jumlahKandidat: number;
  manusiawi: number;
  /** Biaya jalankan ini: berapa panggilan model dan berapa token. */
  panggilan: number;
  tokenMasuk: number;
  tokenKeluar: number;
  model: string;
  waktu: string;
}): void {
  try {
    const file = path.join(config.storageDir, "fyp-gate-log.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(baris) + "\n");
  } catch (err) {
    console.warn(`[idea] skor gate gagal dicatat (diabaikan): ${(err as Error).message}`);
  }
}
