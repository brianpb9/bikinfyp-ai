// Port TypeScript dari scorer MODEL FYP (Viral Meter, analyzers/virality_model.py).
// HANYA scoring dari artifact beku — tidak pernah fit model on-the-fly (aturan keras §5
// MODEL_FYP_2.0.md). Matematika di file ini WAJIB byte-identik konstruksinya dengan
// build_features() + score_video_row() Python; diverifikasi golden test
// tests/fyp-score.test.ts terhadap output kode Python asli.
//
// r-model-2.0 (Brian 2026-08-11): naik dari ckpt9-n316 ke ckpt16-n565 (AUC OOF
// 0.719->0.801, nested-CV 0.797; n=316->565). cat_fields/num_fields cocok
// (skema lama tetap valid subset dari skema baru) KECUALI 3 kolom baru "Hook
// Trinity" (label_hook_visual/text/verbal) — lihat features.ts untuk mapping
// plannable-nya. cat_vocab lama semuanya tetap ada di vocab baru (cuma
// nambah kategori baru yang tidak pernah kita emit) — tidak ada breaking
// change untuk mapping yang sudah ada.
//
// Skor 0-100 = mid-rank percentile probabilitas mentah terhadap reference_distribution
// yang dibekukan di artifact. Skor hanya sebanding dalam satu model_version.
// Bahasa wajib saat menampilkan skor: KORELASIONAL ("video seperti ini cenderung
// menang di data kami"), bukan kepastian/prediksi FYP.

import artifactJson from "./ckpt16-n565.json";

export interface FypArtifact {
  model_version: string;
  created_at: string;
  weights: { intercept: number; coefs: number[] };
  standardize: { mean: number[]; std: number[] };
  feature_columns: string[];
  cat_vocab: Record<string, string[]>;
  cat_fields: string[];
  num_fields: string[];
  /** Probabilitas seluruh video latih, TERURUT naik (di-sort saat write_artifact). */
  reference_distribution: number[];
  meta: { auc: number; n: number; n_winners: number; best_l2: number; run_number: number };
}

/** Nilai fitur mentah per field (bukan kolom design-matrix):
 * - field kategorikal: string (kategori tak dikenal / null → semua-nol untuk field itu),
 * - field numerik: number, atau null = "tidak terukur" (→ kolom `_missing`=1, nilai 0). */
export type FeatureValues = Record<string, string | number | null>;

export interface FypScoreResult {
  /** 0-100, mid-rank percentile vs reference_distribution artifact. */
  score: number;
  rawProbability: number;
  modelVersion: string;
  /** [kolom, kontribusi = bobot × nilai terstandardisasi], terurut paling negatif dulu. */
  contributions: [string, number][];
  /** Baris design-matrix mentah per kolom (untuk snapshot beku / audit). */
  features: Record<string, number>;
}

export function loadFypArtifact(): FypArtifact {
  return artifactJson as unknown as FypArtifact;
}

/** Bangun baris design-matrix — urutan kolom identik dengan build_features() Python:
 * semua kolom kategorikal (per cat_fields, per vocab terurut artifact) lalu per field
 * numerik pasangan [`{f}_missing`, `{f}`]. */
export function buildRow(artifact: FypArtifact, values: FeatureValues): number[] {
  const row: number[] = [];
  for (const f of artifact.cat_fields) {
    const v = values[f];
    for (const cat of artifact.cat_vocab[f]) row.push(v === cat ? 1 : 0);
  }
  for (const f of artifact.num_fields) {
    const v = values[f];
    const missing = v === null || v === undefined;
    row.push(missing ? 1 : 0);
    row.push(missing ? 0 : Number(v));
  }
  return row;
}

/** round() Python 3 = banker's rounding (half-to-even) — Math.round JS membulatkan
 * half-up dan bisa selisih 1 poin tepat di batas .5. Samakan dengan Python. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Skor satu baris fitur terhadap artifact beku — padanan score_video_row() Python. */
export function scoreFeatures(values: FeatureValues, artifact: FypArtifact = loadFypArtifact()): FypScoreResult {
  const x = buildRow(artifact, values);
  const cols = artifact.feature_columns;
  if (x.length !== cols.length) {
    throw new Error(`feature schema mismatch vs artifact ${artifact.model_version}: ${x.length} != ${cols.length}`);
  }
  const { mean, std } = artifact.standardize;
  const coefs = artifact.weights.coefs;
  let z = artifact.weights.intercept;
  const xs: number[] = new Array(x.length);
  for (let i = 0; i < x.length; i++) {
    // std==0 sudah diganti 1.0 saat training (standardize_params) — tidak perlu guard lagi.
    xs[i] = (x[i] - mean[i]) / std[i];
    z += coefs[i] * xs[i];
  }
  const rawProbability = 1 / (1 + Math.exp(-z));

  const ref = artifact.reference_distribution;
  let below = 0;
  let equal = 0;
  for (const p of ref) {
    if (p < rawProbability) below++;
    else if (p === rawProbability) equal++;
  }
  const score = roundHalfEven((100 * (below + 0.5 * equal)) / ref.length);

  const contributions: [string, number][] = cols.map((c, i) => [c, coefs[i] * xs[i]]);
  contributions.sort((a, b) => a[1] - b[1]);

  const features: Record<string, number> = {};
  for (let i = 0; i < cols.length; i++) features[cols[i]] = x[i];

  return { score, rawProbability, modelVersion: artifact.model_version, contributions, features };
}
