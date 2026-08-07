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
import path from "node:path";
import { config } from "../config";
import { runFfmpeg } from "./ffmpeg";

// r15 (Brian 2026-08-08, "tulisannya masih jelek" -> ditemukan saat perluas
// proof-insert ke hands_only): provider BytePlus HANYA terima durasi bulat
// (byteplus.ts pakai Math.ceil), jadi shot yang diminta 14.25dtk selalu
// PULANG ~15.1dtk -- reservasi PRODUCT_PROOF_INSERT_SEC di shot-planner jadi
// sia-sia, dan trim akhir compositor (yang motong dari BELAKANG ke
// durationSec) malah memangkas HABIS klip proof yang seharusnya jadi jaminan
// label benar. Fix: potong paksa tiap klip shot ke durasi rencana PERSIS
// SEBELUM di-concat, supaya total input concat = target - proof, dan proof
// klip di ujung tidak pernah kena potong.
export async function trimShotsForProofInsert(
  clipPaths: string[],
  targetDurationsSec: number[],
  workDir: string
): Promise<string[]> {
  const trimmed: string[] = [];
  for (let i = 0; i < clipPaths.length; i++) {
    const outPath = path.join(workDir, `shot${i}_trimmed.mp4`);
    // Re-encode (bukan -c copy) supaya potongan presisi ke frame, bukan
    // dibulatkan ke keyframe terdekat -- krusial krn total harus PAS pas
    // (target - proof) supaya trim akhir compositor tidak makan proof clip.
    // -an: audio klip dibuang -- pada mode reserveProof, suara SELALU dari
    // VO Gemini terpisah (embedded+voiceoverWavPath, lihat compositor.ts),
    // bukan dari audio bawaan klip, jadi aman dibuang di sini.
    await runFfmpeg(["-y", "-v", "error", "-i", clipPaths[i], "-t", targetDurationsSec[i].toFixed(2),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", outPath]);
    trimmed.push(outPath);
  }
  return trimmed;
}

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
