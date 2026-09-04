/**
 * POTONG FOTO KE PRODUKNYA — buang poster, logo, dan tulisan di sekitarnya.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MASALAH YANG DIPECAHKAN
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian 4 Sep 2026: "kebanyakan product image terdiri dari poster
 * dan banyak tulisan, dapatkah system ai anda mendeteksi object-object selain
 * image yang ingin dibuatkan iklan?"
 *
 * Foto job be16d8f3 adalah banner: speaker di kiri, dan di sekelilingnya
 * "advance Digitals", "BLUETOOTH SPEAKER", "+2 Wireless Mic", "K-1812-C",
 * "1 YEAR WARRANTY", plus deretan ikon. Model video membaca seluruh gambar
 * sebagai adegan dan menyalin tulisan itu ke video sebagai bayangan.
 *
 * Memotong ke produknya saja membuang sumber bayangan itu SEBELUM satu pun
 * piksel dirender — jauh lebih murah dan lebih pasti daripada memintanya
 * dihindari lewat kalimat prompt.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA TIDAK DIBUATKAN KHUSUS "SPEAKER"
 * ────────────────────────────────────────────────────────────────────────────
 * Brian menanyakannya, dan jawabannya sengaja tidak begitu. Mengkodekan
 * "speaker" akan mengulang persis cacat yang baru saja dibereskan hari ini:
 * prompt yang dipaku ke botol serum lalu dikirim untuk semua produk. Yang
 * ditanyakan ke model penglihatan adalah "benda fisik yang dijual", dengan NAMA
 * PRODUK sebagai petunjuk — jadi ia bekerja untuk speaker, meja, keripik, dan
 * apa pun berikutnya tanpa daftar yang harus dirawat.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BATAS JUJURNYA
 * ────────────────────────────────────────────────────────────────────────────
 * Tulisan yang TERCETAK DI PRODUKNYA tetap ada, dan memang harus: itu label
 * aslinya. Yang dibuang hanya yang ada DI SEKITARNYA. Kalau tulisan poster
 * menimpa produknya, pemotongan tidak bisa menolong.
 *
 * Deteksi bisa gagal atau meleset. Kegagalan TIDAK menjatuhkan render: foto
 * asli dipakai apa adanya, dan kegagalannya dicatat.
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { config } from "../config";
import { panggilGemini } from "./gemini-panggil";

const MODEL = "gemini-flash-latest";

/** Kotak dalam koordinat ternormalkan 0..1 terhadap lebar/tinggi gambar. */
export interface KotakProduk {
  x0: number; y0: number; x1: number; y1: number;
}

/**
 * Margin di sekeliling produk, sebagai pecahan sisi kotaknya.
 *
 * Memotong PAS di tepi benda membuat frame terasa sesak dan memotong bayangan
 * jatuh yang justru membuatnya terlihat nyata. 8% cukup memberi ruang tanpa
 * mengembalikan tulisan poster ke dalam bingkai.
 */
const MARGIN = 0.08;

/**
 * Kotak yang terlalu besar berarti deteksinya TIDAK memisahkan apa pun.
 *
 * Kalau model mengembalikan hampir seluruh gambar, memotongnya tidak membuang
 * poster — ia hanya menambah satu langkah pemrosesan dan menyingkirkan margin
 * yang berguna. Dalam keadaan itu foto asli lebih baik dipakai apa adanya.
 */
const MAKS_LUAS = 0.82;

/** Kotak yang terlalu kecil hampir pasti salah tangkap (ikon, logo, badge). */
const MIN_LUAS = 0.04;

export function kotakMasukAkal(k: KotakProduk): boolean {
  const lebar = k.x1 - k.x0;
  const tinggi = k.y1 - k.y0;
  if (lebar <= 0 || tinggi <= 0) return false;
  const luas = lebar * tinggi;
  return luas >= MIN_LUAS && luas <= MAKS_LUAS;
}

/** Beri margin lalu jepit ke dalam gambar. */
export function kotakDenganMargin(k: KotakProduk): KotakProduk {
  const mx = (k.x1 - k.x0) * MARGIN;
  const my = (k.y1 - k.y0) * MARGIN;
  return {
    x0: Math.max(0, k.x0 - mx),
    y0: Math.max(0, k.y0 - my),
    x1: Math.min(1, k.x1 + mx),
    y1: Math.min(1, k.y1 + my),
  };
}

