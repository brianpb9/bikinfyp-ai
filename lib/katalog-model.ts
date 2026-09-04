/**
 * KATALOG MODEL — daftar model yang BOLEH dipilih dari /admin.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA DAFTAR TERTUTUP, BUKAN KOLOM BEBAS
 * ────────────────────────────────────────────────────────────────────────────
 * Sebelum ini kolom model di /admin bebas diketik, dan itu membuka kembali
 * cacat yang repo ini SUDAH bayar sekali: penghitung biaya di byteplus.ts
 * memakai `MODEL_RATES[model] ?? {}`, jadi model yang tidak terdaftar jatuh ke
 * tarif cadangan $0,01/detik — sepersepuluh biaya sebenarnya. Komentar di sana
 * mencatat kejadiannya: Seedance 2.5 sempat tidak ada di daftar, dan tier
 * TERMAHAL kita adalah tier yang biayanya paling salah dihitung.
 *
 * Selama model hanya bisa diganti lewat rilis, cacat itu butuh seorang
 * programmer yang lupa. Sejak model bisa diganti dari layar admin, ia cukup
 * butuh satu salah ketik. Jadi pilihannya ditutup ke daftar ini, dan daftar
 * ini yang menjamin tarifnya dikenal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `tarif` DITULIS APA ADANYA
 * ────────────────────────────────────────────────────────────────────────────
 * "terukur" = diturunkan dari tagihan yang benar-benar kami bayar.
 * "brosur"  = angka publikasi penyedia, BELUM pernah dicocokkan dengan tagihan
 *             kami sendiri.
 *
 * Perbedaannya bukan akademis. Taksiran brosur untuk tier Rp12.000 pernah
 * meleset 2,8x — dijual Rp12.000 dengan biaya sebenarnya Rp23.533, rugi di
 * setiap video, dan tidak ada yang tahu selama berminggu-minggu. Layar admin
 * menampilkan label ini supaya keputusan komersial dibuat dengan mata terbuka.
 */

import type { Mesin } from "./kualitas-video";

export interface ModelKatalog {
  id: string;
  label: string;
  mesin: Mesin;
  /** Dari mana angka biayanya berasal. */
  tarif: "terukur" | "brosur";
  /** Satu kalimat: untuk apa model ini masuk akal. */
  catatan: string;
  /**
   * Durasi klip terpanjang yang diterima model, dalam detik.
   *
   * DIUKUR dengan menembak API-nya, bukan dibaca dari dokumentasi: 4 Sep 2026
   * keluarga Seedance 1.0 menerima 3-12 detik dan MENOLAK 13, 14, dan 15.
   * Video produksi kita 15 detik satu klip, jadi batas ini menentukan apakah
   * sebuah model bisa dipakai sama sekali — dan kalau tidak dijaga, job akan
   * gagal DI RENDER, sesudah naskah ditulis dan gambar disiapkan.
   */
  maksDetik: number;
}

/** Durasi video produksi kita. Model yang tidak sanggup segini tidak bisa dipetakan. */
export const DETIK_PRODUKSI = 15;

/**
 * CATATAN 4 Sep 2026 — kenapa dua model Seedance 1.0 ada di sini tapi tidak
 * dipetakan ke satu paket pun.
 *
 * Brian mengaktifkannya dan meminta dipetakan "mulai dari yang termurah".
 * Dua pengukuran menghentikannya:
 *
 *   1. DURASI. Keduanya menerima 3-12 detik dan MENOLAK 13, 14, 15. Video
 *      produksi kita 15 detik satu klip.
 *   2. BIAYA. Alasan satu-satunya untuk pindah adalah dugaan hemat 13% dari
 *      brosur. Diukur pada render 12 detik dengan prompt identik, pemakaian
 *      tokennya 0,954x Seedance 2.0 mini — praktis sama. Penghematan yang
 *      diklaim bergantung sepenuhnya pada asumsi bahwa keluarga 1.0 ditagih
 *      per DETIK dengan tarif jauh lebih murah, dan itu hanya bisa dibuktikan
 *      dari tagihan bulanan.
 *
 * Jadi memakainya menuntut memperpendek video atau membangun perakitan
 * multi-klip — menukar perubahan produk dengan penghematan 5% yang belum pasti.
 * Keduanya DIBIARKAN di katalog supaya keputusan ini bisa ditinjau ulang saat
 * tagihan terbit, tanpa harus mengulang penemuannya dari nol.
 */
export const KATALOG_MODEL: ModelKatalog[] = [
  {
    id: "grok-imagine/image-to-video",
    maksDetik: 15,  // batas keras Grok Imagine (MAKS_DETIK_PER_KLIP)
    label: "Grok Imagine (kie.ai)",
    mesin: "kie-grok",
    tarif: "terukur",
    catatan: "Rp6.750 per video 15 dtk 720p — diukur dari 9 render. Termurah, dan 8 dari 9 lolos QC.",
  },
  {
    id: "dreamina-seedance-2-0-mini-260615",
    maksDetik: 30,
    label: "Seedance 2.0 mini",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Rp23.355 per video 15 dtk 720p — dari usage token. Dipakai Premium sejak awal.",
  },
  {
    id: "dreamina-seedance-2-5-260628",
    maksDetik: 30,
    label: "Seedance 2.5",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Rp23.355 per video 15 dtk 720p — dari usage token. Dipakai Ultra sejak awal.",
  },
  {
    id: "dreamina-seedance-2-0-260128",
    maksDetik: 30,
    label: "Seedance 2.0",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Sama tarifnya dengan 2.0 mini — biaya ditentukan mode, bukan versi model.",
  },
  {
    // Diaktifkan Brian 4 Sep 2026, diverifikasi hidup (HTTP 200).
    id: "seedance-1-0-pro-fast-251015",
    maksDetik: 12,  // DIUKUR 4 Sep 2026: 3-12 diterima, 13/14/15 ditolak
    label: "Seedance 1.0 pro fast",
    mesin: "byteplus",
    tarif: "brosur",
    catatan: "DIUKUR 4 Sep 2026: maksimal 12 detik (13/14/15 ditolak), dan pemakaian tokennya 0,95x Seedance 2.0 mini — praktis sama. Dugaan hemat 13% dari brosur tidak terbukti.",
  },
  {
    // Diaktifkan Brian 4 Sep 2026, diverifikasi hidup (HTTP 200).
    id: "seedance-1-0-pro-250528",
    maksDetik: 12,  // DIUKUR 4 Sep 2026: 13/14/15 ditolak
    label: "Seedance 1.0 pro",
    mesin: "byteplus",
    tarif: "brosur",
    catatan: "DIUKUR 4 Sep 2026: maksimal 12 detik (13/14/15 ditolak). Tarif brosur $2,5/1M belum pernah dicocokkan dengan tagihan kami.",
  },
];

export function modelDikenal(id: string): ModelKatalog | undefined {
  return KATALOG_MODEL.find((m) => m.id === id);
}

export function modelUntukMesin(mesin: Mesin): ModelKatalog[] {
  return KATALOG_MODEL.filter((m) => m.mesin === mesin);
}
