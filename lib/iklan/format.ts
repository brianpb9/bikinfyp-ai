/**
 * Nama format dan batasnya — sengaja di modul sendiri yang tidak menarik
 * dependensi apa pun, supaya worker dan rute API bisa MENGENALI format ini
 * tanpa ikut memuat pipeline-nya (sharp, SDK Anthropic, ffmpeg).
 */

/** Nilai kolom jobs.format untuk Iklan Sinematik. */
export const FORMAT_IKLAN = "iklan_sinematik";

/** Durasi sasaran naskah (BATAS di lib/iklan/naskah.ts) — dipakai baris jobs. */
export const DURASI_IKLAN_DTK = 30;

/**
 * Beta ini gratis dan hanya untuk admin. Dipakai sebagai satu-satunya sumber
 * kebenaran oleh rute admin, worker (melewati capture kredit), dan test.
 */
export const IKLAN_TANPA_KREDIT = true;
