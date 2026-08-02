/**
 * Video Promosi (non-ecommerce) prototype — minimal 2-clip stitch.
 * Deliberately separate from lib/media/compositor.ts: that compositor is
 * tightly coupled to the e-commerce format (price overlay, "keranjang
 * kuning" CTA badge, demo/cta ranges) which don't apply here. This is a
 * much simpler concat + mandatory AIGC watermark only — prototype scope.
 */
import path from "node:path";
import { runFfmpeg, detectFont, escDrawtext } from "../media/ffmpeg";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";

export interface StitchResult {
  outPath: string;
}

// Prototype assumption: clipPaths[0] (user upload) has an audio stream —
// enforced by upload validation (probeHasAudioStream). If that assumption
// stops holding, this needs a per-clip audio-presence probe instead.

/** Gabung [klip upload user (bersuara), klip AI-generated (bisu, silent_caption
 * prototype)] jadi satu mp4 + watermark AIGC wajib. Audio klip AI diisi hening
 * supaya track audio tetap menyambung (bukan dibuang total). */
export async function stitchClips(input: { jobId: string; workDir: string; clipPaths: string[]; aiClipDurationsSec: number[] }): Promise<StitchResult> {
  if (input.clipPaths.length < 2) throw new Error("stitchClips butuh minimal 2 klip.");
  const outPath = path.join(input.workDir, "output.mp4");
  const font = detectFont();
  const n = input.clipPaths.length;
  const silentStart = n; // indeks input anullsrc dimulai setelah semua klip video

  const args: string[] = ["-y"];
  for (const clip of input.clipPaths) args.push("-i", clip);
  // Satu anullsrc per klip AI (index 1..n-1), diberi -t durasi masing-masing.
  for (const dur of input.aiClipDurationsSec) args.push("-f", "lavfi", "-t", dur.toFixed(2), "-i", "anullsrc=r=24000:cl=mono");

  const vChain: string[] = [];
  // concat requires every input to already share dimensions/SAR — the user's
  // upload and the AI-generated clip come from different sources (phone
  // camera vs. provider's native render res, e.g. 480x864), so each is
  // scaled to 720x1280 individually BEFORE concat, not after.
  for (let i = 0; i < n; i++) vChain.push(`[${i}:v]scale=720:1280:flags=bilinear,setsar=1[v${i}sc]`);
  const parts: string[] = [];
  parts.push(`[v0sc][0:a]`);
  for (let i = 1; i < n; i++) parts.push(`[v${i}sc][${silentStart + i - 1}:a]`);
  vChain.push(`${parts.join("")}concat=n=${n}:v=1:a=1[vcat][acat]`);
  vChain.push(
    `[vcat]drawtext=fontfile='${font}':text='${escDrawtext(AIGC_WATERMARK_TEXT)}':` +
      `fontsize=28:fontcolor=white@0.7:x=w-text_w-24:y=h-text_h-24[vout]`
  );
  vChain.push(`[acat]aresample=24000[aout]`);

  args.push(
    "-filter_complex", vChain.join(";"),
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "faststart+use_metadata_tags",
    "-metadata", `comment=BikinFYP.AI AIGC prototype-promo | ${new Date().toISOString()}`,
    "-metadata", "racun_aigc=true",
    "-metadata", `aigc_watermark=${AIGC_WATERMARK_TEXT}`,
    outPath
  );

  await runFfmpeg(args);
  console.log(`[promo-stitch] job ${input.jobId}: output.mp4 selesai (${n} klip, watermark AIGC aktif)`);
  return { outPath };
}
