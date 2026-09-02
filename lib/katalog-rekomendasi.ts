/**
 * KATALOG YANG DIREKOMENDASIKAN — disusun dari modal yang DIUKUR, bukan ditebak.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MODAL PER VIDEO (15 detik, mode r2v — bawaan produksi)
 * ────────────────────────────────────────────────────────────────────────────
 * Semua angka di bawah berasal dari render berbayar sungguhan pada 2 Sep 2026,
 * bukan dari brosur maupun dari estimasi BRD lama:
 *
 *   Standard — Grok Imagine (kie.ai), 720p
 *     27 kredit untuk 6 detik = 4,5 kredit/detik. Di 480p ia cuma 2,4 —
 *     resolusi hampir melipatgandakan biayanya, jadi angka 480p tidak lagi
 *     berlaku sejak 720p jadi bawaan.
 *     Kredit kie.ai = Rp100 (Rp1.000.000 / 10.000 kredit).
 *     15 dtk x 4,5 x Rp100 ................................ Rp 6.750
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
 * Ketiganya 720p, 15 detik. Yang membedakan paket adalah MODEL, bukan
 * resolusi maupun durasi (keputusan Brian 2 Sep 2026).
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
 * 1. Paket wajib mencapai margin TARGET per jenis: 20% untuk Standard dan
 *    Premium, 30% untuk Ultra (keputusan Brian 2 Sep 2026). Paket campuran
 *    memakai target tertimbang menurut porsi modal tiap jenis.
 * 2. Harga satuan bermargin LEBIH TINGGI daripada paket. Bukan keserakahan:
 *    kalau satuan dan paket sama-sama 20%, paket tidak lagi lebih murah per
 *    video, dan "paket" cuma jadi nama lain untuk membeli borongan.
 * 3. Paket harus lebih murah per video daripada membeli satuan — kalau tidak,
 *    paket adalah hukuman bagi yang membeli banyak.
 * Ketiganya ditegakkan tes, bukan diperiksa dengan mata.
 */

import { config } from "./config";
import type { JenisVideo } from "./kredit-video";

/** Bagian biaya yang tidak muncul di tagihan penyedia video. */
export const BEBAN_GAGAL = 0.10;
export const BEBAN_TETAP_PER_VIDEO_IDR = 400;
/** Cadangan biaya gateway per transaksi (VA). Ganti dengan angka kontrak. */
export const BIAYA_GATEWAY_IDR = 4_000;

/**
 * Margin TARGET per jenis video — keputusan Brian 2 Sep 2026.
 *
 * Ultra lebih tinggi bukan karena modalnya lebih mahal (modalnya sama persis
 * dengan Premium), melainkan karena posisinya: ia dibeli orang yang memang
 * mencari kualitas tertinggi, dan permintaan di titik itu tidak setipis di
 * titik masuk.
 */
export const MARGIN_TARGET: Record<JenisVideo, number> = {
  standard: 0.20,
  premium: 0.20,
  ultra: 0.30,
};

/** Batas bawah yang tidak boleh dilanggar paket mana pun. */
export const MARGIN_MINIMUM = 0.20;

/** Margin satuan sengaja di atas target paket — lihat aturan 2 di atas. */
export const MARGIN_SATUAN: Record<JenisVideo, number> = {
  standard: 0.40,
  premium: 0.40,
  ultra: 0.50,
};

/** Modal satu video, sudah termasuk beban gagal dan biaya tetap. */
export function modalPerVideo(jenis: JenisVideo): number {
  const dasar = config.tiers[jenis]?.cogsIdr ?? 0;
  return Math.round(dasar * (1 + BEBAN_GAGAL)) + BEBAN_TETAP_PER_VIDEO_IDR;
}

/** Dibulatkan ke atas ke kelipatan Rp1.000 — harga jual jangan berekor. */
function bulatkanKeAtas(n: number, kelipatan = 1_000): number {
  return Math.ceil(n / kelipatan) * kelipatan;
}

/**
 * Harga satuan yang direkomendasikan — DITURUNKAN dari modal, bukan diketik.
 *
 * Marginnya sengaja lebih tinggi daripada paket: yang membeli satuan membayar
 * kenyamanan tidak berkomitmen, dan selisih itulah yang membuat paket
 * benar-benar hemat tanpa menekan margin paket di bawah targetnya.
 */
