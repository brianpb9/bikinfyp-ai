import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyBrandAntiSlopEvidence } from "../lib/brand-antislop-evidence.mjs";
import { createJobEvidenceArchiveReader } from "../lib/job-evidence-archive.mjs";

const REF = "a".repeat(64);
const FRAME = "b".repeat(64);
const FRAME_BEAT = "e".repeat(64);
const FRAME_1_FIRST = "f".repeat(64);
const FRAME_1_BEAT = "1".repeat(64);
const ARTIFACT = "c".repeat(64);
const EXTRACTION = "d".repeat(64);
const SUBJECT = "2".repeat(64);
const REF_MANIFEST = "3".repeat(64);
const AUTH_RECEIPT = "4".repeat(64);
const EVAL_RECEIPT = "5".repeat(64);

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

function packet() {
  const value = {
    task: "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828",
    job_id: "job-1",
    product_id: "product-1",
    subject: { type: "product", id: "subject-product-1", product_id: "product-1", snapshot_sha256: SUBJECT },
    scope: "ZERO_SPEND_NO_SCORE_PREREQUISITE",
    approved_reference: { job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
      manifest_sha256: REF_MANIFEST, manifest_index: 0, storage_key: "jobs/job-1/approved-references/0-product.webp",
      sha256: REF, approved_at: "2026-08-28T05:00:00Z" },
    job_reference_manifest: { version: 2, job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
      storage_key: "jobs/job-1/evidence/reference-manifest.json", sha256: REF_MANIFEST,
      authorization: { actor_id: "reviewer-1", role: "AUTHORIZED_PRODUCT_REVIEWER",
        receipt: { storage_key: "jobs/job-1/evidence/reference-authorization.json", sha256: AUTH_RECEIPT, payload: {} },
        approved_at: "2026-08-28T05:00:00Z" },
      references: [{ job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
        storage_key: "jobs/job-1/approved-references/0-product.webp", sha256: REF }] },
    artifact: { job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1", shot_count: 2,
      storage_key: "outputs/job-1.mp4", sha256: ARTIFACT, completed_at: "2026-08-28T05:10:00Z" },
    extraction_manifest: { job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
      artifact_sha256: ARTIFACT, artifact_storage_key: "outputs/job-1.mp4",
      storage_key: "jobs/job-1/evidence/extraction.json",
      sha256: EXTRACTION, extractor: "ffmpeg@exact-sha", created_at: "2026-08-28T05:10:30Z",
      sampling_plan: { version: 1, require_all_product_bearing_shots: true, required_roles: ["first", "beat"] },
      shot_inventory: [{ shot_index: 0, product_bearing: true }, { shot_index: 1, product_bearing: true }],
      frames: [
        { shot_index: 0, role: "first", frame_sha256: FRAME, artifact_timestamp_ms: 0 },
        { shot_index: 0, role: "beat", frame_sha256: FRAME_BEAT, artifact_timestamp_ms: 1800 },
        { shot_index: 1, role: "first", frame_sha256: FRAME_1_FIRST, artifact_timestamp_ms: 3000 },
        { shot_index: 1, role: "beat", frame_sha256: FRAME_1_BEAT, artifact_timestamp_ms: 4800 },
      ] },
    samples: [
      { shot_index: 0, frame_role: "first", frame_sha256: FRAME, artifact_timestamp_ms: 0 },
      { shot_index: 0, frame_role: "beat", frame_sha256: FRAME_BEAT, artifact_timestamp_ms: 1800 },
      { shot_index: 1, frame_role: "first", frame_sha256: FRAME_1_FIRST, artifact_timestamp_ms: 3000 },
      { shot_index: 1, frame_role: "beat", frame_sha256: FRAME_1_BEAT, artifact_timestamp_ms: 4800 },
    ].map((sample) => ({
      job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
      artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION,
      ...sample, evaluated_at: "2026-08-28T05:11:00Z",
      qc_f1: {
        status: "PASS",
        evidence: { frameSha256: sample.frame_sha256, productPhotoSha256: REF },
        temuan: { bentukSama: true, tutupSama: true, warnaSama: true, tataLetakLabelSama: true, merekTerbaca: true },
      },
    })),
    final_qc: ["QC-03", "QC-10"].map((code) => ({ code, status: "pass", job_id: "job-1",
      artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION })),
    anti_slop: { job_id: "job-1", product_id: "product-1", subject_id: "subject-product-1",
      artifact_sha256: ARTIFACT, extraction_manifest_sha256: EXTRACTION,
      evaluator: { name: "anti-slop-frame-inspector", model: "deterministic-fixture", version: "1" },
      evaluated_at: "2026-08-28T05:12:00Z", evaluation_receipt_sha256: EVAL_RECEIPT,
      evaluation_receipt: { storage_key: "jobs/job-1/evidence/anti-slop.json", sha256: EVAL_RECEIPT, payload: {} },
      coverage: { status: "COMPLETE", inspected_frames: [
        { shot_index: 0, role: "first", frame_sha256: FRAME },
        { shot_index: 0, role: "beat", frame_sha256: FRAME_BEAT },
        { shot_index: 1, role: "first", frame_sha256: FRAME_1_FIRST },
        { shot_index: 1, role: "beat", frame_sha256: FRAME_1_BEAT },
      ] },
      generated_text_candidates: [], misspelled_brand_candidates: [], packshot_sha256: REF },
  };
  const authPayload = { job_id: value.job_id, product_id: value.product_id, subject_id: value.subject.id,
    subject_snapshot_sha256: SUBJECT, reference_sha256: REF, reference_storage_key: value.approved_reference.storage_key,
    actor_id: value.job_reference_manifest.authorization.actor_id,
    role: value.job_reference_manifest.authorization.role, approved_at: value.job_reference_manifest.authorization.approved_at };
  value.job_reference_manifest.authorization.receipt.payload = authPayload;
  value.job_reference_manifest.authorization.receipt.sha256 = digest(authPayload);
  const referenceManifestPayload = { version: 2, job_id: value.job_id, product_id: value.product_id,
    subject_id: value.subject.id, subject_snapshot_sha256: SUBJECT,
    authorization_receipt_sha256: value.job_reference_manifest.authorization.receipt.sha256,
    references: value.job_reference_manifest.references };
  value.job_reference_manifest.sha256 = digest(referenceManifestPayload);
  value.approved_reference.manifest_sha256 = value.job_reference_manifest.sha256;
  const extractionPayload = { job_id: value.job_id, product_id: value.product_id, subject_id: value.subject.id,
    artifact_sha256: ARTIFACT, artifact_storage_key: value.artifact.storage_key,
    extractor: value.extraction_manifest.extractor, created_at: value.extraction_manifest.created_at,
    sampling_plan: value.extraction_manifest.sampling_plan, shot_inventory: value.extraction_manifest.shot_inventory,
    frames: value.extraction_manifest.frames };
  value.extraction_manifest.sha256 = digest(extractionPayload);
  for (const sample of value.samples) sample.extraction_manifest_sha256 = value.extraction_manifest.sha256;
  for (const row of value.final_qc) row.extraction_manifest_sha256 = value.extraction_manifest.sha256;
  value.anti_slop.extraction_manifest_sha256 = value.extraction_manifest.sha256;
  const evaluationPayload = { job_id: value.job_id, product_id: value.product_id, subject_id: value.subject.id,
    artifact_sha256: ARTIFACT, extraction_manifest_sha256: value.extraction_manifest.sha256,
    evaluator: value.anti_slop.evaluator, evaluated_at: value.anti_slop.evaluated_at, coverage: value.anti_slop.coverage,
    generated_text_candidates: value.anti_slop.generated_text_candidates,
    misspelled_brand_candidates: value.anti_slop.misspelled_brand_candidates, packshot_sha256: REF };
  value.anti_slop.evaluation_receipt.payload = evaluationPayload;
  value.anti_slop.evaluation_receipt.sha256 = digest(evaluationPayload);
  value.anti_slop.evaluation_receipt_sha256 = value.anti_slop.evaluation_receipt.sha256;
  return value;
}

