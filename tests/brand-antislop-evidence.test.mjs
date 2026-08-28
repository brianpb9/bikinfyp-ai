import test from "node:test";
import assert from "node:assert/strict";
import { verifyBrandAntiSlopEvidence } from "../lib/brand-antislop-evidence.mjs";

const REF = "a".repeat(64);
const FRAME = "b".repeat(64);
const ARTIFACT = "c".repeat(64);

function packet() {
  return {
    task: "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828",
    scope: "ZERO_SPEND_NO_SCORE_PREREQUISITE",
    approved_reference: { storage_key: "admission/job-1/product.webp", sha256: REF, approved_at: "2026-08-28T05:00:00Z" },
    artifact: { storage_key: "outputs/job-1.mp4", sha256: ARTIFACT, completed_at: "2026-08-28T05:10:00Z" },
    samples: [{
      shot_index: 0, frame_sha256: FRAME, evaluated_at: "2026-08-28T05:11:00Z",
      qc_f1: {
        status: "PASS",
        evidence: { frameSha256: FRAME, productPhotoSha256: REF },
        temuan: { bentukSama: true, tutupSama: true, warnaSama: true, tataLetakLabelSama: true, merekTerbaca: true },
      },
    }],
    final_qc: [{ code: "QC-03", status: "pass" }, { code: "QC-10", status: "pass" }],
    anti_slop: { generated_text_candidates: [], misspelled_brand_candidates: [], packshot_sha256: REF },
  };
}

test("binds approved reference, output sample, shape/label findings, final QC, and packshot", () => {
  const result = verifyBrandAntiSlopEvidence(packet());
  assert.equal(result.status, "PASS");
  assert.equal(result.claim, "NO_SCORE");
  assert.match(result.evidence_sha256, /^[0-9a-f]{64}$/);
});

test("fails closed for missing, stale, ambiguous, or mismatched evidence", () => {
  const cases = [
    ["no samples", (p) => { p.samples = []; }, /OUTPUT_SAMPLES_MISSING/],
    ["stale sample", (p) => { p.samples[0].evaluated_at = "2026-08-28T05:09:00Z"; }, /OUTPUT_SAMPLE_PREDATES_ARTIFACT/],
    ["frame mismatch", (p) => { p.samples[0].qc_f1.evidence.frameSha256 = "d".repeat(64); }, /QC_F1_FRAME_BINDING_MISMATCH/],
    ["reference mismatch", (p) => { p.samples[0].qc_f1.evidence.productPhotoSha256 = "d".repeat(64); }, /QC_F1_REFERENCE_BINDING_MISMATCH/],
    ["ambiguous QC", (p) => { p.final_qc.push({ code: "QC-10", status: "pass" }); }, /QC_10_AMBIGUOUS_OR_MISSING/],
    ["packshot mismatch", (p) => { p.anti_slop.packshot_sha256 = "d".repeat(64); }, /PACKSHOT_REFERENCE_MISMATCH/],
  ];
  for (const [name, mutate, expected] of cases) {
    const input = packet(); mutate(input);
    assert.throws(() => verifyBrandAntiSlopEvidence(input), expected, name);
  }
});

test("rejects every product-identity and generated-text slop signal", () => {
  for (const field of ["bentukSama", "tutupSama", "warnaSama", "tataLetakLabelSama", "merekTerbaca"]) {
    const input = packet(); input.samples[0].qc_f1.temuan[field] = false;
    assert.throws(() => verifyBrandAntiSlopEvidence(input), /NOT_PROVEN/, field);
  }
  const generated = packet(); generated.anti_slop.generated_text_candidates = ["FAKE SALE 90%"];
  assert.throws(() => verifyBrandAntiSlopEvidence(generated), /GENERATED_TEXT_SLOP_DETECTED/);
  const misspelled = packet(); misspelled.anti_slop.misspelled_brand_candidates = ["moseru"];
  assert.throws(() => verifyBrandAntiSlopEvidence(misspelled), /MISSPELLED_BRAND_SLOP_DETECTED/);
  for (const code of ["QC-03", "QC-10"]) {
    const input = packet(); input.final_qc.find((row) => row.code === code).status = "fail";
    assert.throws(() => verifyBrandAntiSlopEvidence(input), /NOT_PASS/, code);
  }
});
