// PACKSHOT PENUTUP DARI FOTO ASLI BRAND.
//
// MASALAH YANG DISELESAIKAN, diukur 2026-08-14 dengan menonton hasil render:
// model video TIDAK BISA merender teks kecil di label produk. Yang keluar
// adalah kata karangan yang BERUBAH antar shot dalam satu video —
// "Bright Slow 'ver Gel" -> "Shaw Slow 'w' Peer / 30ml / 45 oz" (45 oz untuk
// botol 30 ml). Dua putaran perbaikan prompt gagal, jadi ini batas kemampuan
// model, bukan soal pilihan kata.
//
// Untuk brand yang membayar, label adalah identitasnya sendiri. Iklan yang
// keseluruhannya indah tapi mencetak nama produk yang salah bukan iklan yang
// "hampir benar" — ia tidak bisa dipakai.
//
// JALAN KELUARNYA BUKAN PROMPT KETIGA, tapi menghapus prasyaratnya: shot
// penutup tidak digenerate sama sekali. Ia dibangun dari FOTO ASLI yang
// diunggah brand, dengan push-in halus supaya tetap hidup. Labelnya dijamin
// benar karena itu memang labelnya.
//
// Kenapa shot PENUTUP: di situ mata berhenti, di situ produk dilihat paling
// lama, dan di situ keputusan beli terbentuk. Kalau hanya satu shot yang boleh
// punya label sempurna, shot itulah.
//
// Bonusnya bukan cuma menutup cacat — packshot foto asli menaikkan kepercayaan.
// Penonton melihat produk yang benar-benar akan mereka terima.

import fs from "node:fs";
import path from "node:path";
import { runFfmpeg } from "./ffmpeg";

const FPS = 24;

/** Seberapa jauh push-in-nya. 1.0 -> 1.06 saja: packshot brand harus terasa
 *  TENANG. Zoom yang agresif membuat penutup terasa belum selesai, dan
 *  dokumen produksi Brian menuliskan penutup dikunci diam. */
const ZOOM_AKHIR = 1.06;

export interface PackshotInput {
  /** Foto produk asli dari brand. */
  fotoPath: string;
  durationSec: number;
  width: number;
  height: number;
  outPath: string;
}

/** Bangun klip packshot dari foto asli. Mengembalikan path klipnya.
 *
 *  PENUH-BLEED, bukan di-fit ke dalam pita.
 *
 *  Versi pertama mem-fit seluruh foto ke kanvas 9:16 dengan sisa ruang diisi
 *  latar blur. Hasilnya dilihat sendiri: pita blur tebal di atas dan bawah,
 *  produk terjepit di sepertiga tengah — terlihat seperti foto ditempel, bukan
 *  packshot. Untuk shot yang justru dipilih karena ia tempat mata berhenti,
 *  itu langkah mundur dari klip generate yang digantikannya.
 *
 *  Foto produk e-commerce hampir selalu berisi produk di TENGAH dengan ruang
 *  kosong di sekelilingnya, jadi memotong sisi jauh lebih aman daripada
 *  menyisakan pita. Latar blur tetap dipasang di belakang sebagai jaring: bila
 *  fotonya jauh lebih lebar dari kanvas, sudut-sudutnya tetap terisi warna
 *  fotonya sendiri alih-alih hitam. */
export async function buildPackshotAsli(input: PackshotInput): Promise<string> {
  if (!fs.existsSync(input.fotoPath)) throw new Error(`foto produk tidak ada: ${input.fotoPath}`);
  fs.mkdirSync(path.dirname(input.outPath), { recursive: true });
  const frames = Math.max(1, Math.round(input.durationSec * FPS));
  const { width: W, height: H } = input;

  // Push-in dijalankan pada latar DAN produk sekaligus lewat zoompan di akhir
  // rantai, supaya keduanya bergerak sebagai satu gambar — bukan produk
  // melayang di atas latar yang diam.
  const langkah = ((ZOOM_AKHIR - 1) / frames).toFixed(6);
  const filter = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=0.03[bg]`,
    // Depan: penuhi kanvas lalu potong sisi. Sedikit lebih besar dari kanvas
    // (1,04) supaya push-in di akhir rantai tidak pernah menyingkap tepi.
    `[0:v]scale=${Math.round(W * 1.04)}:${Math.round(H * 1.04)}:force_original_aspect_ratio=increase,crop=${W}:${H}[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[flat]`,
    `[flat]zoompan=z='min(zoom+${langkah},${ZOOM_AKHIR})':d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1[v]`,
  ].join(";");

  await runFfmpeg([
    "-y", "-v", "error", "-loop", "1", "-i", input.fotoPath,
    "-filter_complex", filter, "-map", "[v]",
    "-t", String(input.durationSec),
    "-pix_fmt", "yuv420p", "-r", String(FPS),
    input.outPath,
  ]);
  if (!fs.existsSync(input.outPath)) throw new Error("packshot asli gagal dibuat");
  return input.outPath;
}

/** Apakah shot ini sebaiknya memakai foto asli, bukan video generate?
 *
 *  HANYA shot terakhir, HANYA kalau shotnya memang packshot tanpa orang, dan
 *  HANYA kalau videonya punya lebih dari satu shot — video satu-shot yang
 *  seluruhnya foto diam bukan iklan, itu slideshow. */
export function packshotAsliUntukShot(input: {
  index: number;
  jumlahShot: number;
  tanpaOrang: boolean;
}): boolean {
  return input.jumlahShot >= 2 && input.index === input.jumlahShot - 1 && input.tanpaOrang;
}