function trustedRuntime(value) {
  const archive = new Map([
    [value.job_reference_manifest.authorization.receipt.storage_key,
      JSON.stringify(canonical(value.job_reference_manifest.authorization.receipt.payload))],
    [value.job_reference_manifest.storage_key,
      JSON.stringify(canonical({ version: value.job_reference_manifest.version, job_id: value.job_id,
        product_id: value.product_id, subject_id: value.subject.id, subject_snapshot_sha256: SUBJECT,
        authorization_receipt_sha256: value.job_reference_manifest.authorization.receipt.sha256,
        references: value.job_reference_manifest.references }))],
    [value.extraction_manifest.storage_key,
      JSON.stringify(canonical({ job_id: value.job_id, product_id: value.product_id, subject_id: value.subject.id,
        artifact_sha256: ARTIFACT, artifact_storage_key: value.artifact.storage_key,
        extractor: value.extraction_manifest.extractor, created_at: value.extraction_manifest.created_at,
        sampling_plan: value.extraction_manifest.sampling_plan, shot_inventory: value.extraction_manifest.shot_inventory,
        frames: value.extraction_manifest.frames }))],
    [value.anti_slop.evaluation_receipt.storage_key,
      JSON.stringify(canonical(value.anti_slop.evaluation_receipt.payload))],
  ]);
  return {
    readJobArchive: (key) => archive.get(key),
    trustedActorRoles: { "reviewer-1": ["AUTHORIZED_PRODUCT_REVIEWER"] },
    approvedExtractors: ["ffmpeg@exact-sha"],
    approvedEvaluatorIdentities: ["anti-slop-frame-inspector|deterministic-fixture|1"],
  };
}

