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
}

export const KATALOG_MODEL: ModelKatalog[] = [
  {
    id: "grok-imagine/image-to-video",
    label: "Grok Imagine (kie.ai)",
    mesin: "kie-grok",
    tarif: "terukur",
    catatan: "Rp6.750 per video 15 dtk 720p — diukur dari 9 render. Termurah, dan 8 dari 9 lolos QC.",
  },
  {
    id: "dreamina-seedance-2-0-mini-260615",
    label: "Seedance 2.0 mini",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Rp23.355 per video 15 dtk 720p — dari usage token. Dipakai Premium sejak awal.",
  },
  {
    id: "dreamina-seedance-2-5-260628",
    label: "Seedance 2.5",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Rp23.355 per video 15 dtk 720p — dari usage token. Dipakai Ultra sejak awal.",
  },
  {
    id: "dreamina-seedance-2-0-260128",
    label: "Seedance 2.0",
    mesin: "byteplus",
    tarif: "terukur",
    catatan: "Sama tarifnya dengan 2.0 mini — biaya ditentukan mode, bukan versi model.",
  },
  {
    // Diaktifkan Brian 4 Sep 2026, diverifikasi hidup (HTTP 200).
    id: "seedance-1-0-pro-fast-251015",
    label: "Seedance 1.0 pro fast",
    mesin: "byteplus",
    tarif: "brosur",
    catatan: "Ditagih per detik. Taksiran brosur Rp5.868 per 15 dtk 720p — BELUM diukur di akun kita.",
  },
  {
    // Diaktifkan Brian 4 Sep 2026, diverifikasi hidup (HTTP 200).
    id: "seedance-1-0-pro-250528",
    label: "Seedance 1.0 pro",
    mesin: "byteplus",
    tarif: "brosur",
    catatan: "Ditagih per token, tarif brosur $2,5/1M. Tagihan kami sendiri untuk keluarga 2.x adalah $4,41/1M — angka ini belum dicocokkan.",
  },
];

export function modelDikenal(id: string): ModelKatalog | undefined {
  return KATALOG_MODEL.find((m) => m.id === id);
}

export function modelUntukMesin(mesin: Mesin): ModelKatalog[] {
  return KATALOG_MODEL.filter((m) => m.mesin === mesin);
}
