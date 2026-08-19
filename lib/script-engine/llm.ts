/**
 * Penulis adegan berbasis LLM.
 *
 * Menggantikan langkah renderSegmentsForTier + templateCopy di generateOne().
 * Yang TIDAK diganti: delivery tags, promo, validateScript("strict"), caption,
 * dan penyimpanan — semua itu tetap berlaku penuh, dan validator tetap menjadi
 * gerbang keras. LLM menulis; aturan yang memutuskan.
 *
 * KENAPA. Naskah kita 100% template pengisi, dan itulah sebab "benar tapi
 * datar": kalimatnya aman, strukturnya rapi, dan tidak satu pun bagiannya
 * pernah menjawab "kenapa orang berhenti scroll?". Template tetap dipakai —
 * tapi sebagai PETUNJUK STRATEGI (format, hook family, level, durasi) dan
 * contoh few-shot, bukan sebagai sumber kalimat.
 *
 * JATUH KE TEMPLATE HARUS BERISIK.
 *
 * Kalau kunci tidak ada, mesin kembali ke jalur template — itu perlu, karena
 * produk tidak boleh mati hanya karena satu penyedia. Tapi jatuhnya dicatat
 * keras di log DAN ditandai di hasilnya, karena diam-diam mengirim naskah
 * template adalah persis cara kondisi "datar" bertahan berbulan-bulan tanpa
 * ada yang menyadarinya. Sekali lagi tidak boleh terjadi.
 */
import { z } from "zod";
import { MAKS_KATA_PER_SHOT } from "./standar-10";
import { blokMaster, blokStandar } from "./standar-10-teks";
import { config } from "../config";
import {
  AKU_TOKENS, FILLER_PHRASES, FILLER_TOKENS, GUE_TOKENS, KAMU_TOKENS, LO_TOKENS, PARTICLES,
} from "./validator";
import type { SegmentDraft } from "./templates";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSI_API = "2023-06-01";

/** Satu segmen sebagaimana ditulis LLM. Superset SegmentDraft. */
export const SkemaSegmen = z.object({
  block: z.enum(["HOOK", "BODY", "CTA"]),
  label: z.string().min(1).max(40),
  start: z.number().nonnegative(),
  end: z.number().positive(),
  /** Dialog yang diucapkan. Boleh kosong = beat tanpa suara. */
  text: z.string().max(200),
  start_state: z.string().min(10),
  framing: z.string().min(3),
  angle: z.string().min(3),
  camera: z.string().min(3),
  action: z.string().min(10),
  product_state: z.enum(["hidden", "partial", "hero"]),
  expression: z.string().min(3),
  audio_note: z.string().default(""),
  /** WAJIB merujuk setup/tension/payoff — bukan hiasan. */
  why: z.string().min(5),
  // Opsional dengan bawaan: `mode` cuma metadata tampilan, dan render nyata
  // 18 Agu kehilangan naskah Ads yang sudah benar dua kali berturut-turut
  // hanya karena field ini tidak ditulis. Membuang naskah bagus karena label
  // kosmetik adalah biaya yang dibayar dua kali tanpa dapat apa-apa.
  mode: z.string().default(""),
});

export const SkemaNaskah = z.object({
  segments: z.array(SkemaSegmen).min(3).max(8),
});

export type SegmenLlm = z.infer<typeof SkemaSegmen>;

export class LlmTidakTersedia extends Error {
  constructor(sebab: string) { super(sebab); this.name = "LlmTidakTersedia"; }
}

export function llmSiap(): boolean {
  return config.scriptLlmEnabled && config.anthropicApiKey !== "";
}

/** Dimatikan dengan sengaja (SCRIPT_LLM=0) — bukan kunci yang hilang. */
export function llmSengajaDimatikan(): boolean {
  return !config.scriptLlmEnabled;
}

/**
 * Blok pengetahuan STATIS — sama untuk setiap permintaan, jadi ditandai
 * cache_control supaya tidak dibayar berulang. Ini yang membuat pemanggilan
 * per-varian murah: aturan panjang cukup dikirim sekali per lima menit.
 */