test("binds approved reference, output sample, shape/label findings, final QC, and packshot", () => {
  const input = packet();
  const result = verifyBrandAntiSlopEvidence(input, trustedRuntime(input));
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
    ["cross-job reference", (p) => { p.approved_reference.storage_key = "jobs/OTHER-JOB/approved-references/0.webp"; }, /REFERENCE_AUTHORIZATION_PAYLOAD_MISMATCH/],
    ["cross-job manifest entry", (p) => { p.job_reference_manifest.references[0].storage_key = "jobs/OTHER-JOB/approved-references/0.webp"; }, /REFERENCE_MANIFEST_ENTRY_NOT_JOB_OWNED/],
    ["cross-product reference", (p) => { p.approved_reference.product_id = "product-2"; }, /REFERENCE_PRODUCT_MISMATCH/],
    ["unauthorized reference role", (p) => { p.job_reference_manifest.authorization.role = "CALLER_ASSERTED"; }, /REFERENCE_AUTHORIZATION_ROLE_INVALID/],
    ["missing product-shot beat", (p) => { p.samples = p.samples.filter((x) => x.frame_role !== "beat"); }, /PRODUCT_SHOT_QC_COVERAGE_INCOMPLETE/],
    ["unsampled product shot", (p) => { p.samples = p.samples.filter((x) => x.shot_index !== 1); }, /PRODUCT_SHOT_QC_COVERAGE_INCOMPLETE/],
    ["incomplete extraction", (p) => { p.extraction_manifest.frames.pop(); }, /FRAME_INVENTORY_COVERAGE_INCOMPLETE/],
    ["anti-slop not run", (p) => { delete p.anti_slop.evaluator; }, /ANTI_SLOP_EVALUATOR_NOT_OBJECT/],
    ["anti-slop stale", (p) => { p.anti_slop.evaluated_at = "2026-08-28T05:10:00Z"; }, /ANTI_SLOP_PREDATES_EXTRACTION/],
    ["anti-slop partial coverage", (p) => { p.anti_slop.coverage.inspected_frames.pop(); }, /ANTI_SLOP_FRAME_COVERAGE_INCOMPLETE/],
    ["anti-slop receipt mismatch", (p) => { p.anti_slop.evaluation_receipt_sha256 = "6".repeat(64); }, /ANTI_SLOP_RECEIPT_BINDING_MISMATCH/],
    ["anti-slop receipt payload tamper", (p) => { p.anti_slop.evaluation_receipt.payload.evaluator.version = "other"; }, /ANTI_SLOP_EVALUATOR_NOT_APPROVED/],
  ];
  for (const [name, mutate, expected] of cases) {
    const input = packet(); const runtime = trustedRuntime(input); mutate(input);
    assert.throws(() => verifyBrandAntiSlopEvidence(input, runtime), expected, name);
  }
});

