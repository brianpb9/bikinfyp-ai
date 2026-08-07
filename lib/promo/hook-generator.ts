/**
 * Video Promosi (non-ecommerce) prototype — AI-generated hook/explanation
 * segment. Deliberately separate from lib/media/shot-planner.ts: that file
 * (and the prompt content it produces) is Brian's own domain for the
 * e-commerce pipeline. This is a NEW, isolated placeholder for the prototype
 * only — nothing in shot-planner.ts is touched or reused.
 *
 * TODO(Brian): PLACEHOLDER_PROMPT below is a minimal stand-in so the
 * upload -> generate -> stitch pipeline can be proven end-to-end. It has not
 * been tuned for quality — replace with real prompt engineering before this
 * goes past Prototype stage.
 */
import path from "node:path";
import { runFfmpeg, probeDurationSec } from "../media/ffmpeg";
import { MANDATORY_NEGATIVE_PROMPT } from "../config/compliance";
import type { VisualSpec } from "../providers/types";

const PLACEHOLDER_PROMPT =
  "Hands and forearms only, face and body NOT visible, cropped below shoulders, close-up POV " +
  "hands-only shot. Hands gesture openly and expressively as if explaining something exciting, " +
  "natural phone camera movement, casual well-lit indoor setting, energetic but natural pacing.";

const PLACEHOLDER_NEGATIVE =
  `${MANDATORY_NEGATIVE_PROMPT}, no face, no visible face, no head in frame, no person facing camera, no product`;

/** Ambil frame terakhir dari klip upload user sebagai image reference — supaya
 * segmen AI-generated nyambung visual (latar/warna) dengan footage asli. */
export async function extractReferenceFrame(clipPath: string, outDir: string): Promise<string> {
  const durationSec = await probeDurationSec(clipPath);
  const framePath = path.join(outDir, "ref_frame.jpg");
  const seekAt = Math.max(0, durationSec - 0.2);
  await runFfmpeg(["-y", "-v", "error", "-ss", seekAt.toFixed(2), "-i", clipPath, "-frames:v", "1", framePath]);
  return framePath;
}

export function buildHookVisualSpec(input: { jobId: string; imageRefPath: string; durationSec: number }): VisualSpec {
  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots: [{ index: 0, durationSec: input.durationSec, prompt: PLACEHOLDER_PROMPT, imageRefPath: input.imageRefPath }],
    negativePrompt: PLACEHOLDER_NEGATIVE,
    qualityTier: "silent_caption",
    generateAudio: false,
    hasProofInsert: false,
  };
}

export { PLACEHOLDER_PROMPT };
