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
//
// CATATAN EVIDENSI (2026-08-06, MODEL FYP 1.0 ckpt9-n316): arsitektur 2-shot
// dengan shot panjang + produk tampil sejak detik pertama SEJALAN dengan
// koefisien video pemenang (total_cuts -0.19, avg_shot_duration +0.17,
// product_first_appears_sec -0.18, cuts_in_first_3s -0.09). JANGAN menambah
// jumlah cut/rapid-cut atas nama "pacing" tanpa bukti baru dari model.

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
  /** Foto produk ke-2..5 (absolut) — referensi identitas tambahan untuk model
   * yang mendukung r2v (Seedance 2.0 / tier bersuara). Lihat VisualSpec. */
  extraImageRefPaths?: string[];
  qualityTier: QualityTier;
  format?: "hands_only" | "vo_broll" | "talking_head";
  /** Level hook S3. HANYA "gila" yang mengubah visual: shot 1 dapat pembuka
   * pattern-interrupt PRODUCT-SAFE (gerakan kamera dramatis + produk naik cepat
   * ke tengah frame) — BUKAN adegan bahaya/kacau: aksi ekstrem berisiko kena
   * moderasi platform, merusak konsistensi identitas produk (QC-03), dan
   * silhouette guard QC-02. Berani = teks saja, visual tidak berubah. */
  hookLevel?: "normal" | "berani" | "gila";
}

const HANDS_ONLY_FRAMING =
  "hands and forearms only, face and body NOT visible, cropped below shoulders, " +
  "close-up POV hands-only shot, camera focused on hands and product";

const HANDS_ONLY_NEGATIVE =
  "no face, no visible face, no head in frame, no person facing camera";

// Wajah AI (v1, 2026-08-03): opposite intent of hands_only — face IS the
// point, framed like a normal UGC talking-head selfie, not hands-only POV.
const TALKING_HEAD_FRAMING =
  "face and upper body clearly visible, warm friendly UGC presenter speaking directly to camera, " +
  "front-facing selfie-style angle, natural phone camera look";

const IDENTITY_INSTRUCTION =
  "the exact same product from the reference image, identical packaging, identical label, " +
  "do not redesign or replace the product";

// Pembuka pattern-interrupt level GILA (hanya shot 1). Energi dari GERAKAN
// KAMERA + kecepatan — subjek dan framing format tetap dipatuhi (hands-only
// tetap tanpa wajah, identitas produk tetap terkunci).
const CRAZY_OPENER: Record<"hands_only" | "talking_head", string> = {
  hands_only:
    "HIGH-ENERGY OPENING: the shot starts with a fast dramatic camera push-in as the hands sweep the product " +
    "up into center frame in one quick confident motion, slight playful camera whip, energetic start. ",
  talking_head:
    "HIGH-ENERGY OPENING: the presenter pops into frame with a fast dramatic camera push-in, wide surprised " +
    "expressive reaction, immediately holding the product up to the lens, energetic start. ",
};