test("requires canonical archive bytes and trusted identities outside the caller packet", () => {
  const noRuntime = packet();
  assert.throws(() => verifyBrandAntiSlopEvidence(noRuntime), /TRUSTED_RUNTIME_NOT_OBJECT/);

  const forgedActor = packet(); const actorRuntime = trustedRuntime(forgedActor);
  forgedActor.job_reference_manifest.authorization.actor_id = "attacker";
  forgedActor.job_reference_manifest.authorization.receipt.payload.actor_id = "attacker";
  forgedActor.job_reference_manifest.authorization.receipt.sha256 = digest(forgedActor.job_reference_manifest.authorization.receipt.payload);
  assert.throws(() => verifyBrandAntiSlopEvidence(forgedActor, actorRuntime), /REFERENCE_AUTHORIZATION_RECEIPT_ARCHIVE_DIGEST_MISMATCH/);

  const untrustedActor = packet(); const untrustedRuntime = trustedRuntime(untrustedActor);
  untrustedRuntime.trustedActorRoles = {};
  assert.throws(() => verifyBrandAntiSlopEvidence(untrustedActor, untrustedRuntime), /REFERENCE_AUTHORIZATION_ACTOR_NOT_TRUSTED/);

  const untrustedEvaluator = packet(); const evaluatorRuntime = trustedRuntime(untrustedEvaluator);
  evaluatorRuntime.approvedEvaluatorIdentities = [];
  assert.throws(() => verifyBrandAntiSlopEvidence(untrustedEvaluator, evaluatorRuntime), /ANTI_SLOP_EVALUATOR_NOT_APPROVED/);

  const hiddenProductShot = packet(); const hiddenRuntime = trustedRuntime(hiddenProductShot);
  hiddenProductShot.extraction_manifest.shot_inventory[1].product_bearing = false;
  hiddenProductShot.samples = hiddenProductShot.samples.filter((sample) => sample.shot_index !== 1);
  assert.throws(() => verifyBrandAntiSlopEvidence(hiddenProductShot, hiddenRuntime), /EXTRACTION_MANIFEST_DIGEST_MISMATCH/);

  const omittedNonProductQc = packet(); const omittedRuntime = trustedRuntime(omittedNonProductQc);
  omittedNonProductQc.extraction_manifest.shot_inventory[1].product_bearing = false;
  const extractionPayload = omittedNonProductQc.extraction_manifest;
  // Even with a canonical trusted classification, every shot still needs QC.
  omittedRuntime.readJobArchive = (key) => key === extractionPayload.storage_key
    ? JSON.stringify(canonical({ job_id: omittedNonProductQc.job_id, product_id: omittedNonProductQc.product_id,
      subject_id: omittedNonProductQc.subject.id, artifact_sha256: ARTIFACT,
      artifact_storage_key: omittedNonProductQc.artifact.storage_key, extractor: extractionPayload.extractor,
      created_at: extractionPayload.created_at, sampling_plan: extractionPayload.sampling_plan,
      shot_inventory: extractionPayload.shot_inventory, frames: extractionPayload.frames }))
    : trustedRuntime(packet()).readJobArchive(key);
  const changedExtractionPayload = { job_id: omittedNonProductQc.job_id, product_id: omittedNonProductQc.product_id,
    subject_id: omittedNonProductQc.subject.id, artifact_sha256: ARTIFACT,
    artifact_storage_key: omittedNonProductQc.artifact.storage_key, extractor: extractionPayload.extractor,
    created_at: extractionPayload.created_at, sampling_plan: extractionPayload.sampling_plan,
    shot_inventory: extractionPayload.shot_inventory, frames: extractionPayload.frames };
  extractionPayload.sha256 = digest(changedExtractionPayload);
  omittedNonProductQc.samples = omittedNonProductQc.samples.filter((sample) => sample.shot_index !== 1);
  for (const sample of omittedNonProductQc.samples) sample.extraction_manifest_sha256 = extractionPayload.sha256;
  for (const row of omittedNonProductQc.final_qc) row.extraction_manifest_sha256 = extractionPayload.sha256;
  omittedNonProductQc.anti_slop.extraction_manifest_sha256 = extractionPayload.sha256;
  assert.throws(() => verifyBrandAntiSlopEvidence(omittedNonProductQc, omittedRuntime), /PRODUCT_SHOT_QC_COVERAGE_INCOMPLETE/);
});

