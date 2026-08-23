// Foto referensi "aman-orang" untuk model video r2v (BytePlus menolak
// referensi yang mengandung orang sungguhan — proteksi deepfake; insiden lab
// 2026-08-07: semua foto e-commerce fashion memakai model → render selalu
// gagal). Foto berwajah di-crop otomatis ke kain/produk (person_safe_crop.py,
// YuNet); terbukti lolos moderasi & menghasilkan try-on full-body yang akurat.

import fs from "node:fs";
import path from "node:path";
import { runFf } from "./ffmpeg";

interface CropResult {
  file: string;
  safe: string | null;
  cropped: boolean;
  resized?: boolean;
  reason?: string;
}

export interface PersonSafeRefs {
  /** Foto siap-kirim (asli bila bersih, hasil crop bila berwajah). Urutan input dipertahankan. */
  safe: string[];
  cropped: number;
  dropped: number;
  /** Foto (baru atau hasil crop) yang terlalu kecil (<320px) dinaikkan otomatis
   * — jaring pengaman utk foto lama yang tersimpan sebelum fix normalisasi ukuran. */
  resized: number;
}

type PersonSafeOverride = (photoPaths: string[], workDir: string) => Promise<PersonSafeRefs>;
let personSafeOverride: PersonSafeOverride | undefined;

/** Test seam untuk membuktikan boundary worker tanpa bergantung Python/OpenCV.
 * Tidak pernah dipasang oleh runtime produksi. */
export function setPersonSafeReferencePhotosForTests(override?: PersonSafeOverride): void {
  personSafeOverride = override;
}

function pythonBin(): string {
  const venv = path.join(process.cwd(), ".venv", "bin", "python");
  return fs.existsSync(venv) ? venv : "python3";
}

/**
 * Saring/crop foto produk agar bebas orang sebelum jadi referensi r2v.
 * Melempar Error berpesan-user bila TIDAK ADA satu pun foto yang bisa dipakai
 * (job harus gagal jelas + refund, bukan ditolak provider tanpa penjelasan).
 */
export async function personSafeReferencePhotos(photoPaths: string[], workDir: string): Promise<PersonSafeRefs> {
  if (personSafeOverride) return personSafeOverride(photoPaths, workDir);
  if (photoPaths.length === 0) return { safe: [], cropped: 0, dropped: 0, resized: 0 };
  const model = path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx");
  const outDir = path.join(workDir, "safe-refs");
  const { stdout } = await runFf(pythonBin(), [
    path.join(process.cwd(), "lib", "media", "person_safe_crop.py"),
    model, outDir, ...photoPaths,
  ]);
  const results = JSON.parse(stdout) as CropResult[];
  const safe = results.filter((r) => r.safe).map((r) => r.safe as string);
  const cropped = results.filter((r) => r.cropped).length;
  const dropped = results.filter((r) => !r.safe).length;
  const resized = results.filter((r) => r.resized).length;
  if (safe.length === 0) {
    throw new Error(
      "Semua foto produk mengandung orang/model sehingga tidak bisa dipakai referensi AI (aturan penyedia model). " +
      "Tambahkan minimal 1 foto produk saja — tanpa orang — ya."
    );
  }
  return { safe, cropped, dropped, resized };
}
