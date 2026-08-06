// Top-3-fixes — port dari analyzers/score_service.py (ACTIONABLE_FIXES + top_fixes).
// BUKAN LLM: saran diturunkan dari kontribusi koefisien paling negatif melalui
// whitelist statis. Tiap template menyimpan tanda bobot yang diasumsikan; bila
// retrain membalik tanda koefisien di artifact, fix di-drop diam-diam (tidak
// pernah memberi saran arah terbalik). Kolom `_missing` tidak pernah muncul.
// Bahasa template: korelasional, konsisten dengan aturan §10 MODEL_FYP_1.0.md.

import type { FypArtifact, FypScoreResult } from "./model";
import { loadFypArtifact } from "./model";

export interface FypFix {
  feature: string;
  contribution: number;
  fix: string;
}

/** kolom → [tanda bobot yang diasumsikan template, teks saran]. Identik dengan
 * whitelist Python; jangan tambah kolom tanpa cek arah koefisien di artifact. */
const ACTIONABLE_FIXES: Record<string, [1 | -1, string]> = {
  "dominant_shot_type=wide": [-1, "Framing dominan wide shot — video seperti ini cenderung kalah di data kami; pertimbangkan close-up/medium sebagai framing utama."],
  "setting=outdoor": [-1, "Setting outdoor cenderung lebih lemah daripada set studio/terkontrol di data kami — pertimbangkan background yang lebih disiapkan."],
  "setting=home": [-1, "Setting rumah/seadanya cenderung lebih lemah daripada set terkontrol di data kami — rapikan background dan pencahayaan."],
  product_first_appears_sec: [-1, "Produk muncul terlambat — makin cepat produk terlihat (idealnya di hook), makin baik menurut data kami."],
  avg_shot_duration: [1, "Durasi shot rata-rata pendek — shot yang lebih panjang cenderung menang di data kami; kurangi rapid-cut."],
  total_cuts: [-1, "Jumlah cut tinggi — video dengan cut lebih sedikit cenderung menang di data kami."],
  cuts_per_sec: [-1, "Tempo cut terlalu rapat — pacing yang lebih tenang cenderung menang di data kami."],
  cuts_in_first_3s: [-1, "Terlalu banyak cut di 3 detik pertama — hook yang stabil cenderung lebih baik di data kami."],
  hook_text_transitions: [-1, "Transisi teks di hook ramai — teks statis dan fungsional cenderung lebih baik di data kami."],
  full_text_transitions: [-1, "Transisi teks sepanjang video ramai — kurangi animasi teks berganti-ganti."],
  face_in_first_3s: [1, "Tidak ada wajah di 3 detik pertama — kehadiran wajah manusia di awal berkorelasi positif di data kami; coba format Wajah AI."],
  transcript_has_question: [1, "Tidak ada pertanyaan di narasi — hook berbentuk pertanyaan berkorelasi positif di data kami; coba varian hook pertanyaan."],
  ocr_has_cta_word: [1, "Tidak ada CTA tertulis di layar — kata ajakan yang terbaca berkorelasi positif di data kami."],
  "label_hook_type=question": [1, "Hook non-pertanyaan pada video ini dinilai negatif oleh model — hook bertipe pertanyaan cenderung menang di data kami; coba varian hook pertanyaan."],
};

const MAX_FIXES = 3;

/** Padanan top_fixes() Python: ambil kontribusi paling negatif yang masuk whitelist,
 * dengan guard tanda koefisien + skip fitur yang missing pada video ini. */
export function topFixes(result: FypScoreResult, artifact: FypArtifact = loadFypArtifact()): FypFix[] {
  const weights: Record<string, number> = {};
  artifact.feature_columns.forEach((c, i) => {
    weights[c] = artifact.weights.coefs[i];
  });
  const fixes: FypFix[] = [];
  for (const [col, contrib] of result.contributions) {
    if (contrib >= 0) break; // sudah terurut naik — sisanya non-negatif semua
    const entry = ACTIONABLE_FIXES[col];
    if (!entry) continue;
    const [expectedSign, template] = entry;
    if (expectedSign * (weights[col] ?? 0) <= 0) continue; // koefisien terbalik sejak template ditulis
    const base = col.split("=")[0];
    if (result.features[`${base}_missing`] === 1) continue; // fitur tak terukur — jangan menasihati
    fixes.push({ feature: col, contribution: Math.round(contrib * 10000) / 10000, fix: template });
    if (fixes.length === MAX_FIXES) break;
  }
  return fixes; // boleh < 3; tidak pernah dipad (spec 1.4)
}