export const HARGA_SATUAN: Record<JenisVideo, number> = {
  standard: bulatkanKeAtas(modalPerVideo("standard") / (1 - MARGIN_SATUAN.standard)),
  premium: bulatkanKeAtas(modalPerVideo("premium") / (1 - MARGIN_SATUAN.premium)),
  ultra: bulatkanKeAtas(modalPerVideo("ultra") / (1 - MARGIN_SATUAN.ultra)),
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
/**
 * Harga paket yang MENCAPAI target margin tiap jenis di dalamnya.
 *
 * Paket campuran memakai target tertimbang: porsi modal Standard dan Premium
 * dihargai pada 20%, porsi Ultra pada 30%. Biaya gateway ikut dihargai pada
 * target terendah supaya ia tidak diam-diam memakan margin.
 */
function hargaUntuk(kuota: Record<JenisVideo, number>): number {
  let harga = 0;
  for (const j of Object.keys(kuota) as JenisVideo[]) {
    if (!kuota[j]) continue;
    harga += (kuota[j] * modalPerVideo(j)) / (1 - MARGIN_TARGET[j]);
  }
  harga += BIAYA_GATEWAY_IDR / (1 - MARGIN_MINIMUM);
  // Dibulatkan ke atas ke kelipatan Rp5.000: harga jual yang berekor
  // ("Rp168.528") terbaca seperti hasil hitungan, bukan seperti penawaran —
  // dan membulatkan ke ATAS berarti margin tidak pernah turun di bawah target
  // karena pembulatan.
  return bulatkanKeAtas(harga, 5_000);
}

/**
 * Empat paket, naik bertahap. ISINYA yang ditetapkan di sini; HARGANYA
 * dihitung dari modal supaya tidak mungkin meleset dari target margin.
 *
 * Titik masuknya naik dari Rp50.000 ke Rp65.000 sejak 720p jadi bawaan:
 * modal Standard naik dari Rp3.600 ke Rp6.750 per video, jadi Rp50.000 hanya
 * cukup untuk 4 video pada margin 20% — dan paket 4 video nyaris tidak lebih
 * murah daripada membeli satuan. Enam video pada Rp65.000 memberi penghematan
 * yang benar-benar terasa.
 */
const ISI_PAKET: { id: string; nama: string; keterangan: string; kuota: Record<JenisVideo, number>; urutan: number }[] = [
  {
    id: "mulai",
    nama: "Mulai",
    keterangan: "Buat yang baru mencoba konten harian",
    kuota: { standard: 6, premium: 0, ultra: 0 },
    urutan: 1,
  },
  {
    id: "kreator",
    nama: "Kreator",
    keterangan: "Posting tiap hari, sesekali butuh kualitas tinggi",
    kuota: { standard: 10, premium: 2, ultra: 0 },
    urutan: 2,
  },
  {
    id: "bisnis",
    nama: "Bisnis",
    keterangan: "Banyak produk, butuh variasi dan kualitas iklan",
    kuota: { standard: 20, premium: 5, ultra: 1 },
    urutan: 3,
  },
  {
    id: "studio",
    nama: "Studio",
    keterangan: "Produksi konten skala agensi",
    kuota: { standard: 40, premium: 12, ultra: 3 },
    urutan: 4,
  },
];

export const PAKET_REKOMENDASI: PaketRekomendasi[] = ISI_PAKET.map((p) => ({
  ...p,
  hargaIdr: hargaUntuk(p.kuota),
  masaHari: 30,
}));

/**
 * Target margin tertimbang sebuah paket — porsi modal tiap jenis dihargai
 * pada targetnya sendiri. Dipakai tes untuk memeriksa bahwa harga benar-benar
 * MENCAPAI target, bukan sekadar melewati batas bawah.
 */
export function targetMarginPaket(kuota: Record<JenisVideo, number>): number {
  let modal = BIAYA_GATEWAY_IDR;
  let hargaTarget = BIAYA_GATEWAY_IDR / (1 - MARGIN_MINIMUM);
  for (const j of Object.keys(kuota) as JenisVideo[]) {
    if (!kuota[j]) continue;
    const m = kuota[j] * modalPerVideo(j);
    modal += m;
    hargaTarget += m / (1 - MARGIN_TARGET[j]);
  }
  return (hargaTarget - modal) / hargaTarget;
}

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
