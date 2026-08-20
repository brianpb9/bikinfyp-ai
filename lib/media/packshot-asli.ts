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
import { createHash } from "node:crypto";
import { runFfmpeg, probeVideoSize } from "./ffmpeg";

const FPS = 24;

/** Seberapa jauh push-in-nya. 1.0 -> 1.06 saja: packshot brand harus terasa
 *  TENANG. Zoom yang agresif membuat penutup terasa belum selesai, dan
 *  dokumen produksi Brian menuliskan penutup dikunci diam. */
const ZOOM_AKHIR = 1.06;

export interface PackshotInput {
  /** Foto produk asli dari brand. */
  fotoPath: string;
  durationSec: number;
  /** Dimensi target. WAJIB diambil dari klip yang akan digabung, BUKAN dari
   *  VisualSpec.width/height.
   *
   *  spec.width/height di shot-planner di-hardcode 720x1280, sementara TVC
   *  dirender 16:9 (1280x720). Versi pertama memakai spec, jadi packshot
   *  penutup TVC keluar 720x1280 sementara lima shot lainnya 1280x720 —
   *  digabung jadi satu berkas dengan dimensi campuran, yang tidak sah.
   *  Ketahuan hanya karena lembar kontaknya menolak disusun. */
  width: number;
  height: number;
  outPath: string;
}

/** Dimensi target diambil dari klip nyata yang akan digabung bersamanya.
 *  Satu sumber kebenaran: apa pun rasio yang benar-benar dirender provider,
 *  packshotnya mengikuti. */
export async function dimensiDariKlip(klipPath: string): Promise<{ width: number; height: number }> {
  return probeVideoSize(klipPath);
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

/** Berapa lama segmen packshot penutup. 1,8 dtk: cukup lama untuk membaca nama
 *  merek dengan tenang, cukup pendek untuk tidak terasa video membeku. */
export const PACKSHOT_EKOR_DTK = 1.8;

/** Hash isi foto — dipakai QC-10 untuk membuktikan segmen packshot memang
 *  berasal dari foto produk yang tercatat, bukan dari gambar lain. */
export function sidikFoto(fotoPath: string): string {
  return createHash("sha256").update(fs.readFileSync(fotoPath)).digest("hex");
}

/**
 * TAMBAHKAN segmen packshot foto asli di ujung video yang sudah jadi.
 *
 * Bedanya dengan packshotAsliUntukShot di atas: yang itu MENGGANTI shot
 * generate terakhir dan hanya berlaku kalau shot itu kebetulan tanpa orang.
 * Yang ini MENAMBAH segmen pendek untuk semua video — keputusan Brian 20 Agu
 * (jalan keluar A), sesudah render berbayar membuktikan model tetap mengarang
 * huruf pada label ("jddpgeer", "SOMSONG") di putaran prompt ketiga.
 *
 * Di level composer, tidak pernah dikirim ke Seedance: labelnya benar karena
 * ia memang foto produknya, bukan tafsiran model atas foto itu.
 *
 * Audionya melanjutkan bed ambient yang sama supaya penutup tidak jatuh ke
 * senyap mendadak — potong keras ke sunyi terbaca sebagai video rusak, bukan
 * sebagai akhir. Kalau bed tidak ada, dipakai senyap: concat menolak input
 * yang jumlah streamnya berbeda, jadi audio tetap harus ada.
 */
export async function appendPackshot(input: {
  videoPath: string;
  workDir: string;
  fotoPath: string;
  /** Bed ambient yang sama dengan video utama. Boleh kosong. */
  musicPath?: string;
  durationSec?: number;
}): Promise<{ path: string; ditambahkan: boolean; ekorSec: number; sidik?: string }> {
  const dur = input.durationSec ?? PACKSHOT_EKOR_DTK;
  if (!fs.existsSync(input.fotoPath)) {
    console.warn(`[packshot] foto produk tidak ada, penutup dilewati: ${input.fotoPath}`);
    return { path: input.videoPath, ditambahkan: false, ekorSec: 0 };
  }
  try {
    const { width, height } = await probeVideoSize(input.videoPath);
    const klip = path.join(input.workDir, "packshot-ekor.mp4");
    await buildPackshotAsli({ fotoPath: input.fotoPath, durationSec: dur, width, height, outPath: klip });

    // Audio untuk segmen: bed yang sama, atau senyap.
    const adaBed = !!input.musicPath && fs.existsSync(input.musicPath);
    const klipAudio = path.join(input.workDir, "packshot-ekor-audio.mp4");
    await runFfmpeg([
      "-y", "-v", "error", "-i", klip,
      ...(adaBed
        ? ["-stream_loop", "-1", "-i", input.musicPath!]
        : ["-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]),
      "-map", "0:v", "-map", "1:a", "-t", String(dur),
      "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-ac", "2", klipAudio,
    ]);

    const gabung = path.join(input.workDir, "output-packshot.mp4");
    await runFfmpeg([
      "-y", "-v", "error", "-i", input.videoPath, "-i", klipAudio,
      "-filter_complex",
      `[0:v]scale=${width}:${height},setsar=1[v0];[1:v]scale=${width}:${height},setsar=1[v1];` +
        `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "2",
      gabung,
    ]);
    return { path: gabung, ditambahkan: true, ekorSec: dur, sidik: sidikFoto(input.fotoPath) };
  } catch (err) {
    // Sama seperti endcard: kegagalan di sini paling buruk menghilangkan
    // penutupnya, tidak boleh merusak video yang sudah benar.
    console.warn(`[packshot] gagal menambahkan penutup: ${(err as Error).message}`);
    return { path: input.videoPath, ditambahkan: false, ekorSec: 0 };
  }
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
