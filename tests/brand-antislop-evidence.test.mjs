import test from "node:test";
import assert from "node:assert/strict";
import { verifyBrandAntiSlopEvidence } from "../lib/brand-antislop-evidence.mjs";

const REF = "a".repeat(64);
const FRAME = "b".repeat(64);
const ARTIFACT = "c".repeat(64);
const EXTRACTION = "d".repeat(64);

function packet() {
  return {
    task: "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828",
    job_id: "job-1",
    scope: "ZERO_SPEND_NO_SCORE_PREREQUISITE",
    approved_reference: { storage_key: "admission/job-1/product.webp", sha256: REF, approved_at: "2026-08-28T05:00:00Z" },
    artifact: { job_id: "job-1", storage_key: "outputs/job-1.mp4", sha256: ARTIFACT, completed_at: "2026-08-28T05:10:00Z" },
    extraction_manifest: { job_id: "job-1", artifact_sha256: ARTIFACT, artifact_storage_key: "outputs/job-1.mp4",
      storage_key: "evidence/job-1/extraction.json",
      sha256: EXTRACTION, extractor: "ffmpeg@exact-sha", created_at: "2026-08-28T05:10:30Z" },
    samples: [{
      job_id: "job-1", artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION,
      shot_index: 0, frame_sha256: FRAME, evaluated_at: "2026-08-28T05:11:00Z",
      qc_f1: {
        status: "PASS",
        evidence: { frameSha256: FRAME, productPhotoSha256: REF },
        temuan: { bentukSama: true, tutupSama: true, warnaSama: true, tataLetakLabelSama: true, merekTerbaca: true },
      },
    }],
    final_qc: ["QC-03", "QC-10"].map((code) => ({ code, status: "pass", job_id: "job-1",
      artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION })),
    anti_slop: { job_id: "job-1", artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION,
      generated_text_candidates: [], misspelled_brand_candidates: [], packshot_sha256: REF },
  };
}

test("binds approved reference, output sample, shape/label findings, final QC, and packshot", () => {
  const result = verifyBrandAntiSlopEvidence(packet());
  assert.equal(result.status, "PASS");
  assert.equal(result.task, "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828");
  assert.equal(result.claim, "NO_SCORE");
  assert.match(result.evidence_sha256, /^[0-9a-f]{64}$/);
});

test("fails closed for missing, stale, ambiguous, or mismatched evidence", () => {
  const cases = [
    ["no samples", (p) => { p.samples = []; }, /OUTPUT_SAMPLES_MISSING/],
    ["stale sample", (p) => { p.samples[0].evaluated_at = "2026-08-28T05:10:15Z"; }, /OUTPUT_SAMPLE_PREDATES_EXTRACTION/],
    ["frame mismatch", (p) => { p.samples[0].qc_f1.evidence.frameSha256 = "d".repeat(64); }, /QC_F1_FRAME_BINDING_MISMATCH/],
    ["reference mismatch", (p) => { p.samples[0].qc_f1.evidence.productPhotoSha256 = "d".repeat(64); }, /QC_F1_REFERENCE_BINDING_MISMATCH/],
    ["ambiguous QC", (p) => { p.final_qc.push({ code: "QC-10", status: "pass" }); }, /QC_10_AMBIGUOUS_OR_MISSING/],
    ["packshot mismatch", (p) => { p.anti_slop.packshot_sha256 = "d".repeat(64); }, /PACKSHOT_REFERENCE_MISMATCH/],
    ["wrong task", (p) => { p.task = "WRONG-TASK"; }, /TASK_MISMATCH/],
    ["missing artifact key", (p) => { delete p.artifact.storage_key; }, /ARTIFACT_STORAGE_KEY_MISSING/],
    ["extraction artifact mismatch", (p) => { p.extraction_manifest.artifact_sha256 = "e".repeat(64); }, /EXTRACTION_ARTIFACT_MISMATCH/],
    ["extraction artifact key mismatch", (p) => { p.extraction_manifest.artifact_storage_key = "outputs/other.mp4"; }, /EXTRACTION_ARTIFACT_KEY_MISMATCH/],
    ["sample artifact mismatch", (p) => { p.samples[0].artifact_sha256 = "e".repeat(64); }, /OUTPUT_SAMPLE_ARTIFACT_MISMATCH/],
    ["final QC artifact mismatch", (p) => { p.final_qc[0].artifact_sha256 = "e".repeat(64); }, /QC_03_ARTIFACT_MISMATCH/],
    ["anti-slop artifact mismatch", (p) => { p.anti_slop.artifact_sha256 = "e".repeat(64); }, /ANTI_SLOP_ARTIFACT_MISMATCH/],
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
