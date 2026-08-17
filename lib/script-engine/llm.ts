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
  return config.anthropicApiKey !== "";
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
    "- Total spoken words <= 1.5 x total seconds. Per segment <= 10 words.",
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
  ].join("\n");
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
}

function blokTugas(r: PermintaanNaskah): string {
  const jumlah = r.durationSec <= 15 ? 3 : r.durationSec <= 20 ? 4 : r.durationSec <= 30 ? 5 : 6;
  const cta =
    r.contentType === "ads"
      ? `The CTA line must be exactly: "Detailnya ada di bawah ya". No on-screen text anywhere.`
      : `The CTA line must be spoken and must contain "${r.cartLabel}".`;
  return [
    `PRODUCT: ${r.productName} (${r.productCategory}), price ${r.priceIdr} rupiah — write it as words if spoken.`,
    `DURATION: ${r.durationSec} seconds, exactly ${jumlah} segments.`,
    `CONTENT TYPE: ${r.contentType}. ${cta}`,
    `REGISTER: ${r.register}. Keep pronouns consistent across all segments.`,
    `STRATEGY HINTS (these shape the angle, they are not lines to copy):`,
    `  hook family ${r.hookFamily}, hook level ${r.hookLevel}, format ${r.format}.`,
    r.contoh ? `TONE EXAMPLE (imitate the register and rhythm, never the words):\n${r.contoh}` : "",
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
      const bersih = teks.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
      return SkemaNaskah.parse(JSON.parse(bersih)).segments;
    } catch (err) {
      galatTerakhir = (err as Error).message.slice(0, 200);
      console.warn(`[llm] keluaran tidak sesuai skema (percobaan ${percobaan + 1}/2): ${galatTerakhir}`);
    }
  }
  throw new LlmTidakTersedia(`keluaran tidak sesuai skema setelah 2 percobaan: ${galatTerakhir}`);
}

/** Ubah segmen LLM jadi SegmentDraft yang dipahami sisa pipeline. */
export function keSegmentDraft(s: SegmenLlm[]): SegmentDraft[] {
  return s.map((x) => ({
    role: x.block === "HOOK" ? "hook" : x.block === "CTA" ? "cta" : "demo",
    start: x.start,
    end: x.end,
    text: x.text,
    visual_direction: `${x.framing}, ${x.angle}. ${x.camera}. ${x.action}`,
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
