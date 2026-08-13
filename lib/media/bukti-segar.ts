// KESEGARAN BUKTI — apakah sebuah render masih membuktikan kode hari ini?
//
// Versi pertama memakai waktu commit shot-planner.ts: bukti yang lebih tua
// dianggap kedaluwarsa. Arahnya benar tapi terlalu kasar, dan bahayanya mahal:
// SATU perubahan kata di format hands_only membatalkan bukti SELURUH 25
// template lain yang tidak tersentuh sama sekali — ±Rp280.000 render ulang
// tanpa alasan. Aturan kesegaran yang menghukum perbaikan akan membuat orang
// berhenti memperbaiki.
//
// Yang menentukan apakah sebuah bukti masih berlaku bukan JAM-nya, tapi apakah
// PERINTAH YANG DIKIRIM KE MODEL masih sama. Jadi yang disimpan sidik jari
// prompt-nya. Template yang promptnya tidak berubah tetap terbukti walau
// perender berubah untuk format lain.

import crypto from "node:crypto";

/** Sidik jari dari perintah yang benar-benar dikirim ke model.
 *
 *  Negative prompt ikut: ia sama-sama mengubah hasil. Yang TIDAK ikut adalah
 *  jalur berkas dan jobId — dua render dengan isi perintah identik memang
 *  membuktikan hal yang sama. */
export function sidikPrompt(spec: {
  shots: { prompt: string }[];
  negativePrompt: string;
}): string {
  const isi = [...spec.shots.map((s) => s.prompt), spec.negativePrompt].join(" ");
  return crypto.createHash("sha1").update(isi).digest("hex").slice(0, 16);
}
