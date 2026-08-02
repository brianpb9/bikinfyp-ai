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

export interface AiClipAudio {
  durationSec: number;
  /** Real VO track (ElevenLabs) for this AI clip. Falls back to silence if omitted. */
  audioPath?: string;
}

/** Gabung [klip upload user (bersuara asli, tidak diubah), klip AI-generated]
 * jadi satu mp4 + watermark AIGC wajib. Klip AI pakai VO (audioPath) bila ada
 * — kalau tidak, diisi hening supaya track audio tetap menyambung. */
export async function stitchClips(input: { jobId: string; workDir: string; clipPaths: string[]; aiClips: AiClipAudio[] }): Promise<StitchResult> {
  if (input.clipPaths.length < 2) throw new Error("stitchClips butuh minimal 2 klip.");
  const outPath = path.join(input.workDir, "output.mp4");
  const font = detectFont();
  const n = input.clipPaths.length;
  const silentStart = n; // indeks input anullsrc/VO dimulai setelah semua klip video

  const args: string[] = ["-y"];
  for (const clip of input.clipPaths) args.push("-i", clip);
  // Satu input audio per klip AI (index 1..n-1): VO nyata bila ada, else anullsrc hening.
  for (const ai of input.aiClips) {
    if (ai.audioPath) args.push("-i", ai.audioPath);
    else args.push("-f", "lavfi", "-t", ai.durationSec.toFixed(2), "-i", "anullsrc=r=24000:cl=mono");
  }

  const vChain: string[] = [];
  // concat requires every input to already share dimensions/SAR AND a
  // consistent, zero-based timeline — the user's upload (phone camera, e.g.
  // 30fps) and the AI-generated clip (provider's native res/fps, e.g.
  // 480x864 @ 24fps) differ on both counts. Mismatched PTS/fps made ffmpeg's
  // concat muxer spin duplicating frames indefinitely ("More than 1000
  // frames duplicated") instead of erroring — caught via a live staging
  // test, not something that reproduced with simple synthetic test clips
  // locally. fps= normalizes rate, setpts=PTS-STARTPTS resets each input's
  // timeline to 0 so concat isn't fighting stale/offset timestamps.
  for (let i = 0; i < n; i++)
    vChain.push(`[${i}:v]scale=720:1280:flags=bilinear,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}sc]`);
  // Audio concat has the same "must already match" requirement as video —
  // sample rate/channel layout, not just timeline. The AI clip's audio can
  // be silence (anullsrc, already 24000/mono) or a real ElevenLabs mp3
  // (unknown rate/channels), so every input is forced to 24000/mono here too.
  vChain.push(`[0:a]aresample=24000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[a0n]`);
  for (let i = 1; i < n; i++)
    vChain.push(`[${silentStart + i - 1}:a]aresample=24000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[a${i}n]`);
  const parts: string[] = [`[v0sc][a0n]`];
  for (let i = 1; i < n; i++) parts.push(`[v${i}sc][a${i}n]`);
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
