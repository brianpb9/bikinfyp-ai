/**
 * Video Promosi (non-ecommerce) prototype — AI-generated hook/explanation
 * segment. Deliberately separate from lib/media/shot-planner.ts: that file
 * (and the prompt content it produces) is Brian's own domain for the
 * e-commerce pipeline. This is a NEW, isolated placeholder for the prototype
 * only — nothing in shot-planner.ts is touched or reused.
 *
 * r-r2v-fix (Brian 2026-08-11): the earlier i2v-only shortcut shipped a real
 * defect, not just a "less dramatic" tradeoff — forcing the user's own
 * reference frame as the LITERAL first frame meant scene-heavy prompts
 * (e.g. "krl-ruang-tamu": ordinary living room, sofa, wall clock) had to
 * violently warp away from an unrelated frame (a hand holding a product) in
 * ~1-2s, and the scripted payoff (train bursting through the wall) never
 * actually played out — confirmed by pulling two real production outputs
 * and inspecting them frame-by-frame.
 *
 * Fix: entries with mode "r2v" now render on the "high_quality" tier, whose
 * model (dreamina-seedance-2-0-mini, see lib/config.ts BYTEPLUS_MODEL_HQ)
 * is the one that actually supports the reference_image role (see useR2v in
 * lib/providers/stubs/byteplus.ts) — the reference frame becomes an
 * identity/style nudge instead of a locked first frame, so the AI can
 * actually stage the described scene and execute the full beat. This forces
 * generateAudio=true (assertVisualSpec ties it to tier), but that embedded
 * audio is already discarded during stitching in worker.ts in favor of the
 * external Gemini VO — paying for audio we don't use is an acceptable cost
 * to fix broken visuals, not a bug. mode "i2v" entries (the 3 product-first-
 * frame ones: sapuan-dua-dunia, shockwave, rakit-sendiri) keep the original
 * silent_caption/i2v path — the literal-first-frame behavior is CORRECT for
 * those, since they're written to open on the product exactly as supplied.
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
  const isR2v = input.hookEntry.mode === "r2v";
  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots: [{ index: 0, durationSec: input.durationSec, prompt, imageRefPath: input.imageRefPath }],
    negativePrompt,
    qualityTier: isR2v ? "high_quality" : "silent_caption",
    generateAudio: isR2v,
    // >=1 entry (even the same path repeated) is what flips the provider
    // into r2v — see useR2v in lib/providers/stubs/byteplus.ts.
    extraReferenceImagePaths: isR2v ? [input.imageRefPath] : undefined,
  };
}
