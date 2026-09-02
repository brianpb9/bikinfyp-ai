/**
 * TIGA KUALITAS VIDEO, TIGA MESIN — satu tempat yang memutuskan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA REGISTRI TERPISAH, BUKAN MENGGANTI NAMA TIER LAMA
 * ────────────────────────────────────────────────────────────────────────────
 * Nama tier lama (`silent_caption`, `high_quality`, `super_hq`) muncul 222 kali
 * di kode DAN tersimpan di 31 baris `jobs` yang sudah ada. Menggantinya berarti
 * menyentuh jalur uang di puluhan tempat sekaligus membuat riwayat job lama
 * menunjuk nilai yang tidak lagi dikenal.
 *
 * Jadi tiga kualitas baru DITAMBAHKAN sebagai nilai yang setara, bukan
 * pengganti. Yang lama tetap sah dan tetap merender seperti biasa.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROVIDER SEKARANG DIPILIH PER-KUALITAS, BUKAN GLOBAL
 * ────────────────────────────────────────────────────────────────────────────
 * Sebelum ini `config.providerVideo` memilih SATU provider untuk seluruh
 * sistem, dan model dipilih per-tier di dalam provider itu. Susunan tiga
 * kualitas ini menuntut dua mesin berbeda hidup bersamaan — Grok lewat kie.ai
 * untuk standard, BytePlus untuk premium dan ultra — jadi pemilihannya pindah
 * ke sini.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TEMUAN YANG HARUS DIBACA SEBELUM MENETAPKAN HARGA
 * ────────────────────────────────────────────────────────────────────────────
 * Diukur dari 704 task nyata di akun kami: konsumsi token BytePlus TIDAK
 * bergantung versi model. Ia fungsi resolusi x durasi x MODE. Pada 720p, 15
 * detik menghabiskan 324.900 token tanpa referensi dan 648.900 dengan
 * referensi — SAMA untuk 2.0-mini maupun 2.5.
 *
 * Artinya premium dan ultra berbiaya SAMA pada durasi dan mode yang sama.
 * Selisih keduanya adalah kualitas keluaran, bukan biaya. Menetapkan harga
 * ultra jauh di atas premium berarti menjual selisih yang tidak kita bayar —
 * boleh saja, tapi itu keputusan harga yang harus diambil sadar, bukan
 * kesimpulan dari "modelnya lebih mahal".
 */

import type { QualityTier } from "./providers/types";

export type Kualitas = "standard" | "premium" | "ultra";

export type Mesin = "kie-grok" | "byteplus";

export interface ProfilKualitas {
  id: Kualitas;
  label: string;
  /** Kalimat untuk pembeli — apa yang benar-benar ia dapat. */
  jelas: string;
  mesin: Mesin;
  /** Id model di sisi penyedia. */
  model: string;
  resolusi: string;
  audio: boolean;
}

export const KUALITAS: Record<Kualitas, ProfilKualitas> = {
  standard: {
    id: "standard",
    label: "Standard",
    jelas: "Cepat dan hemat — cocok untuk uji ide dan konten harian.",
    mesin: "kie-grok",
    model: "grok-imagine/image-to-video",
    // 720p, sama dengan Premium dan Ultra: yang membedakan ketiganya MODEL,
    // bukan resolusi (keputusan Brian 2 Sep 2026).
    resolusi: "720p",
    // Grok Imagine SELALU menghasilkan audio dan tidak punya tombol untuk
    // mematikannya. Menyatakannya di sini mencegah kualitas ini dipasangkan
    // ke jalur bisu, yang akan menjanjikan sesuatu yang tidak bisa ditepati.
    audio: true,
  },
  premium: {
    id: "premium",
    label: "Premium",
    jelas: "Seedance 2 mini — gambar lebih rapi, wajah lebih stabil.",
    mesin: "byteplus",
    model: "dreamina-seedance-2-0-mini-260615",
    resolusi: "720p",
    audio: true,
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    jelas: "Seedance 2.5 — kualitas tertinggi yang kami punya.",
    mesin: "byteplus",
    model: "dreamina-seedance-2-5-260628",
    resolusi: "720p",
    audio: true,
  },
};

export const URUTAN_KUALITAS: Kualitas[] = ["standard", "premium", "ultra"];

export function kualitasDikenal(v: string): v is Kualitas {
  return v === "standard" || v === "premium" || v === "ultra";
}

/**
 * Mesin yang harus merender sebuah tier.
 *
 * Tier LAMA tetap dijawab BytePlus, persis seperti sebelumnya — kalau tidak,
 * job yang sudah antre dengan nilai lama akan tiba-tiba dialihkan ke mesin
 * yang tidak pernah dipilih siapa pun untuknya.
 */
export function mesinUntuk(tier: QualityTier | Kualitas): Mesin {
  return kualitasDikenal(tier) ? KUALITAS[tier].mesin : "byteplus";
}

/** Model yang dipakai untuk sebuah kualitas baru; null untuk tier lama. */
export function modelUntuk(tier: QualityTier | Kualitas): string | null {
  return kualitasDikenal(tier) ? KUALITAS[tier].model : null;
}

/**
 * Padanan tier LAMA di susunan baru.
 *
 * Dipakai saat sesuatu yang ditulis dengan nama lama — preset template,
 * pilihan tersimpan di alur, riwayat — harus disandingkan dengan pilihan yang
 * sekarang ditawarkan di layar. Bukan migrasi data: yang tersimpan tetap
 * bernilai lama, dan tetap sah.
 *
 * super_hq -> ultra dan high_quality -> premium karena harganya identik dan
 * mesinnya sama; yang berubah cuma versi model, ke arah yang lebih baik.
 * silent_caption sudah pensiun, jadi padanannya diarahkan ke premium — tier
 * bersuara termurah yang masih dijual.
 */
export function setaraBaru(tier: QualityTier | Kualitas): Kualitas {
  if (kualitasDikenal(tier)) return tier;
  if (tier === "super_hq") return "ultra";
  return "premium";
}
