// Helper FFmpeg/FFprobe — semua pemrosesan media lewat sini.

import { execFile } from "node:child_process";
import fs from "node:fs";
import { config } from "../config";

export function runFf(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // FFmpeg/Python diagnostics are useful but must not reserve a huge Node
    // buffer in a 512 MiB worker. Error tails remain preserved below.
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        const tail = (stderr ?? "").split("\n").slice(-12).join("\n");
        reject(new Error(`${cmd} gagal (exit ${err.code}): ${tail}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/** Keep FFmpeg's frame/filter workers within the Render Starter memory budget. */
export function boundedFfmpegArgs(args: string[]): string[] {
  return ["-threads", "1", "-filter_threads", "1", "-filter_complex_threads", "1", ...args];
}

export const runFfmpeg = (args: string[]) => runFf(config.ffmpegPath, boundedFfmpegArgs(args));
export const runFfprobe = (args: string[]) => runFf(config.ffprobePath, args);

export async function probeDurationSec(file: string): Promise<number> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

export async function probeFormatTags(file: string): Promise<Record<string, string>> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-show_entries", "format_tags", "-of", "json", file,
  ]);
  try {
    return JSON.parse(stdout)?.format?.tags ?? {};
  } catch {
    return {};
  }
}

export async function probeHasVideoStream(file: string): Promise<boolean> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type",
    "-of", "csv=p=0", file,
  ]);
  return stdout.trim() === "video";
}

export async function probeHasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type",
    "-of", "csv=p=0", file,
  ]);
  return stdout.trim() === "audio";
}

/** volumedetect -> { meanDb, maxDb } */
export async function volumeDetect(file: string): Promise<{ meanDb: number; maxDb: number }> {
  const { stderr } = await runFfmpeg(["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const mean = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
  const max = stderr.match(/max_volume:\s*(-?[\d.]+) dB/);
  return {
    meanDb: mean ? parseFloat(mean[1]) : -999,
    maxDb: max ? parseFloat(max[1]) : -999,
  };
}

import path from "node:path";

// Font brand (Poppins ExtraBold, OFL) diutamakan untuk semua teks video;
// fallback font sistem bila file hilang (fail-safe).
const FONT_CANDIDATES = [
  path.join(process.cwd(), "assets", "fonts", "Poppins-ExtraBold.ttf"),
  "/System/Library/Fonts/Supplemental/Arial.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/Library/Fonts/Arial.ttf",
];

export function detectFont(): string {
  for (const f of FONT_CANDIDATES) if (fs.existsSync(f)) return f;
  throw new Error("Font untuk drawtext tidak ditemukan di sistem");
}

/** Escape teks untuk drawtext ffmpeg (argumen diberikan langsung, tanpa shell). */
export function escDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%");
}

/** Dimensi video (piksel). Dipakai memastikan klip yang digabung seragam —
 *  concat demuxer dengan `-c copy` MENUNTUT dimensi identik, dan melanggarnya
 *  menghasilkan berkas yang terlihat jadi tapi tidak sah. */
export async function probeVideoSize(filePath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await runFf("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", filePath,
  ]);
  const [w, h] = (stdout ?? "").trim().split(",").map((x) => Number(x));
  if (!w || !h) throw new Error(`dimensi video tidak terbaca: ${filePath}`);
  return { width: w, height: h };
}