export function blokAturan(contentType: "affiliate" | "ads" = "affiliate"): string {
  return [
    "You write short-form Indonesian UGC ad scripts as production prompts.",
    "",
    "HARD RULES — a script that breaks any of these is rejected by a validator downstream, so do not break them:",
    // Batas kata TIDAK ditulis di sini. Ia bergantung pada tier, durasi, dan
    // panjang nama produk, jadi tempatnya di blok tugas — dan angkanya diambil
    // dari validator lewat jendelaKata(). Versi pertama menaruh "<= 1.5 x
    // detik" di sini, yang BERTENTANGAN dengan jendela sebenarnya (25-30 kata
    // per 15 detik): LLM disuruh menulis lebih pendek daripada yang akan
    // diterima, lalu ditolak L-05 karena kependekan.
    "- Never write prices as digits. Write them as words.",
    "- No medical claims, no whitening, no 'instant', no 'terbaik', no competitor names.",
    "- Only claim what is visible in frame or clearly subjective.",
    "- Never write these words, they are mispronounced by TTS: 'lecet' (use 'luka'), 'tumit' (use 'kaki'),",
    "  'busanya' (use 'lembut banget'). Never write '-nya di' without a buffer: write 'detailnya ada di bawah'.",
    "- No double negatives in one sentence.",
    "- The HOOK must not name the product.",
    "",
    // Penolakan nyata 18 Agu: adegan koridor dengan talent BERPAKAIAN LENGKAP
    // ditolak penyaring penyedia sebagai NSFW. Bukan adegannya yang salah —
    // kosakatanya yang bertetangga dengan adegan terlarang.
    "FILTER SAFETY — the video provider rejects prompts on vocabulary, not intent.",
    "A fully-clothed corridor scene was rejected as NSFW because of the words around it. So:",
    "- Never write: towel, bathrobe, shower, bathing, wet skin/body/hair, undressing, changing clothes.",
    "  Move the action to a sink, a table, a doorway. Describe cloth as 'a folded cloth', not a towel.",
    "- Never put a bathroom door and a second person in the same scene. Keep one person in frame.",
    "- Never write weapons of any kind, including a baton.",
    "- NEVER USE NEGATIONS ABOUT PEOPLE. Not 'no other residents', not 'her face is never sharp',",
    "  not 'she never speaks'. Two reasons: the filter reads the words you wrote, and the video model",
    "  renders what you name — 'no other residents' is how you get other residents.",
    "  Write the positive instead: 'the corridor is empty', 'the camera stays on her hands',",
    "  'she listens quietly'. Say what IS there.",
    "",
    "STRUCTURE:",
    "- Exactly one HOOK first, 1-5 BODY, exactly one CTA last. Timecodes contiguous, no gaps.",
    "- Each segment 4-6 seconds. HOOK 3-5s. CTA >= 4s.",
    "- product_state follows an arc: the hook is 'hidden' or 'partial' and NEVER 'hero'.",
    "  The CTA is always 'hero'. Nothing is a hero before the CTA.",
    "- start_state describes what is ALREADY TRUE in the first frame. The video model moves TOWARD",
    "  the prompt, so anything you do not state as already true will be invented.",
    "- 'why' must say which story beat the segment serves: setup, tension, or payoff.",
    "",
    "WRITE dialogue in casual Indonesian. Write every other field in English.",
    "",
    // STANDAR 10/10 (knowledge/rules/standard-10.md). Disuntikkan UTUH, bukan
    // diringkas: seksi A memutuskan genre idenya dan seksi B adalah 12 baris
    // yang dipakai gerbang untuk menilai. Meringkasnya di sini berarti penulis
    // dinilai dengan aturan yang tidak pernah ia baca — cacat yang sama persis
    // dengan L-05 dulu.
    blokStandar(),
    "",
    // MASTER per genre (slice 1, 19 Agu). Seksi 1 masing-masing dokumen —
    // "apa itu Ads/Affiliate DAN BUKAN", berikut uji kamarnya — dikirim UTUH.
    // Sebelum ini satu-satunya perbedaan genre yang sampai ke penulis adalah
    // kalimat CTA, jadi naskah Ads lahir sebagai naskah afiliasi yang cuma
    // ditukar penutupnya.
    blokMaster(contentType),
    "",
    // Jumlahnya DITURUNKAN dari yang benar-benar menolak keluaranmu (audit A2,
    // 19 Agu). Sebelumnya tertulis "six" lalu hanya empat yang didaftar, dan
    // salah satunya (anomali baris 1) tidak diperiksa apa pun. Klaim yang
    // lebih besar dari kenyataan membuat model — dan pembaca berikutnya —
    // percaya gerbang yang tidak ada.
    "Four of those twelve lines are checked MECHANICALLY and will reject your script:",
    "- line 1 (partly): the first segment must carry a start_state (>=15 chars) and a product_state. The ANOMALY itself is not machine-checked — it is on you.",
    "- line 4: the shot-2 line must be a REASON. Never open it with 'isinya', 'teksturnya', 'kandungannya'.",
    "- line 5: saturated categories (skincare, soap, F&B, toothpaste) demand a bolder hook level.",
    `- line 9: at most ${MAKS_KATA_PER_SHOT} spoken words per shot, on top of the total word window.`,
    "- line 2 is checked BEFORE you write (idea stage), not on your output — but a one-liner that survives a product swap is still a failed idea.",
    "",
    // BENTUK PERSIS. Tanpa ini model mengarang nama field yang masuk akal
    // ("type" bukan "block", "dialogue" bukan "text", "timecode" bukan
    // start/end) dan skema zod menolak keluaran yang sebenarnya bagus.
    // Aturan boleh dijelaskan; BENTUK harus didikte.
    "OUTPUT SHAPE — use these exact field names, no others, no extras:",
    "{",
    '  "segments": [',
    "    {",
    '      "block": "HOOK" | "BODY" | "CTA",',
    '      "label": "<short beat name, e.g. PAIN, DEMO, PROOF, REVEAL>",',
    '      "start": <number, seconds>,',
    '      "end": <number, seconds>,',
    '      "text": "<the spoken line, or \"\" for a silent visual beat>",',
    '      "start_state": "<what is ALREADY true in the first frame>",',
    '      "framing": "<e.g. tight macro, medium selfie>",',
    '      "angle": "<e.g. eye level, slight top-down>",',
    '      "camera": "<e.g. static, slow push in, handheld drift>",',
    '      "action": "<sequenced: ..., then ..., then ...>",',
    '      "product_state": "hidden" | "partial" | "hero",',
    '      "expression": "<visible emotion, or \"not visible\" for hands-only>",',
    '      "audio_note": "<ambient/sound design, may be empty>",',
    '      "why": "<setup | tension | payoff — and one clause saying how>",',
    '      "mode": "<camera+talent mode, e.g. ASMR, SELFIE, SELLING>"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/**
 * Ambil objek JSON PERTAMA yang seimbang dari keluaran model.
 *
 * Membuang pagar ``` saja tidak cukup — dan itu bukan teori. Pada permintaan
 * PERBAIKAN (17 Agu), model menjawab dengan JSON yang benar lalu menempelkan
 * teks lagi sesudahnya; JSON.parse gagal di posisi 1856, permintaan diulang,
 * gagal lagi, dan naskah yang isinya sebenarnya baik dibuang ke template.
 * Kegagalan parse yang lahir dari format jawaban, bukan dari mutu naskah,
 * adalah biaya yang kita bayar dua kali tanpa dapat apa-apa.
 *
 * Kurung dihitung di LUAR string, dan escape di dalam string dihormati —
 * kalau tidak, satu tanda kurung di dalam dialog akan memotong objeknya.
 */
export function ambilObjekJson(teks: string): string {
  const s = teks.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const mulai = s.indexOf("{");
  if (mulai === -1) return s;
  let dalam = 0;
  let diString = false;
  let escape = false;
  for (let i = mulai; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (diString) {
      if (c === "\\") escape = true;
      else if (c === '"') diString = false;
      continue;
    }
    if (c === '"') diString = true;
    else if (c === "{") dalam++;
    else if (c === "}") {
      dalam--;
      if (dalam === 0) return s.slice(mulai, i + 1);
    }
  }
  return s.slice(mulai);
}

interface PermintaanNaskah {
  productName: string;
  productCategory: string;
  priceIdr: number;
  durationSec: number;
  /** "affiliate" | "ads" — mengubah aturan CTA dan overlay. */
  contentType: "affiliate" | "ads";
  /** Token merek — penutup TVC menyebut ini, bukan seluruh nama SKU. */
  merek?: string;
  /** Label keranjang untuk affiliate ("keranjang kuning"/"keranjang oren"). */
  cartLabel: string;
  register: string;
  /** Petunjuk strategi dari template — BUKAN sumber kalimat. */
  hookFamily: string;
  hookLevel: string;
  format: string;
  /** Contoh few-shot dari template-copy, kalau ada. */
  contoh?: string | null;
  /**
   * Jendela kata TOTAL, diambil dari validator lewat jendelaKata() — bukan
   * disalin. Wajib: tanpa ini LLM ditolak L-05 oleh aturan yang tidak pernah
   * diberitahukan kepadanya.
   */
  wordMin: number;
  wordMax: number;
  /**
   * Keluhan validator dari percobaan sebelumnya. Kalau ada, permintaan ini
   * adalah PERBAIKAN, bukan tulisan baru — LLM diberi tahu persis apa yang
   * ditolak, karena menyuruhnya "coba lagi" tanpa alasan cuma mengocok dadu.
   */
  keluhan?: string[];
  /**
   * Petunjuk ide terpilih (Idea Stage, PATCH 4). Kalau ada, INI yang dilayani
   * naskah — bukan template, dan bukan selera penulis.
   *
   * Ditaruh paling depan di blok tugas dengan sengaja: segala yang menyusul
   * (hook family, format, contoh nada) adalah bahan, sementara ide adalah
   * tujuannya. Menaruhnya di akhir membuatnya terbaca sebagai catatan tambahan.
   */
  ide?: string;
}

/**
 * Aturan yang dulu TIDAK pernah sampai ke LLM, lalu dipakai menolaknya.
 *
 * Ketiganya diambil dari validator (jendelaKata, FILLER_TOKENS, token kata
 * ganti), bukan ditulis ulang di sini — kalau disalin, ia akan hanyut dan LLM
 * kembali dinilai dengan aturan yang tidak diberitahukan.
 */
function blokAturanTerukur(r: PermintaanNaskah, jumlahSegmen: number): string {
  const gue = [...GUE_TOKENS, ...LO_TOKENS].join("/");
  const aku = [...AKU_TOKENS, ...KAMU_TOKENS].join("/");
  const filler = [...FILLER_TOKENS, ...FILLER_PHRASES].map((f) => `"${f}"`).join(", ");
  // SASARAN, bukan cuma batas. Terukur 17 Agu: diberi jendela 22-30, model
  // menjawab 31, 33, 34, dan 36 kata berulang kali — ia menulis sampai terasa
  // cukup, lalu menaksir jumlahnya, dan taksirannya meleset ke atas. Diberi
  // satu angka sasaran di tengah jendela plus jatah PER SEGMEN (jauh lebih
  // mudah ditaksir daripada total), lesetnya jatuh di dalam jendela.
  //
  // Sasarannya sedikit di bawah tengah karena lesetnya searah: ke atas.
  // Saat MEMPERBAIKI panjang, sasarannya diturunkan ke dekat batas bawah.
  //
  // Terukur 17 Agu: pada perbaikan, model tetap menjawab 34 lalu 32 kata untuk
  // batas 30 — ia memangkas, tapi kurang jauh. Diberi sasaran di tengah jendela
  // ia meleset ke atas; diberi sasaran dekat batas bawah, lesetnya jatuh di
  // dalam jendela. Ini bukan melonggarkan aturan — batasnya tidak berubah,
  // hanya sasarannya digeser supaya lesetnya mendarat di tempat yang sah.
  const sedangMemperbaikiPanjang = (r.keluhan ?? []).some((k) => /Panjang skrip/i.test(k));
  const sasaran = sedangMemperbaikiPanjang
    ? Math.min(r.wordMax, r.wordMin + 2)
    : Math.max(r.wordMin, Math.round((r.wordMin + r.wordMax) / 2) - 1);
  const perSegmen = Math.max(3, Math.round(sasaran / Math.max(1, jumlahSegmen)));
  return [
    // L-05. Jendelanya SEMPIT dan dua sisi — batas bawah sama mengikatnya
    // dengan batas atas, dan itu yang paling sering dilanggar.
    `WORD COUNT — aim for about ${sasaran} spoken words in TOTAL.`,
    `  Hard limits: no fewer than ${r.wordMin}, no more than ${r.wordMax}. Both sides reject.`,
    `  That is roughly ${perSegmen} words per segment — budget each line before you write it.`,
    `  Short spoken lines. Do not add a clause because it sounds nicer; it will push you over.`,
    // L-04.
    `SPOKEN FILLER — at least one of these must appear somewhere in the dialogue: ${filler}.`,
    `  Without it the voice-over sounds like a robot reading a label.`,
    // L-01. Terlewat di versi pertama, dan itu menjatuhkan naskah yang isinya
    // sudah bagus — persis kesalahan yang sama dengan jendela kata: aturan
    // dipakai menolak tanpa pernah diberitahukan.
    `PARTICLES — at least TWO of these must appear across the dialogue: ${[...PARTICLES].map((p) => `"${p}"`).join(", ")}.`,
    `  Indonesian casual speech leans on them; without two the script reads stiff and written.`,
    // L-16.
    r.register === "genz"
      ? `PRONOUNS — this register uses ${gue}. Never use ${aku}. Never mix the two families.`
      : `PRONOUNS — this register uses ${aku}. Never use ${gue}. Never mix the two families.`,
  ].join("\n");
}

/**
 * Hook uji untuk blokTugas — dipakai tes memastikan instruksi genre benar-benar
 * dikirim ke penulis. Diekspor terpisah supaya blokTugas sendiri tetap privat
 * dan tesnya tidak perlu merakit PermintaanNaskah lengkap hanya untuk membaca
 * satu blok instruksi.
 */
export function blokTugasUntukUji(p: { contentType: "affiliate" | "ads"; durationSec: number }): string {
  return blokTugas({
    productName: "Serum Glow Bening", productCategory: "beauty", priceIdr: 89000,
    durationSec: p.durationSec, contentType: p.contentType, cartLabel: "keranjang kuning",
    register: "netral", hookFamily: "H1", hookLevel: "normal", format: "talking_head",
  } as PermintaanNaskah);
}

function blokTugas(r: PermintaanNaskah): string {
  const jumlah = r.durationSec <= 15 ? 3 : r.durationSec <= 20 ? 4 : r.durationSec <= 30 ? 5 : 6;
  // TIGA genre, bukan dua.
  //
  // Sampai render nyata 18 Agu, TVC tidak punya cabang di sini — jadi penulis
  // diperintahkan menutup dengan "keranjang", lalu ditolak T-02 karena menyebut
  // keranjang. Dua kali berturut-turut, lalu jatuh ke template. Aturan yang
  // kita tegakkan tidak pernah kita sampaikan ke penulisnya.
  const cta =
    r.format === "tvc"
      ? `The CTA line is an announcer sign-off: it MUST name the brand "${r.merek || r.productName}" and MUST NOT mention "keranjang", a cart, a link, or any shopping action. Never stack two negations in one sentence.`
      : r.contentType === "ads"
        ? `The CTA line must be exactly: "Detailnya ada di bawah ya". No on-screen text anywhere.`
        : `The CTA line must be spoken and must contain "${r.cartLabel}".`;
  // STORY OS ADS (slice 2, 19 Agu) — knowledge/rules/STORY-OS-ADS-v1.md.
  //
  // Sampai kini penulis Ads cuma dibedakan oleh kalimat CTA, jadi ia menulis
  // naskah afiliasi yang penutupnya ditukar. Beat di bawah adalah BENTUK yang
  // membedakan iklan berbayar: ditulis Button-first, tekanan naik dua kali,
  // pelampiasan di depan saksi. Yang tidak diberitahukan tidak bisa ditulis —
  // dan gerbang SA menolak naskah yang tidak memakainya.
  const storyOs =
    r.contentType === "ads"
      ? [
          "",
          "STORY OS (Ads only) — write the beats in THIS order, then lay them out in time:",
          "1. BUTTON first (the last 3-6s): one small question left unanswered, and the CTA lives INSIDE it,",
          "   preceded by a story clause. Label this segment BUTTON. Product hero, label readable.",
          "2. SPIKE: the protagonist beats their own pressure IN FRONT OF A WITNESS (a voice off camera is enough:",
          "   petugas, ibu, pewawancara, penghulu, anak). Put it at 65-80% of the duration. Label it SPIKE and",
          '   fill the field "saksi" with who witnesses it.',
          "3. HOOK: the conflict is already in frame 1, with NO dialogue. Label it HOOK.",
          "4. FRICTION (write last): pressure rises at least TWICE between hook and spike. Label each one FRICTION.",
          "   Every friction beat must MOVE something in its action — a position, a decision, an object.",
          "   Enemies that work: your own reflex, time running out, a voice calling you.",
          "BRIDGING — at least TWO of three, and never say the benefit out loud:",
          "  (a) an honest action with the product during friction, (b) the product present in frame 1 without",
          "  being explained, (c) a light admission in the button before the CTA phrase.",
          "BODY IS NOT EXPLANATION: no 'aslinya...', no describing the product, no benefit claims. The viewer concludes.",
        ].join("\n")
      : "";
  const perbaikan = r.keluhan?.length
    ? [
        "",
        "THIS IS A REPAIR. Your previous script was rejected by the validator for exactly these reasons:",
        ...r.keluhan.map((k) => `  - ${k}`),
        "Fix every one of them AT ONCE. This list is cumulative — it includes rules you broke in earlier",
        "attempts, so a fix that satisfies one line while breaking another is not a fix. Count your words",
        "before you answer: the total window and the per-shot limit are both stated above, and they are the",
        "two most common ways this repair fails. Keep whatever was already working; do not rewrite the idea.",
      ].join("\n")
    : "";
  return [
    r.ide ? `${r.ide}\n` : "",
    `PRODUCT: ${r.productName} (${r.productCategory}), price ${r.priceIdr} rupiah — write it as words if spoken.`,
    `DURATION: ${r.durationSec} seconds, exactly ${jumlah} segments.`,
    `CONTENT TYPE: ${r.contentType}. ${cta}`,
    storyOs,
    `REGISTER: ${r.register}.`,
    blokAturanTerukur(r, jumlah),
    `STRATEGY HINTS (these shape the angle, they are not lines to copy):`,
    `  hook family ${r.hookFamily}, hook level ${r.hookLevel}, format ${r.format}.`,
    r.contoh ? `TONE EXAMPLE (imitate the register and rhythm, never the words):\n${r.contoh}` : "",
    perbaikan,
    "",
    "Return JSON only: {\"segments\":[...]}. No prose around it.",
  ].filter(Boolean).join("\n");
}

/**
 * Tulis satu naskah. Melempar LlmTidakTersedia kalau kunci kosong — pemanggil
 * yang memutuskan jatuh ke template, supaya keputusan itu terlihat di satu
 * tempat dan bisa dicatat.
 */
export async function tulisNaskah(r: PermintaanNaskah): Promise<SegmenLlm[]> {
  if (!llmSiap()) throw new LlmTidakTersedia("ANTHROPIC_API_KEY belum di-set");

  const body = {
    model: config.anthropicModelScenes,
    max_tokens: 2000,
    temperature: 1,
    system: [
      // cache_control pada blok STATIS: aturannya panjang dan identik tiap
      // permintaan, jadi tanpa ini kita membayarnya berulang untuk tiap varian.
      //
      // Sejak MASTER genre ikut di sini (slice 1, 19 Agu) blok ini punya DUA
      // bentuk — affiliate dan ads. Cache prefix Anthropic dikunci per teks
      // persis, jadi artinya dua entri cache, bukan cache yang meleset: tiap
      // genre tetap memakai ulang miliknya sendiri.
      { type: "text", text: blokAturan(r.contentType), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: blokTugas(r) }],
  };

  // SEKALI ULANG, dan hanya untuk kegagalan PARSE — bukan untuk galat HTTP.
  // Galat HTTP nyata (401 kunci salah, 400 permintaan cacat) tidak akan sembuh
  // dengan diulang; mengulangnya cuma menggandakan biaya dan menunda kabar
  // buruknya.
  let galatTerakhir = "";
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.anthropicApiKey,
        "anthropic-version": VERSI_API,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      throw new LlmTidakTersedia(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const teks = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    try {
      return SkemaNaskah.parse(JSON.parse(ambilObjekJson(teks))).segments;
    } catch (err) {
      galatTerakhir = (err as Error).message.slice(0, 200);
      console.warn(`[llm] keluaran tidak sesuai skema (percobaan ${percobaan + 1}/2): ${galatTerakhir}`);
    }
  }
  throw new LlmTidakTersedia(`keluaran tidak sesuai skema setelah 2 percobaan: ${galatTerakhir}`);
}

/**
 * Ubah segmen LLM jadi SegmentDraft yang dipahami sisa pipeline.
 *
 * `product_state` IKUT, dan itu bukan kelengkapan data — ia keputusan produksi.
 * Perencana shot memakainya untuk menahan produk di frame pertama. Sebelum ini
 * ia dibuang di sini, jadi LLM menulis "produk belum tampil" lalu shot-nya tetap
 * berangkat dari foto produk: model diberi barang yang diperintahkan
 * disembunyikan. Terlihat di jalankan STEP 2, 17 Agu, segmen 0.
 */
export function keSegmentDraft(s: SegmenLlm[]): SegmentDraft[] {
  return s.map((x) => ({
    role: x.block === "HOOK" ? "hook" : x.block === "CTA" ? "cta" : "demo",
    start: x.start,
    end: x.end,
    text: x.text,
    // Gabungan TETAP dibuat — sisa pipeline (perencana shot, QC, L-21)
    // membacanya. Yang berubah: potongannya ikut disimpan, bukan dibuang.
    visual_direction: `${x.framing}, ${x.angle}. ${x.camera}. ${x.action}`,
    framing: x.framing,
    angle: x.angle,
    camera: x.camera,
    action: x.action,
    expression: x.expression,
    mode: x.mode,
    product_state: x.product_state,
    start_state: x.start_state,
  })) as SegmentDraft[];
}

/**
 * Catat keras saat mesin jatuh ke template.
 *
 * Dipisah jadi fungsi sendiri supaya SATU tempat yang memutuskan bagaimana
 * kabar buruk ini disampaikan — dan supaya ada yang bisa diuji.
 */
export function laporJatuhKeTemplate(sebab: string, konteks: { productName: string }): void {
  console.error(
    `[script-engine] JATUH KE TEMPLATE untuk "${konteks.productName}" — naskah yang keluar adalah ` +
      `template pengisi, BUKAN tulisan LLM. Sebab: ${sebab}. ` +
      `Ini bukan kondisi normal: pasang ANTHROPIC_API_KEY di layanan web.`
  );
}