test("job archive reader rejects encoded traversal and symlink escape", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-archive-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = path.join(root, "jobs", "job-1", "evidence");
  const attacker = path.join(root, "jobs", "job-attacker", "evidence");
  fs.mkdirSync(evidence, { recursive: true });
  fs.mkdirSync(attacker, { recursive: true });
  fs.writeFileSync(path.join(evidence, "valid.json"), "trusted");
  fs.writeFileSync(path.join(attacker, "forged.json"), "forged");
  fs.symlinkSync(path.join(attacker, "forged.json"), path.join(evidence, "linked.json"));
  const read = createJobEvidenceArchiveReader(root, "job-1");
  assert.equal(read("jobs/job-1/evidence/valid.json").toString(), "trusted");
  assert.throws(() => read("jobs/job-1/evidence/%2e%2e/%2e%2e/job-attacker/evidence/forged.json"), /JOB_ARCHIVE_KEY_NOT_CANONICAL/);
  assert.throws(() => read("jobs/job-1/evidence/../../job-attacker/evidence/forged.json"), /JOB_ARCHIVE_KEY_INVALID/);
  assert.throws(() => read("jobs/job-1/evidence/linked.json"), /JOB_ARCHIVE_SYMLINK_ESCAPES_JOB/);
  assert.throws(() => read("jobs/job-1/evidence/valid.json?alias"), /JOB_ARCHIVE_KEY_NOT_CANONICAL/);
});

test("rejects every product-identity and generated-text slop signal", () => {
  for (const field of ["bentukSama", "tutupSama", "warnaSama", "tataLetakLabelSama", "merekTerbaca"]) {
    const input = packet(); const runtime = trustedRuntime(input); input.samples[0].qc_f1.temuan[field] = false;
    assert.throws(() => verifyBrandAntiSlopEvidence(input, runtime), /NOT_PROVEN/, field);
  }
  const generated = packet(); generated.anti_slop.generated_text_candidates = ["FAKE SALE 90%"];
  assert.throws(() => verifyBrandAntiSlopEvidence(generated, trustedRuntime(generated)), /GENERATED_TEXT_SLOP_DETECTED/);
  const misspelled = packet(); misspelled.anti_slop.misspelled_brand_candidates = ["moseru"];
  assert.throws(() => verifyBrandAntiSlopEvidence(misspelled, trustedRuntime(misspelled)), /MISSPELLED_BRAND_SLOP_DETECTED/);
  for (const code of ["QC-03", "QC-10"]) {
    const input = packet(); input.final_qc.find((row) => row.code === code).status = "fail";
    assert.throws(() => verifyBrandAntiSlopEvidence(input, trustedRuntime(input)), /NOT_PASS/, code);
  }
});
