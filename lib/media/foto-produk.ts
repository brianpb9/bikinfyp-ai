/**
 * KELAYAKAN FOTO PRODUK — diperiksa SEBELUM uang keluar.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KEGAGALAN YANG DIPERBAIKI INI (job be16d8f3, 4 Sep 2026)
 * ────────────────────────────────────────────────────────────────────────────
 * Foto yang dipakai adalah banner promosi marketplace 320x320: "advance
 * Digitals · BLUETOOTH SPEAKER · +2 Wireless Mic · K-1812-C · 1 YEAR WARRANTY",
 * lengkap dengan ikon. Dua akibatnya terlihat langsung di video jadi:
 *
 *   1. Model MENYALIN tulisan banner itu dan menempelkannya setengah
 *      transparan di sepanjang video — inilah "bayangan" yang dilaporkan Brian.
 *   2. Videonya keluar 960x960 PERSEGI, bukan 720x1280, karena Grok mengikuti
 *      rasio gambar acuannya dan mengabaikan parameter aspect_ratio.
 *
 * Rp13.500 keluar untuk tiga percobaan yang semuanya ditolak QC.
 *
 * Sampai hari ini TIDAK ADA satu pun pemeriksaan ukuran atau isi foto di
 * seluruh alur: kami mengambil `og:image` marketplace apa adanya, dan itu
 * memang thumbnail.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MEMBLOKIR, DAN KENAPA TIDAK TERLALU KETAT
 * ────────────────────────────────────────────────────────────────────────────
 * LAYER2 §6.2 menulis ambang idealnya: "foto asli >=1000 px latar polos (351 px
 * = label ngawur permanen)". Memblokir semua di bawah 1000 px akan menolak
 * sebagian besar tautan marketplace yang sah — obat yang lebih buruk daripada
 * penyakitnya.
 *
 * Jadi dua tingkat:
 *   - DI BAWAH AMBANG_TOLAK: diblokir. Di ukuran ini labelnya terbukti ngawur
 *     permanen, dan merender berarti membakar uang untuk hasil yang pasti
 *     ditolak QC.
 *   - Antara itu dan AMBANG_IDEAL: diloloskan dengan peringatan, supaya
 *     pemiliknya bisa memilih foto yang lebih baik tanpa dipaksa.
 *
 * Teks di foto TIDAK memblokir. Banyak produk memang berlabel, dan menolaknya
 * akan menolak produk yang sah. Yang dilakukan: memperingatkan, karena teks
 * yang banyak memang akan disalin model.
 */

import fs from "node:fs";
import sharp from "sharp";
import { runFf } from "./ffmpeg";

/** Di bawah ini label terbukti ngawur permanen (LAYER2 §6.2: 351 px). */
export const AMBANG_TOLAK_PX = 400;

/** Ukuran yang benar-benar aman menurut LAYER2 §6.2. */
export const AMBANG_IDEAL_PX = 1000;

/**
 * Berapa banyak kata terbaca sebelum foto disebut "penuh tulisan".
 *
 * Label produk biasa menyisakan beberapa kata (nama merek, varian). Banner
 * promosi menyisakan belasan. Sembilan dipilih sebagai batas: cukup longgar
 * untuk label sungguhan, cukup ketat untuk menangkap banner seperti milik job
 * be16d8f3 yang memuat belasan kata pemasaran.
 */
export const AMBANG_KATA_BANNER = 9;

export interface PeriksaFoto {
  lebar: number;
  tinggi: number;
  /** Foto terlalu kecil untuk dirender sama sekali. */
  ditolak: boolean;
  /** Alasan siap-tampil untuk pembeli, atau null kalau lolos. */
  alasanTolak: string | null;
  /** Hal yang perlu diketahui tapi tidak memblokir. */
  peringatan: string[];
  /** Kata yang terbaca OCR di foto — kosong kalau OCR tidak tersedia. */
  kataTerbaca: number;
}

/** Rasio 9:16 dalam angka, dipakai memutuskan perlu-tidaknya normalisasi. */
const RASIO_TEGAK = 9 / 16;

export function perluDitegakkan(lebar: number, tinggi: number): boolean {
  if (!lebar || !tinggi) return false;
  const rasio = lebar / tinggi;
  // Toleransi 5%: foto yang sudah mendekati 9:16 tidak perlu disentuh, dan
  // menyentuhnya hanya menambah satu langkah pemrosesan tanpa manfaat.
  return Math.abs(rasio - RASIO_TEGAK) / RASIO_TEGAK > 0.05;
}

async function hitungKataOcr(berkas: string): Promise<number> {
  try {
    const { stdout } = await runFf("tesseract", [berkas, "stdout", "-l", "eng", "--psm", "11"]);
    return stdout
      .split(/\s+/)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
      .filter((w) => w.length >= 3).length;
  } catch {
    // OCR tidak tersedia bukan alasan menolak foto. Ia hanya membuat kita
    // kehilangan satu peringatan, bukan membuat fotonya jadi buruk.
    return 0;
  }
}

export async function periksaFotoProduk(berkas: string): Promise<PeriksaFoto> {
  if (!fs.existsSync(berkas)) {
    return { lebar: 0, tinggi: 0, ditolak: true, alasanTolak: "Foto produknya tidak ditemukan.", peringatan: [], kataTerbaca: 0 };
  }
  const meta = await sharp(berkas).metadata();
  const lebar = meta.width ?? 0;
  const tinggi = meta.height ?? 0;
  const sisiTerkecil = Math.min(lebar, tinggi);
  const peringatan: string[] = [];

  if (sisiTerkecil > 0 && sisiTerkecil < AMBANG_TOLAK_PX) {
    return {
      lebar, tinggi, ditolak: true, kataTerbaca: 0, peringatan,
      alasanTolak:
        `Foto produknya terlalu kecil (${lebar}x${tinggi} piksel). Di ukuran ini tulisan pada produk ` +
        `akan keluar berantakan di video. Unggah foto produk yang lebih besar — minimal ${AMBANG_TOLAK_PX} piksel, ` +
        `paling bagus ${AMBANG_IDEAL_PX} piksel ke atas dengan latar polos.`,
    };
  }
  if (sisiTerkecil > 0 && sisiTerkecil < AMBANG_IDEAL_PX) {
    peringatan.push(
      `Foto produknya ${lebar}x${tinggi} piksel. Masih bisa dipakai, tapi tulisan kecil di produk mungkin kurang tajam. ` +
      `Foto ${AMBANG_IDEAL_PX} piksel ke atas hasilnya lebih rapi.`,
    );
  }

  const kataTerbaca = await hitungKataOcr(berkas);
  if (kataTerbaca >= AMBANG_KATA_BANNER) {
    peringatan.push(
      `Fotonya banyak tulisan promo (${kataTerbaca} kata terbaca). Tulisan itu bisa ikut tersalin ke video ` +
      `sebagai bayangan. Foto produk polos tanpa tulisan tambahan hasilnya jauh lebih bersih.`,
    );
  }
  if (perluDitegakkan(lebar, tinggi)) {
    peringatan.push("Fotonya bukan format tegak 9:16 — kami akan menyesuaikannya otomatis sebelum render.");
  }

  return { lebar, tinggi, ditolak: false, alasanTolak: null, peringatan, kataTerbaca };
}
