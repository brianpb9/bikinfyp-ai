// Skor FYP pre-render (MODEL FYP 1.0, artifact ckpt9-n316) — API publik modul.
//
// BikinFYP menyusun videonya sendiri, jadi fitur model dibangun dari RENCANA
// (segmen skrip + caption timeline + shot plan + format) tanpa menganalisis
// video jadi. Skor dihitung SEBELUM render — dipakai layar S4.
//
// ATURAN BAHASA (MODEL_FYP_1.0.md §10, wajib ikut ke UI/copy):
// - Korelasional: "video seperti ini cenderung menang di data kami".
// - BUKAN "prediksi FYP" / jaminan viral; AUC 0.719 dilarang dikutip sebagai akurasi.
// - Skor hanya sebanding dalam satu model_version.

import type { ScriptPlanInput } from "./features";
import { buildPlanFeatures } from "./features";
import type { FypFix } from "./fixes";
import { topFixes } from "./fixes";
import type { FeatureValues } from "./model";
import { loadFypArtifact, scoreFeatures } from "./model";

export type { ScriptPlanInput, FypQualityTier, FypVideoFormat } from "./features";
export type { FypFix } from "./fixes";
export type { FeatureValues, FypScoreResult } from "./model";
export { buildPlanFeatures } from "./features";
export { loadFypArtifact, scoreFeatures } from "./model";
export { topFixes } from "./fixes";

/**
 * FORMAT YANG BOLEH DISKOR — jangkauan model, bukan daftar keinginan.
 *
 * TVC, iklan jasa, dan Iklan Sinematik SENGAJA dilewati, bukan dipetakan
 * paksa: model dilatih pada konten organik TikTok (vlog, skit, tutorial) dan
 * tidak punya padanan untuk iklan merek 30 detik. Memaksakan "other" akan
 * menghasilkan angka yang terlihat sah padahal tidak berarti.
 *
 * Tinggal di sini, bukan di salah satu jalur pembuat job: begitu daftarnya
 * disalin, jalur berikutnya akan menyalin versi yang sudah basi — dan yang
 * hilang bukan error, melainkan diam-diam prediksinya saja.
 */
export const FORMAT_BERSKOR: readonly string[] = ["hands_only", "vo_broll", "talking_head"];

/** Apakah format ini masuk jangkauan model FYP? */
export function bolehDiskorFyp(format: string): boolean {
  return FORMAT_BERSKOR.includes(format);
}

export interface ScriptPlanScore {
  score: number;
  rawProbability: number;
  modelVersion: string;
  topFixes: FypFix[];
  /** Nilai fitur mentah yang diskor — simpan sebagai snapshot beku untuk /ingest
   * (Step 4): predicted-vs-actual butuh fitur pre-posting yang tidak berubah. */
  featureValues: FeatureValues;
}

/** Skor satu rencana video (varian skrip + format + tier) terhadap artifact beku. */
export function scoreScriptPlan(input: ScriptPlanInput): ScriptPlanScore {
  const artifact = loadFypArtifact();
  const featureValues = buildPlanFeatures(input);
  const result = scoreFeatures(featureValues, artifact);
  return {
    score: result.score,
    rawProbability: result.rawProbability,
    modelVersion: result.modelVersion,
    topFixes: topFixes(result, artifact),
    featureValues,
  };
}
