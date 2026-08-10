/**
 * Video Promosi (non-ecommerce) prototype — AI-generated hook/explanation
 * segment. Deliberately separate from lib/media/shot-planner.ts: that file
 * (and the prompt content it produces) is Brian's own domain for the
 * e-commerce pipeline. This is a NEW, isolated placeholder for the prototype
 * only — nothing in shot-planner.ts is touched or reused.
 *
 * r-hook-library (Brian 2026-08-10): the single placeholder prompt is
 * replaced by the curated hook-library.ts (11 ideas, hasil skor Brian
 * sendiri dari 30 ide). NOTE (i2v-only simplification, disclosed not
 * hidden): hook-library.ts entries carry a `mode` field ("i2v"/"r2v") ported
 * from the original standalone experiments, but the promo worker's
 * "silent_caption" quality tier always resolves to a non-dreamina BytePlus
 * model (see lib/config.ts BYTEPLUS_MODEL_SILENT) — r2v's reference_image
 * role only activates for dreamina-seedance-2 models (see useR2v in
 * lib/providers/stubs/byteplus.ts). Switching tier to unlock r2v would force
 * generateAudio=true (assertVisualSpec), colliding with this pipeline's
 * silent-hook + external-VO design. So every entry renders i2v for now
 * (image = literal first frame) — still uses the exact same scored prompt
 * text, just without the r2v camera-freedom some ideas were tuned with.
 * Proper r2v support needs its own model-selection plumbing, out of scope
 * for this wiring pass.
 */
import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, probeDurationSec } from "../media/ffmpeg";
import { MANDATORY_NEGATIVE_PROMPT } from "../config/compliance";
import { normalizeProductImageBuffer } from "../product-images";
import type { VisualSpec } from "../providers/types";
import { fillPersonInPrompt, type HookLibraryEntry } from "./hook-library";

/** Ambil frame terakhir dari klip upload user sebagai image reference — supaya
 * segmen AI-generated nyambung visual (latar/warna) dengan footage asli.
 *
 * r-minref (Brian 2026-08-10, "expected the width to be at least 300px, but
 * received a 270x478px image" — klip HP Android low-res): BytePlus MENOLAK
 * gambar referensi < 300px di sisi manapun (masalah sama yang sudah
 * ditangani utk foto produk ecommerce, lihat MIN_REF_SIDE di
 * lib/product-images.ts) — frame mentah dari klip upload user TIDAK dijamin
 * cukup besar, harus lewat normalisasi yang sama sebelum dipakai referensi. */
export async function extractReferenceFrame(clipPath: string, outDir: string): Promise<string> {
  const durationSec = await probeDurationSec(clipPath);
  const rawFramePath = path.join(outDir, "ref_frame_raw.jpg");
  const seekAt = Math.max(0, durationSec - 0.2);
  await runFfmpeg(["-y", "-v", "error", "-ss", seekAt.toFixed(2), "-i", clipPath, "-frames:v", "1", rawFramePath]);
  const normalized = await normalizeProductImageBuffer(fs.readFileSync(rawFramePath));
  const framePath = path.join(outDir, "ref_frame.webp");
  fs.writeFileSync(framePath, normalized);
  return framePath;
}

export function buildHookVisualSpec(input: {
  jobId: string;
  imageRefPath: string;
  durationSec: number;
  hookEntry: HookLibraryEntry;
  avatarDescription: string | null;
}): VisualSpec {
  const prompt = fillPersonInPrompt(input.hookEntry.prompt, input.avatarDescription);
  const negativePrompt = `${MANDATORY_NEGATIVE_PROMPT}, ${input.hookEntry.negative}`;
  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots: [{ index: 0, durationSec: input.durationSec, prompt, imageRefPath: input.imageRefPath }],
    negativePrompt,
    qualityTier: "silent_caption",
    generateAudio: false,
  };
}
