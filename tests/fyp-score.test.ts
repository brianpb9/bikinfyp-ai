// Unit test modul fyp-score (port MODEL FYP 1.0 ckpt9-n316):
// - GOLDEN: skor TS byte-setara dengan kode Python asli (analyzers/virality_model.py)
//   untuk 5 baris fitur — fixture tests/fixtures/fyp-score-golden.json digenerate
//   oleh kode Python asli via:
//     npx tsx scripts/fyp-golden-dump.ts > /tmp/fyp-features.json
//     python(+numpy, FYP_MODEL_REPO=<repo Viral Meter>) gen-golden.py ...
//   Bila builder fitur / template skrip berubah, regenerate fixture — test
//   "builder deterministik" di bawah yang akan mendeteksi drift-nya.
// - Perilaku top_fixes: whitelist, guard tanda koefisien, skip fitur missing, maks 3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DB_PATH = `/tmp/racun-test-fyp-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-fyp-storage-${process.pid}`;

const { scoreFeatures, loadFypArtifact, buildPlanFeatures, scoreScriptPlan, topFixes } = await import("../lib/fyp-score");
const { buildFixturePlans } = await import("./helpers/fyp-fixture-plans");

interface GoldenRow {
  name: string;
  features: Record<string, string | number | null>;
  expected: { raw_probability: number; score: number; model_version: string };
}

const golden: GoldenRow[] = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "fyp-score-golden.json"), "utf-8")
);

test("golden: skor TS identik dengan scorer Python asli (5 baris)", () => {
  assert.equal(golden.length, 5);
  for (const row of golden) {
    const r = scoreFeatures(row.features);
    assert.equal(r.modelVersion, row.expected.model_version, row.name);
    assert.ok(
      Math.abs(r.rawProbability - row.expected.raw_probability) < 1e-9,
      `${row.name}: raw_p ${r.rawProbability} != ${row.expected.raw_probability}`
    );
    assert.equal(r.score, row.expected.score, `${row.name}: skor beda`);
  }
});

test("builder deterministik: fitur fixture plans == fitur di golden (deteksi drift)", () => {
  const byName = new Map(golden.map((g) => [g.name, g.features]));
  const plans = buildFixturePlans();
  assert.ok(plans.length >= 4);
  for (const plan of plans) {
    const expected = byName.get(plan.name);
    assert.ok(expected, `fixture golden tidak punya baris ${plan.name} — regenerate fixture`);
    assert.deepEqual(
      buildPlanFeatures(plan.input),
      expected,
      `${plan.name}: fitur builder berubah sejak golden digenerate — regenerate fixture (lihat header)`
    );
  }
});

test("kategori tak dikenal -> semua-nol untuk field itu (vocab beku, tanpa kolom baru)", () => {
  const base = golden[0].features;
  const r = scoreFeatures({ ...base, label_hook_type: "kategori_baru_tak_dikenal" });
  const artifact = loadFypArtifact();
  for (const cat of artifact.cat_vocab.label_hook_type) {
    assert.equal(r.features[`label_hook_type=${cat}`], 0);
  }
});

test("numerik null -> kolom _missing=1 nilai 0; angka -> _missing=0", () => {
  const r = scoreFeatures({ ...golden[0].features, pacing_score: null, duration_sec: 15 });
  assert.equal(r.features.pacing_score_missing, 1);
  assert.equal(r.features.pacing_score, 0);
  assert.equal(r.features.duration_sec_missing, 0);
  assert.equal(r.features.duration_sec, 15);
});

test("scoreScriptPlan end-to-end: skor 0-100, fixes <= 3, snapshot fitur ikut", () => {
  for (const plan of buildFixturePlans()) {
    const s = scoreScriptPlan(plan.input);
    assert.ok(s.score >= 0 && s.score <= 100, `${plan.name}: skor ${s.score}`);
    assert.equal(s.modelVersion, "ckpt9-n316");
    assert.ok(s.topFixes.length <= 3);
    for (const f of s.topFixes) {
      assert.ok(f.contribution < 0, "fix hanya dari kontribusi negatif");
      assert.ok(!f.feature.endsWith("_missing"), "kolom _missing tidak pernah jadi saran");
    }
    assert.equal(typeof s.featureValues.duration_sec, "number");
  }
});

test("top_fixes: setiap saran yang keluar searah dengan koefisien artifact (guard whitelist)", () => {
  const artifact = loadFypArtifact();
  const weights = new Map(artifact.feature_columns.map((c, i) => [c, artifact.weights.coefs[i]]));
  // Arah yang diasumsikan tiap template (identik dengan whitelist di fixes.ts).
  const expectedSign: Record<string, number> = {
    "dominant_shot_type=wide": -1, "setting=outdoor": -1, "setting=home": -1,
    product_first_appears_sec: -1, avg_shot_duration: 1, total_cuts: -1,
    cuts_per_sec: -1, cuts_in_first_3s: -1, hook_text_transitions: -1,
    full_text_transitions: -1, face_in_first_3s: 1, transcript_has_question: 1,
    ocr_has_cta_word: 1, "label_hook_type=question": 1,
  };
  for (const row of golden) {
    const r = scoreFeatures(row.features, artifact);
    for (const f of topFixes(r, artifact)) {
      const w = weights.get(f.feature) ?? 0;
      assert.ok(expectedSign[f.feature] * w > 0, `${row.name}: ${f.feature} keluar padahal koefisien berlawanan arah template`);
    }
  }
});

test("top_fixes: retrain membalik koefisien -> fix di-drop diam-diam (artifact sintetis)", () => {
  // Artifact minimal 1 fitur numerik whitelist (transcript_has_question, template +1).
  const mk = (coef: number) => ({
    model_version: "test-synthetic", created_at: "", cat_fields: [], num_fields: ["transcript_has_question"],
    cat_vocab: {}, feature_columns: ["transcript_has_question_missing", "transcript_has_question"],
    weights: { intercept: 0, coefs: [0, coef] },
    standardize: { mean: [0, 0.5], std: [1, 0.5] },
    reference_distribution: [0.3, 0.5, 0.7],
    meta: { auc: 0, n: 3, n_winners: 1, best_l2: 0, run_number: 0 },
  });
  // Koefisien masih searah template (+): video tanpa pertanyaan -> saran keluar.
  const ok = scoreFeatures({ transcript_has_question: 0 }, mk(0.2));
  assert.equal(topFixes(ok, mk(0.2)).length, 1);
  // Retrain membalik koefisien jadi negatif: video DENGAN pertanyaan berkontribusi
  // negatif -> tanpa guard, template lama akan menyarankan "tambah pertanyaan"
  // (arah salah). Guard wajib men-drop-nya tanpa error.
  const flipped = scoreFeatures({ transcript_has_question: 1 }, mk(-0.2));
  const [, contrib] = flipped.contributions[0];
  assert.ok(contrib < 0, "premis: kontribusi kolom whitelist negatif");
  assert.equal(topFixes(flipped, mk(-0.2)).length, 0, "koefisien terbalik harus di-drop, bukan menasihati arah salah");
});

test("top_fixes: fitur missing pada video tidak pernah dinasihati", () => {
  // pacing_score & setting null di semua plan builder; whitelist punya setting=home/outdoor.
  const r = scoreFeatures(buildPlanFeatures(buildFixturePlans()[0].input));
  for (const f of topFixes(r)) {
    const base = f.feature.split("=")[0];
    assert.notEqual(r.features[`${base}_missing`], 1, `${f.feature} missing tapi dinasihati`);
  }
});
