/**
 * Arsip prompt: apa yang BENAR-BENAR dikirim ke penyedia video.
 *
 * Sampai sekarang tidak ada satu pun tempat yang menyimpannya. Kalau sebuah
 * video keluar jelek, tidak ada cara membuktikan prompt apa yang
 * menghasilkannya — setiap diskusi mutu jatuh jadi soal ingatan. Dan tidak ada
 * perbaikan naskah yang bisa dibuktikan tanpa ini, karena pembandingnya tidak
 * pernah disimpan.
 *
 * DUA SIFAT YANG MENENTUKAN:
 *
 * 1. Ditulis SEBELUM panggilan penyedia. Job yang gagal justru yang paling
 *    sering perlu dibedah; arsip yang cuma ada untuk job sukses akan hilang
 *    tepat saat paling dibutuhkan.
 *
 * 2. Kegagalan menulis TIDAK PERNAH menggagalkan job. Ini catatan, bukan
 *    bagian produk — sama alasannya dengan snapshot Skor FYP dan telemetri.
 *    Pengguna yang sudah membayar tidak boleh kehilangan videonya karena
 *    pencatatan kita bermasalah.
 */
import type { VisualSpec } from "./providers/types";

export interface ArsipPrompt {
  jobId: string;
  spec: VisualSpec;
  /** Segmen naskah yang menghasilkan prompt ini — pasangan bacanya. */
  segments: unknown;
  ideId?: string | null;
  ideSkor?: number | null;
}

/**
 * Bentuk yang diarsipkan. Sengaja BUKAN VisualSpec mentah: yang berguna saat
 * membedah adalah prompt per shot beserta mode referensinya, bukan seluruh
 * struktur internal yang ikut berubah tiap refactor.
 */
export function ringkasSpec(spec: VisualSpec) {
  return {
    shots: spec.shots.map((s, i) => ({
      idx: i,
      durationSec: s.durationSec,
      prompt: s.prompt,
      imageRefPath: s.imageRefPath ?? null,
      // Mode referensi diturunkan dari aturan ModelArk yang sama dengan
      // provider: satu foto jadi FRAME PERTAMA (i2v); begitu ada foto tambahan,
      // SEMUANYA jadi reference_image (r2v) karena ModelArk melarang
      // mencampur keduanya. Dicatat karena mode ini mengubah arti promptnya.
      referenceMode:
        spec.referenceOnlyImages || (spec.extraReferenceImagePaths?.length ?? 0) > 0
          ? "reference_image (r2v)"
          : s.imageRefPath
            ? "first_frame (i2v)"
            : "text_to_video",
    })),
  };
}

export function ringkasParams(spec: VisualSpec) {
  return {
    ratio: spec.ratio ?? "9:16",
    width: spec.width,
    height: spec.height,
    qualityTier: spec.qualityTier,
    generateAudio: spec.generateAudio,
    maxPeople: spec.maxPeople ?? null,
    jumlahReferensiTambahan: spec.extraReferenceImagePaths?.length ?? 0,
    referenceOnlyImages: spec.referenceOnlyImages === true,
  };
}
