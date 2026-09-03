/**
 * Buang klausa negasi-tentang-orang dari arahan visual — secara mekanis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MEMBERI TAHU MODEL TIDAK CUKUP
 * ────────────────────────────────────────────────────────────────────────────
 * Aturannya sudah ada sejak lama, ditulis dengan contoh, dan pagi 3 Sep 2026
 * dipertajam lagi sampai menyebut nama field-nya ("THIS APPLIES TO
 * visual_direction, start_state AND action"). Sesudah itu, di E2E produksi
 * sore harinya, penulis tetap menulis:
 *
 *     "no face"   "not readable hands"   "no hands"   "face not"
 *
 * Dua tier gugur karenanya — ultra habis di percobaan ketiga tanpa naskah.
 *
 * Kesimpulannya bukan "aturannya kurang keras". Ini masalah MEKANIS: model
 * bahasa memang cenderung menegasikan saat diminta menghindari sesuatu, dan
 * memintanya tiga kali lalu menyerah berarti membayar tiga panggilan model
 * untuk kegagalan yang bisa diperbaiki tanpa satu panggilan pun.
 *
 * Masalah mekanis pantas mendapat perbaikan mekanis.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * INI MEMPERKUAT PENJAGAAN, BUKAN MELONGGARKANNYA
 * ────────────────────────────────────────────────────────────────────────────
 * Yang dijaga aturan itu adalah: negasi tentang orang membuat model video
 * MEMUNCULKAN yang dinegasikan ("no other residents" adalah cara mendapatkan
 * penghuni lain). Menolak naskahnya hanya BERHARAP penulis patuh di percobaan
 * berikutnya. Membuang klausanya MEMASTIKAN kalimat itu tidak pernah sampai ke
 * model video — jaminan, bukan harapan.
 *
 * Yang dibuang KLAUSA UTUH, bukan kata negasinya saja. Menghapus "no" dari
 * "close-up, no face visible" menyisakan "close-up, visible" — sampah yang
 * lolos pemeriksa dan tetap masuk ke prompt. Sebuah klausa yang isinya
 * ketiadaan tidak kehilangan apa pun kalau dihapus seluruhnya: yang tersisa
 * tetap menyebut apa yang ADA, dan itu memang bentuk yang kita inginkan.
 *
 * Kalau pembuangan menyisakan terlalu sedikit, teksnya DIKEMBALIKAN UTUH dan
 * validator tetap menolaknya. Lebih baik naskah ditolak daripada arahan visual
 * jadi kosong dan model video mengarang sendiri seluruh adegannya.
 */

import { periksaPemicu } from "../media/pemicu-filter";

/** Panjang minimal yang masih layak disebut arahan, dalam karakter. */
const SISA_MINIMAL = 12;

export interface HasilBersih {
  teks: string;
  /** Klausa yang dibuang — untuk log, supaya perbaikan diam-diam tetap terlihat. */
  dibuang: string[];
}

/**
 * Buang klausa yang memicu deteksi negasi-tentang-orang.
 *
 * Pemicunya dibaca dari periksaPemicu(), sumber yang SAMA dengan yang dipakai
 * validator menolak. Dua daftar pola yang harus sepakat pasti menyimpang;
 * di sini hanya ada satu.
 */
export function bersihkanNegasiOrang(teks: string, namaProduk?: string | null): HasilBersih {
  if (!teks.trim()) return { teks, dibuang: [] };
  const adaNegasi = (s: string) =>
    periksaPemicu(s, { namaProduk: namaProduk ?? undefined }).some((t) => t.jenis === "negasi-orang");
  if (!adaNegasi(teks)) return { teks, dibuang: [] };

  // Dipecah pada koma dan titik: itu batas klausa yang dipakai penulis, dan
  // arahan visual memang ditulis sebagai daftar frasa.
  const potong = teks.split(/([,.;])/);
  const simpan: string[] = [];
  const dibuang: string[] = [];
  for (let i = 0; i < potong.length; i += 2) {
    const klausa = potong[i];
    const pemisah = potong[i + 1] ?? "";
    if (klausa.trim() && adaNegasi(klausa)) {
      dibuang.push(klausa.trim());
      continue;
    }
    simpan.push(klausa + pemisah);
  }

  const bersih = simpan.join("").replace(/\s*([,.;])\s*/g, "$1 ").replace(/^[\s,.;]+/, "").replace(/\s+/g, " ").trim()
    .replace(/[,;]\s*$/, "");

  // Pembuangan yang menyisakan terlalu sedikit DIBATALKAN — lihat catatan di
  // atas. Begitu juga kalau ternyata masih ada negasi yang tersisa: kalau
  // pemecahan klausanya tidak berhasil memisahkannya, biarkan validator yang
  // memutuskan daripada mengirim teks setengah bersih.
  if (bersih.length < SISA_MINIMAL || adaNegasi(bersih)) return { teks, dibuang: [] };
  return { teks: bersih, dibuang };
}
