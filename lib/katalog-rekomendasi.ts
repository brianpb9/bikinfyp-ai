/**
 * KATALOG YANG DIREKOMENDASIKAN — disusun dari modal yang DIUKUR, bukan ditebak.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MODAL PER VIDEO (15 detik, mode r2v — bawaan produksi)
 * ────────────────────────────────────────────────────────────────────────────
 * Semua angka di bawah berasal dari render berbayar sungguhan pada 2 Sep 2026,
 * bukan dari brosur maupun dari estimasi BRD lama:
 *
 *   Standard — Grok Imagine (kie.ai), 480p
 *     14,4 kredit untuk 6 detik = 2,4 kredit/detik.
 *     Kredit kie.ai = Rp100 (Rp1.000.000 / 10.000 kredit).
 *     15 dtk x 2,4 x Rp100 ................................ Rp 3.600
 *
 *   Premium — Seedance 2.0 mini (BytePlus), 720p
 *     87.300 token untuk 4 detik = 21.825 token/detik.
 *     Tarif tagihan $4,41 / 1 juta token; kurs Rp16.300.
 *     15 dtk x 21.825 x 4,41/1jt x 16.300 ................. Rp 23.533
 *
 *   Ultra — Seedance 2.5 (BytePlus), 720p
 *     87.300 token untuk 4 detik — ANGKA YANG SAMA PERSIS.
 *     Konsumsi token tidak bergantung versi model .......... Rp 23.533
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA MODALNYA DIBEBANI LAGI SEBELUM DIPAKAI MENGHITUNG MARGIN
 * ────────────────────────────────────────────────────────────────────────────
 * Biaya model bukan seluruh biaya sebuah video:
 *
 *   +10%  render gagal / diulang. Kita tetap membayar penyedia untuk klip yang
 *         tidak lolos QC, sementara jatah pembeli dikembalikan. Ini biaya nyata
 *         yang tidak pernah muncul di tagihan manapun sebagai baris tersendiri.
 *   +Rp400 naskah (LLM) + penyimpanan + bandwidth per video.
 *
 * Dan per TRANSAKSI, bukan per video:
 *   +Rp4.000 biaya gateway. Ini ANGKA CADANGAN untuk VA (paling mahal per
 *         transaksi); QRIS jauh lebih murah karena berbasis persentase. Ganti
 *         dengan angka dari kontrak Duitku begitu tersedia — pada paket
 *         Rp50.000, selisih ini saja bergerak 8% dari pendapatan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ATURAN YANG MENGIKAT KATALOG INI
 * ────────────────────────────────────────────────────────────────────────────
 * 1. Setiap paket DAN setiap harga satuan wajib bermargin >= 20%.
 * 2. Paket harus lebih murah per video daripada membeli satuan — kalau tidak,
 *    paket adalah hukuman bagi yang membeli banyak.
 * Keduanya ditegakkan tes, bukan diperiksa dengan mata.
 */

import { config } from "./config";
import type { JenisVideo } from "./kredit-video";

/** Bagian biaya yang tidak muncul di tagihan penyedia video. */
export const BEBAN_GAGAL = 0.10;
export const BEBAN_TETAP_PER_VIDEO_IDR = 400;
/** Cadangan biaya gateway per transaksi (VA). Ganti dengan angka kontrak. */
export const BIAYA_GATEWAY_IDR = 4_000;

/** Margin minimum yang boleh dijual. Keputusan Brian 2 Sep 2026. */
export const MARGIN_MINIMUM = 0.20;

/** Modal satu video, sudah termasuk beban gagal dan biaya tetap. */
export function modalPerVideo(jenis: JenisVideo): number {
  const dasar = config.tiers[jenis]?.cogsIdr ?? 0;
  return Math.round(dasar * (1 + BEBAN_GAGAL)) + BEBAN_TETAP_PER_VIDEO_IDR;
}

/**
 * Harga satuan yang direkomendasikan.
 *
 * Marginnya sengaja LEBIH TINGGI daripada paket: yang membeli satuan membayar
 * kenyamanan tidak berkomitmen, dan selisih itulah yang membuat paket terasa
 * hemat tanpa harus menekan margin paket di bawah batas.
 */
