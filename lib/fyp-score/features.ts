// Builder fitur MODEL FYP "by construction": BikinFYP MENYUSUN videonya,
// jadi fitur diketahui dari rencana (segmen skrip, caption timeline, shot plan,
// format) TANPA pipeline ekstraksi (frames/OCR/vision/whisper). Semantik tiap
// field mengikuti analyzers/virality_model.py (load_data/_text_content_features).
//
// Fitur yang TIDAK bisa direncanakan → null (jujur "tidak terukur", kolom
// _missing=1) atau kategori null (semua-nol) — JANGAN ditebak-tebak:
//   pacing_score (metrik vision), setting (render model bisa apa saja),
//   why_shared (label persepsi penonton).
//
// Mapping H1-H16 → label_hook_type DIKONFIRMASI 2026-08-06 oleh pengelola
// model (PLANNABLE_FEATURES.md §D, kontrak v1.1) — dengan satu simplifikasi
// belum diterapkan: H3 (testimoni personal) semestinya direct_claim vs
// storytime tergantung kalimat pembuka template final ("outcome-first" vs
// "narrative-first"), tapi masih di-hardcode ke direct_claim di sini — belum
// per-template. Field lain di tabel = deskriptif langsung, tidak butuh
// percabangan tambahan.

import type { HookCode } from "../config/hooks";
import type { SegmentDraft } from "../script-engine/templates";
import { formatHargaOverlay } from "../script-engine/templates";
import { buildCaptionCards } from "../media/captions";
import type { FeatureValues } from "./model";

// Tier baru (standard/premium/ultra) ikut diterima. Yang diturunkan dari tier
// di sini HANYA satu hal: bersuara atau tidak (lihat `voiced` di bawah) — dan
// ketiganya bersuara, sama seperti high_quality dan super_hq. Jadi menambah
// nilai di sini TIDAK mengubah satu pun fitur yang dipelajari model, dan
// modelVersion tidak perlu naik.
export type FypQualityTier =
  | "silent_caption"
  | "high_quality"
  | "super_hq"
  | "standard"
  | "premium"
  | "ultra";
export type FypVideoFormat = "hands_only" | "vo_broll" | "talking_head";

export interface ScriptPlanInput {
  hookFamily: HookCode;
  segments: SegmentDraft[];
  qualityTier: FypQualityTier;
  durationSec: number;
  format: FypVideoFormat;
  productName: string;
  priceIdr: number;
}

/** H1..H16 → label_hook_type model (vocab ckpt9: before_after, challenge,
 * direct_claim, other, pov, question, shock, storytime). PROPOSED (lihat header). */
export const HOOK_FAMILY_TO_MODEL_HOOK_TYPE: Record<HookCode, string> = {
  H1: "shock", // harga/value shock
  H2: "question", // problem-agitation, hook berbentuk pertanyaan
  H3: "direct_claim", // testimoni personal
  H4: "question", // social proof, dibingkai pertanyaan
  H5: "direct_claim", // peringatan/negatif
  H6: "other", // curiosity gap — tak ada di vocab
  H7: "other", // insider stat
  H8: "other", // call-out audiens
  H9: "question", // perbandingan, dibingkai pertanyaan
  H10: "direct_claim", // FOMO/urgensi jujur
  H11: "before_after", // transformasi
  H12: "direct_claim", // manfaat/praktis
  H13: "question", // identitas, ditutup "sepakat nggak?"
  H14: "other", // rahasia/spill
  H15: "question", // pertanyaan/relate
  H16: "storytime", // penyesalan
};

/** Format render → label_format model. PROPOSED: hands_only = demo pemakaian
 * produk → paling dekat "tutorial"; vo_broll tak punya padanan → "other". */
const FORMAT_TO_MODEL_FORMAT: Record<FypVideoFormat, string> = {
  hands_only: "tutorial",
  talking_head: "talking_head",
  vo_broll: "other",
};

/** hands_only di-prompt "close-up POV"; talking_head selfie dada-ke-atas ≈ medium. */
const FORMAT_TO_SHOT_TYPE: Record<FypVideoFormat, string | null> = {
  hands_only: "closeup",
  talking_head: "medium",
  vo_broll: null,
};

// Kata kunci identik dengan _PRICE_WORDS/_CTA_WORDS Python — cek SUBSTRING
// (perilaku `in` Python), bukan word-boundary.
const PRICE_WORDS = ["rp", "harga", "diskon", "gratis", "promo", "murah", "off"];
const CTA_WORDS = ["link", "klik", "order", "beli", "chat", "checkout", "keranjang", "bio"];

// Watermark AIGC dibakar compositor di SEMUA mode sepanjang video (aturan keras #4)
// → tiap frame selalu punya teks terbaca: coverage teks = 1, transisi on/off = 0,
// teks muncul sejak detik 0. Konsisten dengan cara pipeline model mengukur video
// jadi (OCR per frame mendeteksi teks apa pun, termasuk watermark).
const WATERMARK_TEXT = "Dibuat dengan AI";

/** Jendela "hook" frame-series model = detik-detik awal video; pakai 3 dtk tetap
 * (konsisten lintas durasi, sama dengan definisi fitur *_first_3s). */
const HOOK_WINDOW_SEC = 3;

