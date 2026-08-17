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
import { config } from "../config";
import {
  AKU_TOKENS, FILLER_PHRASES, FILLER_TOKENS, GUE_TOKENS, KAMU_TOKENS, LO_TOKENS,
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
  mode: z.string().min(2),
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
export function blokAturan(): string {
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
  const sasaran = Math.max(r.wordMin, Math.round((r.wordMin + r.wordMax) / 2) - 1);
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
    // L-16.
    r.register === "genz"
      ? `PRONOUNS — this register uses ${gue}. Never use ${aku}. Never mix the two families.`
      : `PRONOUNS — this register uses ${aku}. Never use ${gue}. Never mix the two families.`,
  ].join("\n");
}

function blokTugas(r: PermintaanNaskah): string {
  const jumlah = r.durationSec <= 15 ? 3 : r.durationSec <= 20 ? 4 : r.durationSec <= 30 ? 5 : 6;
  const cta =
    r.contentType === "ads"
      ? `The CTA line must be exactly: "Detailnya ada di bawah ya". No on-screen text anywhere.`
      : `The CTA line must be spoken and must contain "${r.cartLabel}".`;
  const perbaikan = r.keluhan?.length
    ? [
        "",
        "THIS IS A REPAIR. Your previous script was rejected by the validator for exactly these reasons:",
        ...r.keluhan.map((k) => `  - ${k}`),
        "Fix every one of them. Keep whatever was already working; do not rewrite the idea from scratch.",
      ].join("\n")
    : "";
  return [
    `PRODUCT: ${r.productName} (${r.productCategory}), price ${r.priceIdr} rupiah — write it as words if spoken.`,
    `DURATION: ${r.durationSec} seconds, exactly ${jumlah} segments.`,
    `CONTENT TYPE: ${r.contentType}. ${cta}`,
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
      { type: "text", text: blokAturan(), cache_control: { type: "ephemeral" } },
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
    visual_direction: `${x.framing}, ${x.angle}. ${x.camera}. ${x.action}`,
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
