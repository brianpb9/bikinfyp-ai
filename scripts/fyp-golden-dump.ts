// Dump nilai fitur fixture plans fyp-score sebagai JSON (stdout) — input untuk
// regenerasi golden test terhadap kode Python asli MODEL FYP.
//
// Regenerasi tests/fixtures/fyp-score-golden.json (butuh repo Viral Meter + numpy):
//   npx tsx scripts/fyp-golden-dump.ts > /tmp/fyp-features.json
//   <python-dengan-numpy> <driver> /tmp/fyp-features.json  # driver: lihat header tests/fyp-score.test.ts
import { buildFixturePlans } from "../tests/helpers/fyp-fixture-plans";
import { buildPlanFeatures, type FeatureValues } from "../lib/fyp-score";

const rows: { name: string; features: FeatureValues }[] = buildFixturePlans().map((p) => ({
  name: p.name,
  features: buildPlanFeatures(p.input),
}));

// Kasus sintetis: kategori tak dikenal (→ semua-nol) + campuran numerik null —
// menguji jalur missing/vocab yang tidak dihasilkan builder.
rows.push({
  name: "synthetic-unknown-cats-and-nulls",
  features: {
    label_hook_type: "kategori_tak_dikenal",
    label_format: null,
    label_narrative: "delayed_payoff",
    label_local_element: "none",
    text_language_style: "formal",
    setting: "studio",
    dominant_shot_type: "wide",
    why_shared: "relate",
    duration_sec: 42,
    total_cuts: 12,
    cuts_per_sec: 12 / 42,
    avg_shot_duration: 3.23,
    cuts_in_first_3s: 2,
    pacing_score: 0.7,
    has_text_overlay: 0,
    text_appears_at_sec: null,
    hook_text_coverage_pct: null,
    full_text_coverage_pct: 0.4,
    hook_text_transitions: null,
    full_text_transitions: 5,
    face_in_first_3s: 1,
    face_count_avg: 2,
    product_visible: 0,
    product_first_appears_sec: 7.5,
    has_cta_in_audio: 1,
    cta_timing_sec: 35,
    has_trending_sound: 1,
    label_hook_layered: 0,
    label_hook_visual: 1,
    label_hook_text: 0,
    label_hook_verbal: null,
    transcript_word_count: 55,
    transcript_has_question: 0,
    transcript_has_price_mention: 1,
    ocr_word_count: null,
    ocr_has_price_mention: null,
    ocr_has_cta_word: null,
  },
});

console.log(JSON.stringify(rows, null, 1));
