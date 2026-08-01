// Shot planner: pecah skrip 15 dtk menjadi 2 shot hands-only (~8 dtk per shot,
// model video umumnya <=12 dtk/klip — SRS T1). Foto produk asli pengguna
// dipakai sebagai image reference (aturan keras).
//
// HANDS-ONLY (fix isu wajah tak diminta): framing eksplisit "hands and forearms
// only, face NOT visible" di prompt SEMUA kategori + negative per-format
// ("no face, no visible face, no head in frame, ...") — menggantikan asumsi
// lama "no face distortion" yang justru menganggap wajah ada.
//
// KONSERVASI IDENTITAS PRODUK (fix produk berganti antar shot): kedua shot
// membawa instruksi identitas eksplisit + deskripsi visual produk opsional
// (product_visual_desc dari user). API ModelArk TIDAK punya parameter image
// strength/weight (diverifikasi di daftar parameter resmi create task) —
// mitigasi lewat prompt + QC-03.
//
// Tier bersuara (audio embedded): dialog diletakkan DALAM tanda kutip, instruksi
// jeda/intonasi DI LUAR tanda kutip, plus arahan "enunciate clearly".

import type { VisualSpec, ShotSpec, QualityTier } from "../providers/types";
import type { CreatorCategory } from "../personas";
import type { SegmentDraft } from "../script-engine/templates";
import { CATEGORY_NOUN, CATEGORY_PAIN } from "../config/hooks";
import { MANDATORY_NEGATIVE_PROMPT } from "../config/compliance";

export interface ShotPlanInput {
  jobId: string;
  durationSec: number;
  segments: SegmentDraft[];
  category: CreatorCategory;
  productName: string;
  productCategory: string;
  /** Deskripsi visual produk dari user (opsional) — memperkuat konsistensi identitas. */
  productVisualDesc?: string | null;
  imageRefPath: string; // foto produk asli (absolut)
  qualityTier: QualityTier;
  format?: "hands_only" | "vo_broll" | "talking_head";
}

const HANDS_ONLY_FRAMING =
  "hands and forearms only, face and body NOT visible, cropped below shoulders, " +
  "close-up POV hands-only shot, camera focused on hands and product";

const HANDS_ONLY_NEGATIVE =
  "no face, no visible face, no head in frame, no person facing camera";

const IDENTITY_INSTRUCTION =
  "the exact same product from the reference image, identical packaging, identical label, " +
  "do not redesign or replace the product";

export function planShots(input: ShotPlanInput): VisualSpec {
  const perShot = input.durationSec / 2;
  const tier = input.qualityTier;
  const withAudio = tier !== "silent_caption";
  const format = input.format ?? "hands_only";

  const segText = (role: string) => input.segments.find((s) => s.role === role)?.text ?? "";
  const noun = CATEGORY_NOUN[input.productCategory] ?? CATEGORY_NOUN.default;
  const pain = CATEGORY_PAIN[input.productCategory] ?? CATEGORY_PAIN.default;

  // Deskripsi produk untuk konsistensi: dari user bila ada, selalu + instruksi identitas.
  const productDesc = input.productVisualDesc?.trim()
    ? `The product is ${input.productVisualDesc.trim()}. `
    : "";

  const shots: ShotSpec[] = [0, 1].map((i) => {
    // Framing larangan wajah DI DEPAN prompt (posisi awal = penekanan lebih kuat).
    const framing = format === "hands_only" ? `${HANDS_ONLY_FRAMING}. ` : "";
    const base =
      `${framing}${input.category.handsPrompt}. Shot ${i + 1} of 2. ${productDesc}` +
      (i === 0
        ? `Hands presenting "${input.productName}" to camera, product label facing camera, gentle rotation, ${IDENTITY_INSTRUCTION}`
        : `Hands demonstrating the product in use, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up texture, natural phone camera movement`);

    if (!withAudio) {
      return { index: i, durationSec: perShot, prompt: base, imageRefPath: input.imageRefPath };
    }

    // Tier bersuara: dialog dalam tanda kutip; jeda & arahan di luar tanda kutip.
    const spoken = i === 0 ? [segText("hook"), segText("demo")] : [segText("cta")];
    const dialogue = spoken.filter(Boolean).join(" ");
    const prompt =
      `${base}. The presenter speaks casually to camera in Indonesian, saying: "${dialogue}". ` +
      (i === 0
        ? `She pauses for a full second, taking a visible breath, before showing the product closer — the pause should be clearly noticeable, not rushed. `
        : `She pauses for a full second, smiles warmly, then ends with a friendly inviting tone — the pause should be clearly noticeable, not rushed. `) +
      `Enunciate clearly the words "${input.productName}" and "${pain.replace(/nya$/, "")}". ` +
      `Natural conversational Indonesian, not a newsreader.`;
    return { index: i, durationSec: perShot, prompt, imageRefPath: input.imageRefPath };
  });

  // Negative prompt per-format: hands_only melarang wajah sepenuhnya (bukan sekadar
  // "no face distortion"); format lain memakai negative kategori apa adanya.
  let negativePrompt = input.category.negativePrompt;
  if (format === "hands_only") {
    negativePrompt = negativePrompt
      .replace(/no face distortion,?\s*/i, "") // kontradiktif untuk hands_only — diganti larangan total
      .replace(/,\s*,/g, ",")
      .trim();
    negativePrompt = `${negativePrompt}, ${HANDS_ONLY_NEGATIVE}`;
  }

  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots,
    negativePrompt, // tetap mengandung MANDATORY_NEGATIVE_PROMPT dari kategori
    qualityTier: tier,
    generateAudio: withAudio, // konsisten dengan tier — ditegakkan juga di registry
  };
}

export { HANDS_ONLY_FRAMING, HANDS_ONLY_NEGATIVE, IDENTITY_INSTRUCTION, MANDATORY_NEGATIVE_PROMPT };
