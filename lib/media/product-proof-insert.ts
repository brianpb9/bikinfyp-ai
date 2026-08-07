// "Product proof insert" — jaminan label produk 100% BENAR selamanya
// (keputusan Brian 2026-08-07, screenshot label gibberish berulang: "kamu
// harus perbanyak referensi" — sudah diuji, foto ekstra TIDAK menyelesaikan,
// itu limitasi model video, bukan kekurangan data). Fix jaminan matematis:
// selipkan FOTO ASLI produk (piksel nyata, bukan gambar AI) sebagai klip
// pendek di ujung video Wajah AI, tepat sebelum CTA — label pasti benar
// karena memang bukan hasil generate.
//
// Teknik editing UGC nyata (quick pack-shot cutaway), bukan sesuatu yang
// aneh dilihat penonton. Output disamakan spek dengan klip BytePlus (720x1280,
// 24fps, yuv420p) supaya concat filter compositor menerimanya tanpa masalah.

import { execFileSync } from "node:child_process";
import { config } from "../config";

export async function buildProductProofClip(imagePath: string, outPath: string, durationSec: number): Promise<void> {
  const frames = Math.max(1, Math.round(durationSec * 24));
  execFileSync(config.ffmpegPath, [
    "-y", "-v", "error",
    "-loop", "1", "-i", imagePath,
    "-vf",
    // Fit produk utuh di kanvas (letterbox putih) — TIDAK crop, supaya SELURUH
    // label termasuk baris kecil ikut terlihat; zoom halus supaya tidak statis.
    "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:color=white," +
      `zoompan=z='min(zoom+0.0015,1.06)':d=${frames}:s=720x1280:fps=24,format=yuv420p`,
    "-t", durationSec.toFixed(2),
    "-color_range", "tv",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-an",
    outPath,
  ]);
}
