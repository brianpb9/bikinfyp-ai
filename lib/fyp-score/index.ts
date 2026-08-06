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
