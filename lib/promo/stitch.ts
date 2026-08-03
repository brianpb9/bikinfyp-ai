/**
 * Video Promosi (non-ecommerce) prototype — N-clip stitch (stage 3).
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

export type ClipAudio =
  | { kind: "embedded" } // use this clip's own audio track (real footage — user uploads)
  | { kind: "file"; path: string; durationSec: number } // separate audio file (VO mp3 over a silent AI clip)
  | { kind: "silent"; durationSec: number }; // no audio available for this clip

export interface StitchClip {
  videoPath: string;
  audio: ClipAudio;
}

/** Gabung N klip (urutan sesuai array — mis. hook AI di depan, lalu klip upload
 * user) jadi satu mp4 + watermark AIGC wajib. Tiap klip bawa sumber audio
 * sendiri: audio asli (embedded), file audio terpisah (VO), atau hening. */
export async function stitchClips(input: { jobId: string; workDir: string; clips: StitchClip[] }): Promise<StitchResult> {
  const clips = input.clips;
  const n = clips.length;
  if (n < 1) throw new Error("stitchClips butuh minimal 1 klip.");
  const outPath = path.join(input.workDir, "output.mp4");
  const font = detectFont();

  const args: string[] = ["-y"];
  for (const clip of clips) args.push("-i", clip.videoPath);
  // Audio inputs come after all video inputs, in clip order, only for clips
  // that need a separate input (file/silent) — "embedded" reuses the video
  // input's own [i:a] stream, no extra -i needed.
  const audioInputIndex: (number | null)[] = [];
  let nextAudioInput = n;
  for (const clip of clips) {
    if (clip.audio.kind === "embedded") {
      audioInputIndex.push(null);
    } else if (clip.audio.kind === "file") {
      audioInputIndex.push(nextAudioInput++);
      args.push("-i", clip.audio.path);
    } else {
      audioInputIndex.push(nextAudioInput++);
      args.push("-f", "lavfi", "-t", clip.audio.durationSec.toFixed(2), "-i", "anullsrc=r=24000:cl=mono");
    }
  }

  const vChain: string[] = [];
  // concat requires every input to already share dimensions/SAR/fps AND a
  // consistent, zero-based timeline (found via a live staging hang: mismatched
  // PTS/fps made ffmpeg's concat muxer spin duplicating frames indefinitely
  // instead of erroring). Also requires matching audio sample rate/channel
  // layout (found via mismatched-rate VO mp3 vs. AAC upload audio). Every
  // clip is normalized on both fronts before concat, regardless of source.
  for (let i = 0; i < n; i++)
    vChain.push(`[${i}:v]scale=720:1280:flags=bilinear,setsar=1,fps=30,setpts=PTS-STARTPTS[v${i}sc]`);
  for (let i = 0; i < n; i++) {
    const idx = audioInputIndex[i];
    const src = idx === null ? `${i}:a` : `${idx}:a`;
    vChain.push(`[${src}]aresample=24000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS[a${i}n]`);
  }
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(`[v${i}sc][a${i}n]`);
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
    "-metadata", `comment=BikinFYP AI AIGC prototype-promo | ${new Date().toISOString()}`,
    "-metadata", "racun_aigc=true",
    "-metadata", `aigc_watermark=${AIGC_WATERMARK_TEXT}`,
    outPath
  );

  await runFfmpeg(args);
  console.log(`[promo-stitch] job ${input.jobId}: output.mp4 selesai (${n} klip, watermark AIGC aktif)`);
  return { outPath };
}
