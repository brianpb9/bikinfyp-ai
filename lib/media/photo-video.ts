/**
 * VO+Foto (vo_broll) v1: a Ken Burns pan/zoom video built directly from the
 * user's real product photo — no AI video generation call, no AI-drawn hands
 * or face. The whole point of this format is "it's really your product
 * photo," not an AI reinterpretation of it, so identity/consistency issues
 * that plague AI-generated shots (QC-03/QC-09 territory) structurally can't
 * happen here. v1: same zoom treatment on both shots, refine later.
 *
 * Shaped to match registry.ts's VideoGenResult exactly so callers can swap
 * generateVideoWithFailover() for buildPhotoPanVideo() without touching the
 * compositing/QC code that consumes the result.
 */
import path from "node:path";
import { runFfmpeg } from "./ffmpeg";
import type { VisualSpec, VideoAsset } from "../providers/types";
import type { VideoGenResult } from "../providers/registry";

const FPS = 30;
const PROVIDER_NAME = "photo-pan-v1";
// Frame count is capped so a slow zoom never index out of the upscaled
// source frame — matches shot durations well within this range (SRS shots
// are ~7-8s each for a 15s job).
const MAX_ZOOM = 1.25;
const ZOOM_STEP = 0.0018;

export async function buildPhotoPanVideo(spec: VisualSpec, outDir: string): Promise<VideoGenResult> {
  const assets: VideoAsset[] = [];
  for (const shot of spec.shots) {
    if (!shot.imageRefPath) throw new Error("photo-pan wajib menerima foto sumber nyata");
    const frames = Math.max(1, Math.round(shot.durationSec * FPS));
    const outPath = path.join(outDir, `photo_pan_${shot.index}.mp4`);
    // Alternate zoom direction per shot so the two clips don't feel identical.
    const zoomExpr = shot.index % 2 === 0 ? `min(zoom+${ZOOM_STEP},${MAX_ZOOM})` : `max(${MAX_ZOOM}-${ZOOM_STEP}*on,1.0)`;
    await runFfmpeg([
      "-y", "-loop", "1", "-i", shot.imageRefPath,
      "-vf", `scale=${spec.width * 4}:-1,zoompan=z='${zoomExpr}':d=${frames}:s=${spec.width}x${spec.height}:fps=${FPS},setsar=1`,
      "-t", String(shot.durationSec),
      "-pix_fmt", "yuv420p", "-r", String(FPS),
      outPath,
    ]);
    assets.push({ filePath: outPath, durationSec: shot.durationSec, costIdr: 0, hasAudio: false });
  }
  return { assets, providerName: PROVIDER_NAME, costIdr: 0 };
}
