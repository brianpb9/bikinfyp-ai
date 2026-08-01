// Util bersama provider mock video: render klip senyap 9:16 dari foto produk asli
// via FFmpeg zoompan. Foto asli pengguna = image reference; tidak ada teks digambar AI.
//
// FRAMING (fix crop): sumber non-9:16 JANGAN di-hard-crop (cover) — teks/logo di
// tepi foto bisa terpotong. Pakai CONTAIN/letterbox: foto utuh terlihat, area kosong
// diisi blur dari foto itu sendiri (gaya umum TikTok). Untuk sumber non-9:16, foto
// depan di-scale 90% dan zoom dibatasi 1,06 supaya tepi foto TIDAK pernah terpotong
// di sepanjang gerakan zoom.

import path from "node:path";
import { runFfmpeg, runFfprobe, probeDurationSec } from "../../media/ffmpeg";
import type { ShotSpec, VideoAsset } from "../types";

const TARGET_ASPECT = 9 / 16;

async function probeSize(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
    "-of", "csv=p=0", file,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  return { w, h };
}

export async function renderZoompanShot(opts: {
  shot: ShotSpec;
  outPath: string;
  width: number;
  height: number;
  fps?: number;
  direction: "in" | "out";
  costIdr: number;
}): Promise<VideoAsset> {
  const { shot, outPath, width, height, direction, costIdr } = opts;
  const fps = opts.fps ?? 25;
  const frames = Math.round(shot.durationSec * fps);

  // Sumber sudah ~9:16 -> full-bleed (zoom standar). Selain itu -> contain 90% + zoom aman.
  const { w, h } = await probeSize(shot.imageRefPath);
  const srcAspect = w / h;
  const is916 = Math.abs(srcAspect - TARGET_ASPECT) < 0.02;
  const fgScale = is916 ? 1.0 : 0.9;
  const zoomMax = is916 ? 1.2 : 1.06;

  const zoomExpr =
    direction === "in"
      ? `min(zoom+0.0006,${zoomMax})` // mock-a: zoom masuk halus
      : `max(${zoomMax}-0.0006*on,1.0)`; // mock-b: zoom keluar halus (treatment beda)

  const fgW = Math.round((width * fgScale) / 2) * 2;
  const fgH = Math.round((height * fgScale) / 2) * 2;

  await runFfmpeg([
    "-y",
    "-loop", "1",
    "-i", shot.imageRefPath,
    "-filter_complex",
    // Latar: cover-crop + blur kuat (hanya pengisi area kosong)
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},boxblur=24:3[bg];` +
      // Depan: CONTAIN — seluruh foto terlihat, tidak ada yang terpotong
      `[0:v]scale=${fgW}:${fgH}:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,` +
      `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},` +
      `format=yuv420p[v]`,
    "-map", "[v]",
    "-t", String(shot.durationSec),
    "-an", // SENYAP — tidak ada jalur audio bawaan model video
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "26",
    outPath,
  ]);
  const durationSec = await probeDurationSec(outPath);
  return { filePath: path.resolve(outPath), durationSec, costIdr };
}