/** Ambil kotak produk dari jawaban model. Dipisah supaya bisa diuji tanpa jaringan. */
export function bacaKotak(teks: string): KotakProduk | null {
  // Model kadang membungkus JSON dalam pagar kode; ambil objek pertamanya.
  const m = teks.match(/\{[^{}]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const ambil = (k: string) => {
      const v = Number(o[k]);
      if (!Number.isFinite(v)) return null;
      // Sebagian model menjawab dalam 0..1000, sebagian dalam 0..1.
      return v > 1 ? v / 1000 : v;
    };
    const x0 = ambil("x0"), y0 = ambil("y0"), x1 = ambil("x1"), y1 = ambil("y1");
    if (x0 === null || y0 === null || x1 === null || y1 === null) return null;
    return { x0, y0, x1, y1 };
  } catch {
    return null;
  }
}

/**
 * Permintaan ke model penglihatan.
 *
 * DIPERSEMPIT setelah percobaan pertama: versi awal meminta "the ONE physical
 * product" dan mengembalikan kotak yang masih memuat lencana "18 inch",
 * "1 YEAR WARRANTY", dan potongan judul "SP" — lebih baik daripada foto utuh,
 * tapi tulisannya belum hilang, padahal justru itu yang disalin model video
 * jadi bayangan.
 *
 * Dua penajaman: kotaknya harus RAPAT ke badan produk, dan syarat "tidak boleh
 * memuat teks" dinyatakan sebagai SIFAT KOTAKNYA — bukan sebagai daftar hal
 * yang "diabaikan". Yang pertama bisa diperiksa model terhadap hasilnya
 * sendiri; yang kedua tidak.
 */
const PERMINTAAN = (namaProduk: string): string =>
  `This is a marketplace listing image for: "${namaProduk}".\n` +
  `Return the TIGHTEST bounding box around the main product's own body only.\n` +
  `The box MUST NOT contain any promotional text, headline, price, badge, seal, ` +
  `sticker, logo, icon, watermark, or inset picture. If a badge or text overlaps the ` +
  `edge of the product, pull that edge inward so the box excludes it.\n` +
  `Do not include separate accessory items placed beside the product.\n` +
  `Reply with ONLY this JSON and nothing else, using coordinates normalised 0..1 ` +
  `relative to image width and height:\n` +
  `{"x0":<left>,"y0":<top>,"x1":<right>,"y1":<bottom>}`;

async function deteksiKotak(berkas: string, namaProduk: string): Promise<KotakProduk | null> {
  if (!config.geminiApiKey) return null;
  const buf = fs.readFileSync(berkas);
  const meta = await sharp(berkas).metadata();
  const jenis = meta.format === "png" ? "image/png" : meta.format === "webp" ? "image/webp" : "image/jpeg";
  const hasil = await panggilGemini({
    model: MODEL,
    label: "potong-produk",
    // Pemotongan adalah PENYEMPURNAAN: kalau gagal, foto utuh tetap
    // menghasilkan video. Jadi sabarnya dibatasi — dua percobaan, 20 detik —
    // supaya Gemini yang sedang penuh tidak menambah menit ke setiap job.
    maksPercobaan: 2,
    timeoutMs: 20_000,
    body: {
      contents: [{
        parts: [
          { text: PERMINTAAN(namaProduk) },
          { inline_data: { mime_type: jenis, data: buf.toString("base64") } },
        ],
      }],
      generationConfig: { temperature: 0 },
    },
  });
  if (!hasil.ok) throw new Error(`deteksi produk HTTP ${hasil.status} setelah ${hasil.percobaan} percobaan`);
  const teks = hasil.teks;
  return bacaKotak(teks);
}

/**
 * Potong foto ke produknya. Kembalikan path baru, atau path asli kalau tidak
 * ada yang bisa/perlu dipotong.
 */
export async function potongKeProduk(
  berkas: string,
  namaProduk: string,
  dirKerja: string,
): Promise<{ path: string; dipotong: boolean; alasan: string }> {
  try {
    const kotak = await deteksiKotak(berkas, namaProduk);
    if (!kotak) return { path: berkas, dipotong: false, alasan: "produk tidak terdeteksi" };
    if (!kotakMasukAkal(kotak)) {
      return { path: berkas, dipotong: false, alasan: "kotak deteksi tidak masuk akal — dipakai foto utuh" };
    }
    const m = await sharp(berkas).metadata();
    const W = m.width ?? 0;
    const H = m.height ?? 0;
    if (!W || !H) return { path: berkas, dipotong: false, alasan: "dimensi tidak terbaca" };

    const k = kotakDenganMargin(kotak);
    const left = Math.round(k.x0 * W);
    const top = Math.round(k.y0 * H);
    const width = Math.max(1, Math.round((k.x1 - k.x0) * W));
    const height = Math.max(1, Math.round((k.y1 - k.y0) * H));

    fs.mkdirSync(dirKerja, { recursive: true });
    const keluar = path.join(dirKerja, `produk-${path.basename(berkas).replace(/\.\w+$/, "")}.png`);
    await sharp(berkas).extract({ left, top, width, height }).png().toFile(keluar);
    return {
      path: keluar,
      dipotong: true,
      alasan: `dipotong ke produk: ${W}x${H} -> ${width}x${height}`,
    };
  } catch (err) {
    // Deteksi yang gagal tidak boleh menjatuhkan render. Foto poster utuh tetap
    // menghasilkan video — kurang bersih, tapi ada.
    return { path: berkas, dipotong: false, alasan: `deteksi gagal: ${(err as Error).message}` };
  }
}
