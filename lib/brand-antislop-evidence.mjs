import crypto from "node:crypto";

const EXPECTED_TASK = "SCORE80-BRAND-ANTISLOP-ZERO-SPEND-20260828";

function object(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field}_NOT_OBJECT`);
  return value;
}

function text(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field}_MISSING`);
  return value;
}

function sha(value, field) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${field}_INVALID_SHA256`);
  return value;
}

function time(value, field) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) throw new Error(`${field}_INVALID_TIMESTAMP`);
  return parsed;
}

export function verifyBrandAntiSlopEvidence(input) {
  const packet = object(input, "PACKET");
  if (packet.task !== EXPECTED_TASK) throw new Error("TASK_MISMATCH");
  if (packet.scope !== "ZERO_SPEND_NO_SCORE_PREREQUISITE") throw new Error("SCOPE_NOT_ZERO_SPEND_NO_SCORE");
  const reference = object(packet.approved_reference, "APPROVED_REFERENCE");
  const artifact = object(packet.artifact, "ARTIFACT");
  const jobId = text(packet.job_id, "JOB_ID");
  const referenceSha = sha(reference.sha256, "REFERENCE");
  const artifactSha = sha(artifact.sha256, "ARTIFACT");
  text(reference.storage_key, "REFERENCE_STORAGE_KEY");
  text(artifact.storage_key, "ARTIFACT_STORAGE_KEY");
  if (artifact.job_id !== jobId) throw new Error("ARTIFACT_JOB_MISMATCH");
  const approvedAt = time(reference.approved_at, "REFERENCE_APPROVED_AT");
  const completedAt = time(artifact.completed_at, "ARTIFACT_COMPLETED_AT");
  if (completedAt < approvedAt) throw new Error("ARTIFACT_PREDATES_APPROVED_REFERENCE");

  const extraction = object(packet.extraction_manifest, "EXTRACTION_MANIFEST");
  const extractionSha = sha(extraction.sha256, "EXTRACTION_MANIFEST");
  if (extraction.job_id !== jobId) throw new Error("EXTRACTION_JOB_MISMATCH");
  if (extraction.artifact_sha256 !== artifactSha) throw new Error("EXTRACTION_ARTIFACT_MISMATCH");
  if (extraction.artifact_storage_key !== artifact.storage_key) throw new Error("EXTRACTION_ARTIFACT_KEY_MISMATCH");
  text(extraction.storage_key, "EXTRACTION_STORAGE_KEY");
  text(extraction.extractor, "EXTRACTION_EXTRACTOR");
  const extractedAt = time(extraction.created_at, "EXTRACTION_CREATED_AT");
  if (extractedAt < completedAt) throw new Error("EXTRACTION_PREDATES_ARTIFACT");

  if (!Array.isArray(packet.samples) || packet.samples.length === 0) throw new Error("OUTPUT_SAMPLES_MISSING");
  const indices = new Set();
  for (const raw of packet.samples) {
    const sample = object(raw, "OUTPUT_SAMPLE");
    if (!Number.isInteger(sample.shot_index) || sample.shot_index < 0) throw new Error("OUTPUT_SAMPLE_INDEX_INVALID");
    if (indices.has(sample.shot_index)) throw new Error("OUTPUT_SAMPLE_INDEX_DUPLICATE");
    indices.add(sample.shot_index);
    const frameSha = sha(sample.frame_sha256, "OUTPUT_FRAME");
    if (sample.job_id !== jobId) throw new Error("OUTPUT_SAMPLE_JOB_MISMATCH");
    if (sample.artifact_sha256 !== artifactSha) throw new Error("OUTPUT_SAMPLE_ARTIFACT_MISMATCH");
    if (sample.extraction_manifest_sha256 !== extractionSha) throw new Error("OUTPUT_SAMPLE_EXTRACTION_MISMATCH");
    if (time(sample.evaluated_at, "OUTPUT_SAMPLE_EVALUATED_AT") < extractedAt) throw new Error("OUTPUT_SAMPLE_PREDATES_EXTRACTION");
    const qc = object(sample.qc_f1, "QC_F1");
    if (qc.status !== "PASS") throw new Error("QC_F1_NOT_PASS");
    const binding = object(qc.evidence, "QC_F1_EVIDENCE");
    if (binding.frameSha256 !== frameSha) throw new Error("QC_F1_FRAME_BINDING_MISMATCH");
    if (binding.productPhotoSha256 !== referenceSha) throw new Error("QC_F1_REFERENCE_BINDING_MISMATCH");
    const findings = object(qc.temuan, "QC_F1_FINDINGS");
    for (const field of ["bentukSama", "tutupSama", "warnaSama", "tataLetakLabelSama", "merekTerbaca"]) {
      if (findings[field] !== true) throw new Error(`QC_F1_${field.toUpperCase()}_NOT_PROVEN`);
    }
  }

  if (!Array.isArray(packet.final_qc)) throw new Error("FINAL_QC_MISSING");
  for (const code of ["QC-03", "QC-10"]) {
    const rows = packet.final_qc.filter((row) => row?.code === code);
    if (rows.length !== 1) throw new Error(`${code.replace("-", "_")}_AMBIGUOUS_OR_MISSING`);
    if (rows[0].status !== "pass") throw new Error(`${code.replace("-", "_")}_NOT_PASS`);
    if (rows[0].job_id !== jobId) throw new Error(`${code.replace("-", "_")}_JOB_MISMATCH`);
    if (rows[0].artifact_sha256 !== artifactSha) throw new Error(`${code.replace("-", "_")}_ARTIFACT_MISMATCH`);
    if (rows[0].extraction_manifest_sha256 !== extractionSha) throw new Error(`${code.replace("-", "_")}_EXTRACTION_MISMATCH`);
  }

  const antiSlop = object(packet.anti_slop, "ANTI_SLOP");
  if (antiSlop.job_id !== jobId) throw new Error("ANTI_SLOP_JOB_MISMATCH");
  if (antiSlop.artifact_sha256 !== artifactSha) throw new Error("ANTI_SLOP_ARTIFACT_MISMATCH");
  if (antiSlop.extraction_manifest_sha256 !== extractionSha) throw new Error("ANTI_SLOP_EXTRACTION_MISMATCH");
  if (!Array.isArray(antiSlop.generated_text_candidates) || antiSlop.generated_text_candidates.length !== 0) {
    throw new Error("GENERATED_TEXT_SLOP_DETECTED");
  }
  if (!Array.isArray(antiSlop.misspelled_brand_candidates) || antiSlop.misspelled_brand_candidates.length !== 0) {
    throw new Error("MISSPELLED_BRAND_SLOP_DETECTED");
  }
  if (sha(antiSlop.packshot_sha256, "PACKSHOT") !== referenceSha) throw new Error("PACKSHOT_REFERENCE_MISMATCH");

  const evidenceSha256 = crypto.createHash("sha256").update(JSON.stringify(packet)).digest("hex");
  return {
    status: "PASS",
    task: packet.task,
    job_id: jobId,
    scope: packet.scope,
    samples: packet.samples.length,
    reference_sha256: referenceSha,
    artifact_sha256: artifactSha,
    evidence_sha256: evidenceSha256,
    claim: "NO_SCORE",
  };
}