export const HARGA_SATUAN: Record<JenisVideo, number> = {
  standard: 8_000,
  premium: 40_000,
  // Modalnya SAMA dengan premium. Selisih Rp10.000 ini murni posisi, bukan
  // biaya — dan harus disebut apa adanya, bukan dibungkus sebagai "lebih
  // mahal karena modelnya lebih baru".
  ultra: 50_000,
};

export interface PaketRekomendasi {
  id: string;
  nama: string;
  keterangan: string;
  hargaIdr: number;
  kuota: Record<JenisVideo, number>;
  masaHari: number;
  urutan: number;
}

/**
 * Empat paket, naik bertahap.
 *
 * Titik masuk Rp50.000 (permintaan Brian) sengaja berisi Standard saja: dengan
 * margin 20%, satu video Premium sendirian sudah memakan Rp26.286 dari jatah
 * modal Rp40.000 — paket masuk yang memuatnya akan menyisakan dua-tiga video
 * total, dan itu terasa seperti sampel, bukan paket.
 *
 * Standard justru keunggulan kita yang sesungguhnya: mesin lain di pasar yang
 * memakai Seedance berbiaya sekelas Premium kita, sementara Standard berbiaya
 * seperenamnya dengan audio bawaan.
 */
export const PAKET_REKOMENDASI: PaketRekomendasi[] = [
  {
    id: "mulai",
    nama: "Mulai",
    keterangan: "Buat yang baru mencoba konten harian",
    hargaIdr: 50_000,
    kuota: { standard: 8, premium: 0, ultra: 0 },
    masaHari: 30,
    urutan: 1,
  },
  {
    id: "kreator",
    nama: "Kreator",
    keterangan: "Posting tiap hari, sesekali butuh kualitas tinggi",
    hargaIdr: 150_000,
    kuota: { standard: 14, premium: 2, ultra: 0 },
    masaHari: 30,
    urutan: 2,
  },
  {
    id: "bisnis",
    nama: "Bisnis",
    keterangan: "Banyak produk, butuh variasi dan kualitas iklan",
    hargaIdr: 350_000,
    kuota: { standard: 30, premium: 4, ultra: 1 },
    masaHari: 30,
    urutan: 3,
  },
  {
    id: "studio",
    nama: "Studio",
    keterangan: "Produksi konten skala agensi",
    hargaIdr: 750_000,
    kuota: { standard: 60, premium: 10, ultra: 2 },
    masaHari: 30,
    urutan: 4,
  },
];

export interface HitunganPaket {
  modalIdr: number;
  marginRupiah: number;
  marginPersen: number;
  nilaiSatuanIdr: number;
  hematPersen: number;
  totalVideo: number;
}

export function hitungPaket(p: PaketRekomendasi): HitunganPaket {
  const modalVideo = (Object.keys(p.kuota) as JenisVideo[]).reduce(
    (n, j) => n + p.kuota[j] * modalPerVideo(j),
    0,
  );
  const modalIdr = modalVideo + BIAYA_GATEWAY_IDR;
  const nilaiSatuanIdr = (Object.keys(p.kuota) as JenisVideo[]).reduce(
    (n, j) => n + p.kuota[j] * HARGA_SATUAN[j],
    0,
  );
  return {
    modalIdr,
    marginRupiah: p.hargaIdr - modalIdr,
    marginPersen: (p.hargaIdr - modalIdr) / p.hargaIdr,
    nilaiSatuanIdr,
    hematPersen: nilaiSatuanIdr ? (nilaiSatuanIdr - p.hargaIdr) / nilaiSatuanIdr : 0,
    totalVideo: (Object.keys(p.kuota) as JenisVideo[]).reduce((n, j) => n + p.kuota[j], 0),
  };
}

/** Margin satu harga satuan terhadap modalnya. */
export function marginSatuan(jenis: JenisVideo): number {
  const harga = HARGA_SATUAN[jenis];
  return (harga - modalPerVideo(jenis)) / harga;
}