function hasAny(text: string, words: string[]): boolean {
  return words.some((w) => text.includes(w));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Bangun nilai fitur model dari rencana video S4 (pre-render). */
export function buildPlanFeatures(input: ScriptPlanInput): FeatureValues {
  const { segments, qualityTier, durationSec, format } = input;
  const voiced = qualityTier !== "silent_caption";

  // Shot plan — formula identik planShots() (lib/media/shot-planner.ts):
  // 2 shot baseline, +1 tiap 15 dtk. Cut = sambungan antar shot.
  const numShots = Math.max(2, Math.ceil(durationSec / 15));
  const totalCuts = numShots - 1;
  const avgShotDuration = durationSec / numShots;
  // Shot pertama >= 5 dtk di semua konfigurasi → tidak pernah ada cut di 3 dtk pertama.
  const cutsInFirst3s = 0;

  const ctaSeg = segments.find((s) => s.role === "cta");
  const hookSeg = segments.find((s) => s.role === "hook"); // selalu ada, start=0 (templates.ts)
  const fullText = segments.map((s) => s.text).join(" ");

  // Teks di layar: silent = caption cards + watermark; bersuara = overlay harga
  // (compositor priceText saat demo) + watermark.
  const ocrParts: string[] = [WATERMARK_TEXT, formatHargaOverlay(input.priceIdr)];
  if (!voiced) {
    for (const card of buildCaptionCards({ segments, productName: input.productName })) {
      ocrParts.push(card.text);
    }
  }
  const ocrText = ocrParts.join(" ").toLowerCase();

  // Transcript = yang DIUCAPKAN. Tier silent tidak punya suara → null (missing),
  // sama seperti video tanpa transcript di data latih.
  const transcript = voiced ? fullText.toLowerCase() : null;

  return {
    // --- Kategorikal (null / tak dikenal → semua-nol untuk field itu) ---
    label_hook_type: HOOK_FAMILY_TO_MODEL_HOOK_TYPE[input.hookFamily],
    label_format: FORMAT_TO_MODEL_FORMAT[format],
    // Template kami: produk & payoff langsung di demo setelah hook pendek.
    label_narrative: "instant_payoff",
    // Seluruh mesin skrip wajib partikel+filler gaul (validator L-01/L-04).
    label_local_element: "bahasa_gaul",
    text_language_style: "gaul",
    setting: null, // tidak dikendalikan prompt — jangan ditebak
    dominant_shot_type: FORMAT_TO_SHOT_TYPE[format],
    why_shared: null, // persepsi penonton — tidak bisa direncanakan

    // --- Struktur editing ---
    duration_sec: durationSec,
    total_cuts: totalCuts,
    cuts_per_sec: totalCuts / durationSec,
    avg_shot_duration: avgShotDuration,
    cuts_in_first_3s: cutsInFirst3s,
    pacing_score: null, // metrik vision — tidak terukur pre-render

    // --- Teks di layar (watermark selalu ada — lihat catatan WATERMARK_TEXT) ---
    has_text_overlay: 1,
    text_appears_at_sec: 0,
    hook_text_coverage_pct: 1,
    full_text_coverage_pct: 1,
    hook_text_transitions: 0,
    full_text_transitions: 0,

    // --- Manusia & produk ---
    face_in_first_3s: format === "talking_head" ? 1 : 0,
    face_count_avg: format === "talking_head" ? 1 : 0,
    product_visible: 1, // shot 1 selalu "presenting product to camera"
    product_first_appears_sec: 0,

    // --- Audio ---
    has_cta_in_audio: voiced && ctaSeg ? 1 : 0,
    cta_timing_sec: voiced && ctaSeg ? ctaSeg.start : null,
    has_trending_sound: 0, // musik = bg-loop berlisensi, bukan trending sound
    label_hook_layered: !voiced && durationSec > 15 ? 1 : 0, // snapback di jendela hook (templates v1.2)

    // --- Hook Trinity (ckpt16, r-model-2.0 2026-08-11) — 3 kanal independen,
    // dinilai HANYA 3 detik pertama (definisi persis: analyzers/ai_labeler.py
    // PROMPT). BikinFYP mengendalikan ketiga kanal terpisah (shot prompt /
    // caption plan / dialog hook), jadi PLANNABLE per PLANNABLE_FEATURES.md
    // §A — tapi hanya diisi non-null saat kita punya sinyal nyata, bukan
    // ditebak (prinsip §1: "jangan pernah menebak nilainya").
    //
    // verbal: hook segment SELALU ditulis sebagai hook (H1-H16 taxonomy) dan
    // hanya benar-benar terdengar bila tier bersuara (silent = no audio track
    // sama sekali → deterministically false, bukan "tidak terukur").
    label_hook_verbal: hookSeg ? (voiced ? 1 : 0) : null,
    // text: silent tier menampilkan caption card hook sebagai headline di
    // layar (fungsi hook, sesuai definisi) — voiced tier TIDAK menampilkan
    // teks hook (cuma overlay harga saat demo + watermark, bukan headline).
    label_hook_text: voiced ? 0 : 1,
    // visual: hanya diberi nilai (false) untuk kasus yang persis cocok contoh
    // negatif resmi ("ordinary framing of a person starting to talk" —
    // talking_head shot 1 kita memang persis itu). Format lain (hands_only/
    // vo_broll) ambigu terhadap definisi "deliberate visual attention
    // device" dengan shot-planner saat ini → dibiarkan null, bukan ditebak.
    label_hook_visual: format === "talking_head" ? 0 : null,

    // --- Konten teks (semantik _text_content_features Python) ---
    transcript_word_count: transcript ? wordCount(transcript) : null,
    transcript_has_question: transcript ? (transcript.includes("?") ? 1 : 0) : null,
    transcript_has_price_mention: transcript ? (hasAny(transcript, PRICE_WORDS) ? 1 : 0) : null,
    ocr_word_count: wordCount(ocrText),
    ocr_has_price_mention: hasAny(ocrText, PRICE_WORDS) ? 1 : 0,
    ocr_has_cta_word: hasAny(ocrText, CTA_WORDS) ? 1 : 0,
  };
}
