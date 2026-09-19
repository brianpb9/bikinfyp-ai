/**
 * FRAME POSTER UNTUK SETIAP VIDEO STATIS DI public/.
 *
 * Kenapa ada: audit UI 19 Sep 2026 menemukan 20 tag <video> di aplikasi dan
 * TIDAK SATU PUN punya `poster`. Sampai videonya selesai dimuat — atau
 * selamanya, kalau autoplay ditolak browser, mode hemat data menyala, atau
 * jaringannya lambat — yang dilihat pengguna adalah kotak kosong. Empat layar
 * terpenting (daftar, pilih format, pilih gaya) tampil melompong, dan ini
 * produk yang menjual video.
 *
 * Poster diambil dari video itu sendiri, jadi ia tidak pernah berbohong
 * tentang isinya: frame pada ~12% durasi (melewati fade-in, sebelum potongan
 * kedua), lebar penuh 640px, WebP.
 *
 * Jalankan ulang setiap kali video contoh diganti:
 *   npx tsx scripts/buat-poster.ts
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const jalankan = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";
const DIR = ["previews", "demo", "showcase"];

/** Nama berkas poster untuk sebuah video — dipakai juga oleh posterUntuk() di lib/poster.ts. */
export const pathPoster = (mp4: string) => mp4.replace(/\.mp4$/, ".poster.webp");

async function durasi(berkas: string): Promise<number> {
  const { stdout } = await jalankan(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", berkas]);
  return Number(stdout.trim()) || 0;
}

async function main() {
  const akar = path.join(process.cwd(), "public");
  let dibuat = 0, dilewati = 0, totalByte = 0;

  for (const sub of DIR) {
    const dir = path.join(akar, sub);
    if (!fs.existsSync(dir)) continue;
    for (const nama of fs.readdirSync(dir).filter((n) => n.endsWith(".mp4"))) {
      const mp4 = path.join(dir, nama);
      const keluar = pathPoster(mp4);
      if (fs.existsSync(keluar) && fs.statSync(keluar).mtimeMs > fs.statSync(mp4).mtimeMs) { dilewati++; continue; }
      // ~12% durasi: sesudah fade-in, sebelum potongan berikutnya. Dibatasi
      // 1,2 dtk supaya video panjang tidak mengambil frame dari adegan lain.
      const detik = Math.min(1.2, Math.max(0, (await durasi(mp4)) * 0.12));
      // ffmpeg di beberapa mesin dibangun tanpa encoder webp, jadi frame
      // diambil sebagai PNG mentah lalu dikompres sharp — satu jalur yang
      // sama hasilnya di laptop mana pun dan di container build.
      const { stdout } = (await jalankan(FFMPEG, [
        "-v", "error", "-ss", detik.toFixed(2), "-i", mp4, "-frames:v", "1",
        "-vf", "scale=-2:640", "-f", "image2pipe", "-vcodec", "png", "-",
      ], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 })) as unknown as { stdout: Buffer };
      const webp = await sharp(stdout).webp({ quality: 72 }).toBuffer();
      fs.writeFileSync(keluar, webp);
      dibuat++; totalByte += webp.length;
      console.log(`${path.relative(akar, keluar)}  ${(webp.length / 1024).toFixed(0)} KB  @${detik.toFixed(2)}s`);
    }
  }
  console.log(`\n${dibuat} poster dibuat (${(totalByte / 1024).toFixed(0)} KB), ${dilewati} sudah segar.`);
}

main().catch((err) => { console.error("[poster] GAGAL:", err instanceof Error ? err.message : err); process.exit(1); });
