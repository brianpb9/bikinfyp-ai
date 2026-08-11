import fs from "node:fs";
import path from "node:path";
import { runFf, runFfmpeg, runFfprobe } from "./ffmpeg";

// Overlay klaim: teks pendek yang muncul bergantian di atas video.
//
// Dari referensi Charlotte Tilbury yang Brian kirim, teks di layar adalah
// BAGIAN dari tampilan iklan, bukan hiasan tambahan.
//
// Pola yang sama dengan lib/media/endcard.ts, dan alasannya sama: langkah
// terpisah SETELAH compositing, jadi kegagalannya paling buruk cuma
// menghilangkan overlay — bukan merusak video yang sudah jadi dan sudah
// dibayar.
//
// SOAL ISI KLAIM: ini ditulis brand, bukan dikarang AI. Validator skrip
// (L-13/L-14) melarang AI menyebut angka dan klaim yang tidak ada di data;
// jalur ini berbeda — brand yang menyatakan dan brand yang bertanggung jawab.
// Kita hanya membatasi panjang dan jumlah agar layar tidak penuh.

export const MAX_CLAIMS = 3;
const MAX_CLAIM_CHARS = 34;
const SHOW_SEC = 2.4;

export interface ClaimOverlayInput {
  videoPath: string;
  workDir: string;
  claims: string[];
  /** Durasi video; dipakai membagi jadwal munculnya klaim. */
  durationSec?: number;
}

export function sanitizeClaims(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .map((c) => String(c ?? "").trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((c) => c.slice(0, MAX_CLAIM_CHARS))
    .slice(0, MAX_CLAIMS);
}

async function probe(p: string): Promise<{ w: number; h: number; dur: number }> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-show_entries", "format=duration",
    "-of", "csv=p=0", p,
  ]);
  const parts = stdout.trim().split(/[\n,]/).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  return { w: parts[0] || 1080, h: parts[1] || 1920, dur: parts[2] || 15 };
}

/** Render tiap klaim jadi PNG lewat renderer PIL yang sudah dipakai caption —
 * bukan drawtext, karena font drawtext berbeda-beda antar container. */
async function renderClaimPngs(claims: string[], workDir: string, width: number): Promise<string[]> {
  const spec = claims.map((text, i) => ({
    type: "badge",
    out: path.join(workDir, `claim-${i}.png`),
    text,
    size: Math.max(26, Math.round(width / 26)),
    fill: [255, 255, 255],
    bg: [0, 0, 0, 150], // pill gelap transparan: terbaca di latar terang maupun gelap
    stroke_width: 0,
    radius: 40,
    pad_x: 34,
    pad_y: 18,
  }));
  const specPath = path.join(workDir, "claims-spec.json");
  fs.writeFileSync(specPath, JSON.stringify(spec));
  try {
    await runFf("python3", [path.join(process.cwd(), "lib", "media", "render_caption.py"), specPath]);
  } catch {
    return [];
  }
  return spec.map((s) => s.out).filter((p) => fs.existsSync(p));
}

/** Tempel klaim ke video. Mengembalikan path baru, atau path asli bila gagal. */
export async function appendClaimOverlays(input: ClaimOverlayInput): Promise<string> {
  const claims = sanitizeClaims(input.claims);
  if (claims.length === 0) return input.videoPath;

  const { w, h, dur } = await probe(input.videoPath);
  const pngs = await renderClaimPngs(claims, input.workDir, w);
  if (pngs.length === 0) return input.videoPath;

  // Jadwal: klaim dibagi rata di PARUH TENGAH video. Detik-detik awal milik
  // hook dan detik akhir milik penutup/endcard — menimpa keduanya dengan teks
  // justru merusak bagian yang paling menentukan.
  const start = dur * 0.25;
  const span = dur * 0.55;
  const step = span / pngs.length;

  const args: string[] = ["-y", "-i", input.videoPath];
  for (const p of pngs) args.push("-i", p);

  const filters: string[] = [];
  let cur = "[0:v]";
  pngs.forEach((_, i) => {
    const from = (start + i * step).toFixed(2);
    const to = (start + i * step + Math.min(SHOW_SEC, step)).toFixed(2);
    const next = i === pngs.length - 1 ? "[vout]" : `[v${i}]`;
    // Diposisikan di bawah-tengah, di atas area aman: cukup jauh dari tepi
    // supaya tidak terpotong UI TikTok/Reels saat diputar.
    filters.push(
      `${cur}[${i + 1}:v]overlay=(W-w)/2:H-h-${Math.round(h * 0.18)}:enable='between(t,${from},${to})'${next}`
    );
    cur = next;
  });

  const out = path.join(input.workDir, "output-claims.mp4");
  try {
    await runFfmpeg([...args, "-filter_complex", filters.join(";"),
      "-map", "[vout]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", out]);
    return out;
  } catch (err) {
    console.warn(`[claims] gagal menempel overlay: ${(err as Error).message}`);
    return input.videoPath;
  }
}
