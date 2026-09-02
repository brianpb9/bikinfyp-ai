/**
 * SATU susunan teks prompt untuk SEMUA mesin video.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI TIDAK BOLEH DITULIS DUA KALI
 * ────────────────────────────────────────────────────────────────────────────
 * Permintaan Brian, 2 Sep 2026: yang membedakan Standard, Premium, dan Ultra
 * HANYA modelnya. Promptnya wajib sama persis, karena kualitas naskah dan
 * prompt itulah yang sudah disetel ke standarnya — bukan sesuatu yang boleh
 * berubah diam-diam karena mesinnya berbeda.
 *
 * Sebelum ini teksnya disusun di dalam masing-masing provider. Dua salinan
 * dari kalimat yang harus identik akan hanyut — dan hanyutnya tidak terlihat
 * sebagai galat, melainkan sebagai video yang "entah kenapa" beda rasa.
 *
 * Sekarang keduanya memanggil fungsi ini. Ada tes yang membandingkan keluaran
 * kedua provider byte-per-byte; kalau ada yang menyusun teksnya sendiri lagi,
 * tesnya merah.
 *
 * Bentuk yang dipertahankan persis seperti yang sudah berjalan di produksi:
 *
 *     "<prompt shot>. Negative: <negative prompt>"
 *
 * Termasuk titik dan spasinya. Ini bukan detail kosmetik: teks itu yang masuk
 * ke model, dan mengubah pemisahnya berarti mengubah masukan yang selama ini
 * menghasilkan keluaran yang diterima.
 */

import type { ShotSpec, VisualSpec } from "./types";

export function teksPromptShot(spec: VisualSpec, shot: ShotSpec): string {
  // Negative instruction WAJIB ikut (aturan keras #3, divalidasi registry
  // lewat assertVisualSpec sebelum provider mana pun dipanggil).
  return `${shot.prompt}. Negative: ${spec.negativePrompt}`;
}
