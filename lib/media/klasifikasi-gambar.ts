// FOTO PRODUK vs GRAFIS PROMOSI — diputuskan saat unggah, sekali.
//
// Kenapa ini ada. Model video memperlakukan gambar referensi sebagai "seperti
// inilah produknya". Kalau yang dikirim banner marketing — produk kecil di
// tengah, judul besar "Kulit Cerah Rahasianya Apa?", badge diskon, bunga
// properti — model menyalin SEMUANYA: teks banner ikut dilukis ke kemasan,
// dan hasilnya kemasan berhuruf karangan. Itu bukan kegagalan model, itu
// kegagalan bahan.
//
// Sudah pernah terjadi dan sudah pernah ditandai manusia: berkas fixture
// bernama `02-banner-promo-JANGAN-DIPAKAI.jpeg` di handover JJ Glow 18 Agu.
// Yang belum ada sampai sekarang: kode yang tahu bedanya.
//
// DUA SINYAL, keduanya murah dan tidak butuh model:
//
//   1. RASIO AREA TEKS — total luas kotak kata OCR dibagi luas gambar. Banner
//      dirancang supaya terbaca dari jauh, jadi hurufnya besar; foto produk
//      hanya punya teks label yang kecil.
//   2. JUMLAH KATA MEYAKINKAN — banner membawa headline, sub-headline, daftar
//      klaim, dan badge harga sekaligus.
//
// RAGU = PROMOSI (perintah Brian 20 Agu). Alasannya asimetris: menolak foto
// produk yang sah merepotkan satu pengguna dan ia bisa unggah ulang; menerima
// banner merusak SETIAP render sesudahnya dan baru ketahuan setelah dibayar.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const jalankan = promisify(execFile);

export type JenisGambar = "product_photo" | "promotional_graphic";

export interface HasilKlasifikasi {
  jenis: JenisGambar;
  /** Boleh dipakai sebagai referensi visual untuk render. */
  layakReferensi: boolean;
  /** Total luas kotak kata OCR / luas gambar. */
  rasioAreaTeks: number;
  /** Kata >=3 huruf dengan keyakinan >= MIN_CONF. */
  jumlahKata: number;
  /** Alasan siap-tampil ke pengguna. */
  alasan: string;
}

/** Ambang keyakinan OCR — sama dengan gerbang label (label-terbaca.ts). */
const MIN_CONF = 60;

/**
 * Ambang DITURUNKAN DARI FIXTURE, bukan ditebak.
 *
 * Diukur 20 Agu atas berkas nyata (scripts/ukur-klasifikasi.ts):
 *
 *   01-packshot-bersih-351px.webp        rasio 0,0103  kata  2   foto produk
 *   canary-glow.jpg                      rasio 0,0014  kata  4   foto produk
 *   03-thumbnail.jpeg                    rasio 0,0024  kata  1   foto produk
 *   02-banner-promo-JANGAN-DIPAKAI.jpeg  rasio 0,0339  kata  2   BANNER
 *   04-crop-banner-JANGAN-DIPAKAI.png    rasio 0,0692  kata 23   BANNER
 *
 * Jurangnya bersih pada RASIO: foto produk berhenti di 0,0103, banner mulai
 * di 0,0339. Ambang 0,02 duduk di tengah jurang itu.
 *
 * JUMLAH KATA bukan sinyal yang bisa berdiri sendiri, dan itu ketahuan dari
 * fixture: banner promo 02 hanya membawa DUA kata meyakinkan ("Kulit Cerah
 * Rahasianya Apa?" — sisanya gagal OCR) sementara foto produk canary membawa
 * empat. Ia dipertahankan sebagai jaring kedua dengan ambang longgar (6),
 * bukan sebagai penentu.
 */
const AMBANG_RASIO = 0.02;
const AMBANG_KATA = 6;

export async function klasifikasiGambar(fotoPath: string): Promise<HasilKlasifikasi> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klasifikasi-"));
  try {
    // Dinormalkan ke lebar tetap supaya rasio area bisa dibandingkan antar
    // gambar dengan resolusi berbeda-beda.
    const png = path.join(dir, "besar.png");
    await jalankan("ffmpeg", ["-y", "-v", "error", "-i", fotoPath, "-vf", "scale=1440:-2:flags=lanczos", png],
      { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
    const { stdout: ukuran } = await jalankan("ffprobe", ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", png]);
    const [w, h] = ukuran.trim().split(",").map(Number);
    const luas = Math.max(1, (w || 1440) * (h || 1440));

    const { stdout } = await jalankan("tesseract", [png, "stdout", "-l", "eng", "--psm", "11", "tsv"],
      { timeout: 20_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024 });

    let areaTeks = 0;
    let jumlahKata = 0;
    for (const baris of stdout.split("\n").slice(1)) {
      const k = baris.split("\t");
      if (k.length < 12) continue;
      const conf = Number(k[10]);
      const teks = (k[11] ?? "").replace(/[^A-Za-z0-9]/g, "");
      if (!Number.isFinite(conf) || conf < MIN_CONF || teks.length < 3) continue;
      const lw = Number(k[8]);
      const lh = Number(k[9]);
      if (!Number.isFinite(lw) || !Number.isFinite(lh)) continue;
      areaTeks += lw * lh;
      jumlahKata++;
    }

    const rasioAreaTeks = areaTeks / luas;
    const promosi = rasioAreaTeks >= AMBANG_RASIO || jumlahKata >= AMBANG_KATA;
    return promosi
      ? {
          jenis: "promotional_graphic",
          layakReferensi: false,
          rasioAreaTeks,
          jumlahKata,
          alasan:
            "Ini terbaca seperti materi promosi (banyak tulisan besar), bukan foto produk. " +
            "Untuk acuan video, pakai foto produknya saja — tanpa tulisan promo, badge harga, atau judul.",
        }
      : {
          jenis: "product_photo",
          layakReferensi: true,
          rasioAreaTeks,
          jumlahKata,
          alasan: "Foto produk.",
        };
  } catch (err) {
    // RAGU = PROMOSI, dan gagal memeriksa termasuk ragu.
    //
    // Ini KEBALIKAN dari gerbang label (label-terbaca.ts), yang meloloskan
    // unggahan saat OCR mati supaya pengguna tidak terkunci oleh alat kita.
    // Bedanya konsekuensi: di sana yang gagal cuma pemeriksaan mutu foto; di
    // sini yang salah menetapkan BAHAN untuk setiap render sesudahnya.
    console.warn(`[klasifikasi] gagal memeriksa, dianggap promosi: ${(err as Error).message}`);
    return {
      jenis: "promotional_graphic",
      layakReferensi: false,
      rasioAreaTeks: 0,
      jumlahKata: 0,
      alasan: "Kami belum bisa memeriksa gambar ini. Coba unggah ulang foto produknya ya.",
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