export function planShots(input: ShotPlanInput): VisualSpec {
  // Jumlah shot: 2 di baseline 15/30 dtk (PERILAKU LAMA, tidak berubah — sudah
  // teruji di produksi). Di 45 dtk, 2 shot berarti 22,5 dtk/klip yang MELEBIHI
  // batas keras BytePlus (2-15 dtk/klip, lihat byteplus.ts createTask) — jadi
  // butuh 3 shot @15 dtk pas (satu shot per segmen hook/demo/cta). Formula
  // generik: minimal 2 shot buat variasi visual, nambah tiap durasi +15 dtk.
  const numShots = Math.max(2, Math.ceil(input.durationSec / 15));
  const perShot = input.durationSec / numShots;
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

  // Dialog per shot (tier bersuara): 2 shot = [hook+demo] lalu [cta] (perilaku
  // lama, tak berubah). >=3 shot (45 dtk) = 1 segmen penuh per shot — pas
  // karena tiap shot sudah 15 dtk penuh, gak perlu digabung lagi.
  const dialogueForShot = (i: number): string[] =>
    numShots >= 3
      ? i === 0 ? [segText("hook")] : i === 1 ? [segText("demo")] : [segText("cta")]
      : i === 0 ? [segText("hook"), segText("demo")] : [segText("cta")];

  const shots: ShotSpec[] = Array.from({ length: numShots }, (_, i) => {
    const isFirst = i === 0;
    // "Closing beat" cuma dipakai kalau shot terakhir BUKAN shot pertama juga
    // (numShots >= 3) — di 2-shot, shot kedua tetap "demonstrating" seperti
    // semula (perilaku lama tidak berubah).
    const isClosing = i === numShots - 1 && numShots >= 3;
    // Framing DI DEPAN prompt (posisi awal = penekanan lebih kuat): hands_only
    // melarang wajah, talking_head justru menekankan wajah terlihat.
    const framing = format === "hands_only" ? `${HANDS_ONLY_FRAMING}. ` : format === "talking_head" ? `${TALKING_HEAD_FRAMING}. ` : "";
    // Wajah AI pakai promptSeed (deskripsi wajah/tipologi) sebagai subjek utama,
    // bukan handsPrompt (yang secara eksplisit hanya deskripsi tangan/lengan).
    const subject = format === "talking_head" ? input.category.promptSeed : input.category.handsPrompt;
    const beat =
      format === "talking_head"
        ? isFirst
          ? `Presenter holding "${input.productName}" up to the camera at chest height, product label facing camera, warm smile, ${IDENTITY_INSTRUCTION}`
          : isClosing
            ? `Presenter smiling warmly, gesturing invitingly toward the camera as if wrapping up, product still clearly visible, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
            : `Presenter demonstrating the product close to camera, still clearly in frame with her face, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`
        : isFirst
          ? `Hands presenting "${input.productName}" to camera, product label facing camera, gentle rotation, ${IDENTITY_INSTRUCTION}`
          : isClosing
            ? `Hands holding the product steady near the bottom of frame in a closing, inviting gesture, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
            : `Hands demonstrating the product in use, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up texture, natural phone camera movement`;
    // Level gila: pembuka pattern-interrupt HANYA di shot pertama; vo_broll
    // (pan foto, tanpa model video) tidak punya jalur ini.
    const crazyOpener =
      input.hookLevel === "gila" && isFirst && format !== "vo_broll" ? CRAZY_OPENER[format] : "";
    const base = `${framing}${crazyOpener}${subject}. Shot ${i + 1} of ${numShots}. ${productDesc}${beat}`;

    if (!withAudio) {
      return { index: i, durationSec: perShot, prompt: base, imageRefPath: input.imageRefPath };
    }

    // Tier bersuara: dialog dalam tanda kutip; jeda & arahan di luar tanda kutip.
    // hands_only (Tangan + VO): dialog = NARASI VOICEOVER — insiden production
    // 2026-08-07 job a1192101: frasa "presenter speaks to camera" membuat model
    // menggambar WAJAH pembicara di format tanpa-wajah -> QC-09 menolak (benar).
    const dialogue = dialogueForShot(i).filter(Boolean).join(" ");
    const isLast = i === numShots - 1;
    const speech =
      format === "hands_only"
        ? `A warm female VOICEOVER narrates in casual Indonesian (the speaker is NEVER visible — off-screen narration only, keep the shot strictly hands and product): "${dialogue}". `
        : `The presenter speaks casually to camera in Indonesian, saying: "${dialogue}". `;
    const pacing =
      format === "hands_only"
        ? `The narration pauses for a full second before the next line — the pause should be clearly noticeable, not rushed. `
        : isLast
          ? `She pauses for a full second, smiles warmly, then ends with a friendly inviting tone — the pause should be clearly noticeable, not rushed. `
          : `She pauses for a full second, taking a visible breath, before showing the product closer — the pause should be clearly noticeable, not rushed. `;
    const prompt =
      `${base}. ${speech}` +
      pacing +
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
    extraReferenceImagePaths: input.extraImageRefPaths?.slice(0, 4),
  };
}

export { HANDS_ONLY_FRAMING, HANDS_ONLY_NEGATIVE, IDENTITY_INSTRUCTION, MANDATORY_NEGATIVE_PROMPT };
