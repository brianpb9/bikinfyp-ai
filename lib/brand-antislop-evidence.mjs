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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
  return value;
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function verifyBrandAntiSlopEvidence(input) {
  const packet = object(input, "PACKET");
  if (packet.task !== EXPECTED_TASK) throw new Error("TASK_MISMATCH");
  if (packet.scope !== "ZERO_SPEND_NO_SCORE_PREREQUISITE") throw new Error("SCOPE_NOT_ZERO_SPEND_NO_SCORE");
  const jobId = text(packet.job_id, "JOB_ID");
  const productId = text(packet.product_id, "PRODUCT_ID");
  const subject = object(packet.subject, "SUBJECT");
  if (subject.type !== "product") throw new Error("SUBJECT_TYPE_MISMATCH");
  const subjectId = text(subject.id, "SUBJECT_ID");
  if (subject.product_id !== productId) throw new Error("SUBJECT_PRODUCT_MISMATCH");
  const subjectSnapshotSha = sha(subject.snapshot_sha256, "SUBJECT_SNAPSHOT");

  const reference = object(packet.approved_reference, "APPROVED_REFERENCE");
  const referenceManifest = object(packet.job_reference_manifest, "JOB_REFERENCE_MANIFEST");
  const artifact = object(packet.artifact, "ARTIFACT");
  const referenceSha = sha(reference.sha256, "REFERENCE");
  const artifactSha = sha(artifact.sha256, "ARTIFACT");
  text(reference.storage_key, "REFERENCE_STORAGE_KEY");
  if (reference.job_id !== jobId) throw new Error("REFERENCE_JOB_MISMATCH");
  if (reference.product_id !== productId) throw new Error("REFERENCE_PRODUCT_MISMATCH");
  if (reference.subject_id !== subjectId) throw new Error("REFERENCE_SUBJECT_MISMATCH");
  const referenceManifestSha = sha(referenceManifest.sha256, "REFERENCE_MANIFEST");
  if (reference.manifest_sha256 !== referenceManifestSha) throw new Error("REFERENCE_MANIFEST_BINDING_MISMATCH");
  if (referenceManifest.job_id !== jobId) throw new Error("REFERENCE_MANIFEST_JOB_MISMATCH");
  if (referenceManifest.product_id !== productId) throw new Error("REFERENCE_MANIFEST_PRODUCT_MISMATCH");
  if (referenceManifest.subject_id !== subjectId) throw new Error("REFERENCE_MANIFEST_SUBJECT_MISMATCH");
  if (referenceManifest.version !== 2) throw new Error("REFERENCE_MANIFEST_VERSION_INVALID");
  text(referenceManifest.storage_key, "REFERENCE_MANIFEST_STORAGE_KEY");
  const authorization = object(referenceManifest.authorization, "REFERENCE_AUTHORIZATION");
  const authorizationActor = text(authorization.actor_id, "REFERENCE_AUTHORIZATION_ACTOR");
  const authorizationRole = text(authorization.role, "REFERENCE_AUTHORIZATION_ROLE");
  if (authorizationRole !== "AUTHORIZED_PRODUCT_REVIEWER") throw new Error("REFERENCE_AUTHORIZATION_ROLE_INVALID");
  const authorizationReceipt = object(authorization.receipt, "REFERENCE_AUTHORIZATION_RECEIPT");
  text(authorizationReceipt.storage_key, "REFERENCE_AUTHORIZATION_RECEIPT_KEY");
  const authorizationReceiptSha = sha(authorizationReceipt.sha256, "REFERENCE_AUTHORIZATION_RECEIPT");
  const authorizedAt = time(authorization.approved_at, "REFERENCE_AUTHORIZATION_APPROVED_AT");
  const authorizationPayload = object(authorizationReceipt.payload, "REFERENCE_AUTHORIZATION_RECEIPT_PAYLOAD");
  if (authorizationPayload.job_id !== jobId || authorizationPayload.product_id !== productId
      || authorizationPayload.subject_id !== subjectId || authorizationPayload.reference_sha256 !== referenceSha
      || authorizationPayload.reference_storage_key !== reference.storage_key
      || authorizationPayload.subject_snapshot_sha256 !== subjectSnapshotSha
      || authorizationPayload.actor_id !== authorizationActor || authorizationPayload.role !== authorizationRole
      || time(authorizationPayload.approved_at, "REFERENCE_AUTHORIZATION_PAYLOAD_TIME") !== authorizedAt) {
    throw new Error("REFERENCE_AUTHORIZATION_PAYLOAD_MISMATCH");
  }
  if (digest(authorizationPayload) !== authorizationReceiptSha) throw new Error("REFERENCE_AUTHORIZATION_RECEIPT_DIGEST_MISMATCH");
  if (!Array.isArray(referenceManifest.references) || referenceManifest.references.length === 0) {
    throw new Error("REFERENCE_MANIFEST_ENTRIES_MISSING");
  }
  if (!Number.isInteger(reference.manifest_index) || reference.manifest_index < 0) throw new Error("REFERENCE_MANIFEST_INDEX_INVALID");
  for (const raw of referenceManifest.references) {
    const entry = object(raw, "REFERENCE_MANIFEST_ENTRY");
    if (entry.job_id !== jobId || entry.product_id !== productId || entry.subject_id !== subjectId) {
      throw new Error("REFERENCE_MANIFEST_ENTRY_IDENTITY_MISMATCH");
    }
    const key = text(entry.storage_key, "REFERENCE_MANIFEST_ENTRY_KEY");
    if (!key.startsWith(`jobs/${jobId}/approved-references/`)) throw new Error("REFERENCE_MANIFEST_ENTRY_NOT_JOB_OWNED");
    sha(entry.sha256, "REFERENCE_MANIFEST_ENTRY");
  }
  const manifestEntry = object(referenceManifest.references[reference.manifest_index], "REFERENCE_MANIFEST_ENTRY");
  if (manifestEntry.job_id !== jobId || manifestEntry.product_id !== productId || manifestEntry.subject_id !== subjectId) {
    throw new Error("REFERENCE_MANIFEST_ENTRY_IDENTITY_MISMATCH");
  }
  if (manifestEntry.storage_key !== reference.storage_key || manifestEntry.sha256 !== referenceSha) {
    throw new Error("REFERENCE_MANIFEST_ENTRY_BYTES_MISMATCH");
  }
  const referenceManifestPayload = {
    version: referenceManifest.version, job_id: jobId, product_id: productId, subject_id: subjectId,
    subject_snapshot_sha256: subjectSnapshotSha,
    authorization_receipt_sha256: authorizationReceiptSha, references: referenceManifest.references,
  };
  if (digest(referenceManifestPayload) !== referenceManifestSha) throw new Error("REFERENCE_MANIFEST_DIGEST_MISMATCH");
  text(artifact.storage_key, "ARTIFACT_STORAGE_KEY");
  if (artifact.job_id !== jobId) throw new Error("ARTIFACT_JOB_MISMATCH");
  if (artifact.product_id !== productId || artifact.subject_id !== subjectId) throw new Error("ARTIFACT_SUBJECT_MISMATCH");
  if (!Number.isInteger(artifact.shot_count) || artifact.shot_count < 1) throw new Error("ARTIFACT_SHOT_COUNT_INVALID");
  const approvedAt = time(reference.approved_at, "REFERENCE_APPROVED_AT");
  if (approvedAt !== authorizedAt) throw new Error("REFERENCE_AUTHORIZATION_TIME_MISMATCH");
  const completedAt = time(artifact.completed_at, "ARTIFACT_COMPLETED_AT");
  if (completedAt < approvedAt) throw new Error("ARTIFACT_PREDATES_APPROVED_REFERENCE");

  const extraction = object(packet.extraction_manifest, "EXTRACTION_MANIFEST");
  const extractionSha = sha(extraction.sha256, "EXTRACTION_MANIFEST");
  if (extraction.job_id !== jobId) throw new Error("EXTRACTION_JOB_MISMATCH");
  if (extraction.product_id !== productId || extraction.subject_id !== subjectId) throw new Error("EXTRACTION_SUBJECT_MISMATCH");
  if (extraction.artifact_sha256 !== artifactSha) throw new Error("EXTRACTION_ARTIFACT_MISMATCH");
  if (extraction.artifact_storage_key !== artifact.storage_key) throw new Error("EXTRACTION_ARTIFACT_KEY_MISMATCH");
  text(extraction.storage_key, "EXTRACTION_STORAGE_KEY");
  text(extraction.extractor, "EXTRACTION_EXTRACTOR");
  const extractedAt = time(extraction.created_at, "EXTRACTION_CREATED_AT");
  if (extractedAt < completedAt) throw new Error("EXTRACTION_PREDATES_ARTIFACT");
  const plan = object(extraction.sampling_plan, "SAMPLING_PLAN");
  if (plan.version !== 1 || plan.require_all_product_bearing_shots !== true) throw new Error("SAMPLING_PLAN_INVALID");
  if (!Array.isArray(plan.required_roles) || plan.required_roles.length !== 2
      || !plan.required_roles.includes("first") || !plan.required_roles.includes("beat")) {
    throw new Error("SAMPLING_PLAN_ROLES_INVALID");
  }
  if (!Array.isArray(extraction.shot_inventory) || extraction.shot_inventory.length !== artifact.shot_count) {
    throw new Error("SHOT_INVENTORY_INCOMPLETE");
  }
  if (!Array.isArray(extraction.frames) || extraction.frames.length === 0) throw new Error("FRAME_INVENTORY_MISSING");
  const shots = new Map();
  for (const raw of extraction.shot_inventory) {
    const shot = object(raw, "SHOT_INVENTORY_ENTRY");
    if (!Number.isInteger(shot.shot_index) || shot.shot_index < 0 || shots.has(shot.shot_index)) throw new Error("SHOT_INVENTORY_INDEX_INVALID");
    if (typeof shot.product_bearing !== "boolean") throw new Error("SHOT_INVENTORY_PRODUCT_FLAG_INVALID");
    shots.set(shot.shot_index, shot);
  }
  for (let index = 0; index < artifact.shot_count; index++) if (!shots.has(index)) throw new Error("SHOT_INVENTORY_NOT_CONTIGUOUS");
  const frames = new Map();
  for (const raw of extraction.frames) {
    const frame = object(raw, "FRAME_INVENTORY_ENTRY");
    if (!shots.has(frame.shot_index)) throw new Error("FRAME_SHOT_NOT_IN_INVENTORY");
    if (!plan.required_roles.includes(frame.role)) throw new Error("FRAME_ROLE_NOT_IN_PLAN");
    const key = `${frame.shot_index}:${frame.role}`;
    if (frames.has(key)) throw new Error("FRAME_INVENTORY_DUPLICATE");
    sha(frame.frame_sha256, "FRAME_INVENTORY");
    if (!Number.isFinite(frame.artifact_timestamp_ms) || frame.artifact_timestamp_ms < 0) throw new Error("FRAME_TIMESTAMP_INVALID");
    frames.set(key, frame);
  }
  for (const shot of shots.values()) for (const role of plan.required_roles) {
    if (!frames.has(`${shot.shot_index}:${role}`)) throw new Error("FRAME_INVENTORY_COVERAGE_INCOMPLETE");
  }
  const extractionPayload = {
    job_id: jobId, product_id: productId, subject_id: subjectId, artifact_sha256: artifactSha,
    artifact_storage_key: artifact.storage_key, extractor: extraction.extractor, created_at: extraction.created_at,
    sampling_plan: extraction.sampling_plan, shot_inventory: extraction.shot_inventory, frames: extraction.frames,
  };
  if (digest(extractionPayload) !== extractionSha) throw new Error("EXTRACTION_MANIFEST_DIGEST_MISMATCH");

  if (!Array.isArray(packet.samples) || packet.samples.length === 0) throw new Error("OUTPUT_SAMPLES_MISSING");
  const sampleKeys = new Set();
  for (const raw of packet.samples) {
    const sample = object(raw, "OUTPUT_SAMPLE");
    if (!Number.isInteger(sample.shot_index) || sample.shot_index < 0) throw new Error("OUTPUT_SAMPLE_INDEX_INVALID");
    const key = `${sample.shot_index}:${sample.frame_role}`;
    if (sampleKeys.has(key)) throw new Error("OUTPUT_SAMPLE_DUPLICATE");
    sampleKeys.add(key);
    const inventoryFrame = frames.get(key);
    if (!inventoryFrame) throw new Error("OUTPUT_SAMPLE_NOT_IN_EXTRACTION");
    const frameSha = sha(sample.frame_sha256, "OUTPUT_FRAME");
    if (sample.job_id !== jobId) throw new Error("OUTPUT_SAMPLE_JOB_MISMATCH");
    if (sample.artifact_sha256 !== artifactSha) throw new Error("OUTPUT_SAMPLE_ARTIFACT_MISMATCH");
    if (sample.extraction_manifest_sha256 !== extractionSha) throw new Error("OUTPUT_SAMPLE_EXTRACTION_MISMATCH");
    if (sample.product_id !== productId || sample.subject_id !== subjectId) throw new Error("OUTPUT_SAMPLE_SUBJECT_MISMATCH");
    if (inventoryFrame.frame_sha256 !== frameSha || inventoryFrame.artifact_timestamp_ms !== sample.artifact_timestamp_ms) {
      throw new Error("OUTPUT_SAMPLE_INVENTORY_MISMATCH");
    }
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
  for (const shot of shots.values()) if (shot.product_bearing) for (const role of plan.required_roles) {
    if (!sampleKeys.has(`${shot.shot_index}:${role}`)) throw new Error("PRODUCT_SHOT_QC_COVERAGE_INCOMPLETE");
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
  if (antiSlop.product_id !== productId || antiSlop.subject_id !== subjectId) throw new Error("ANTI_SLOP_SUBJECT_MISMATCH");
  const evaluator = object(antiSlop.evaluator, "ANTI_SLOP_EVALUATOR");
  text(evaluator.name, "ANTI_SLOP_EVALUATOR_NAME");
  text(evaluator.model, "ANTI_SLOP_EVALUATOR_MODEL");
  text(evaluator.version, "ANTI_SLOP_EVALUATOR_VERSION");
  const antiSlopEvaluatedAt = time(antiSlop.evaluated_at, "ANTI_SLOP_EVALUATED_AT");
  if (antiSlopEvaluatedAt < extractedAt) throw new Error("ANTI_SLOP_PREDATES_EXTRACTION");
  const evaluationReceipt = object(antiSlop.evaluation_receipt, "ANTI_SLOP_EVALUATION_RECEIPT");
  text(evaluationReceipt.storage_key, "ANTI_SLOP_EVALUATION_RECEIPT_KEY");
  const evaluationReceiptSha = sha(evaluationReceipt.sha256, "ANTI_SLOP_EVALUATION_RECEIPT");
  if (antiSlop.evaluation_receipt_sha256 !== evaluationReceiptSha) throw new Error("ANTI_SLOP_RECEIPT_BINDING_MISMATCH");
  const coverage = object(antiSlop.coverage, "ANTI_SLOP_COVERAGE");
  if (coverage.status !== "COMPLETE") throw new Error("ANTI_SLOP_COVERAGE_NOT_COMPLETE");
  if (!Array.isArray(coverage.inspected_frames)) throw new Error("ANTI_SLOP_INSPECTED_FRAMES_MISSING");
  const inspected = new Map();
  for (const raw of coverage.inspected_frames) {
    const frame = object(raw, "ANTI_SLOP_INSPECTED_FRAME");
    const key = `${frame.shot_index}:${frame.role}`;
    if (inspected.has(key)) throw new Error("ANTI_SLOP_INSPECTED_FRAME_DUPLICATE");
    inspected.set(key, frame.frame_sha256);
  }
  if (inspected.size !== frames.size) throw new Error("ANTI_SLOP_FRAME_COVERAGE_INCOMPLETE");
  for (const [key, frame] of frames) if (inspected.get(key) !== frame.frame_sha256) throw new Error("ANTI_SLOP_FRAME_COVERAGE_INCOMPLETE");
  if (!Array.isArray(antiSlop.generated_text_candidates) || antiSlop.generated_text_candidates.length !== 0) {
    throw new Error("GENERATED_TEXT_SLOP_DETECTED");
  }
  if (!Array.isArray(antiSlop.misspelled_brand_candidates) || antiSlop.misspelled_brand_candidates.length !== 0) {
    throw new Error("MISSPELLED_BRAND_SLOP_DETECTED");
  }
  if (sha(antiSlop.packshot_sha256, "PACKSHOT") !== referenceSha) throw new Error("PACKSHOT_REFERENCE_MISMATCH");
  const evaluationPayload = object(evaluationReceipt.payload, "ANTI_SLOP_EVALUATION_RECEIPT_PAYLOAD");
  const expectedEvaluationPayload = {
    job_id: jobId, product_id: productId, subject_id: subjectId, artifact_sha256: artifactSha,
    extraction_manifest_sha256: extractionSha, evaluator: antiSlop.evaluator, evaluated_at: antiSlop.evaluated_at,
    coverage: antiSlop.coverage, generated_text_candidates: antiSlop.generated_text_candidates,
    misspelled_brand_candidates: antiSlop.misspelled_brand_candidates, packshot_sha256: antiSlop.packshot_sha256,
  };
  if (JSON.stringify(canonical(evaluationPayload)) !== JSON.stringify(canonical(expectedEvaluationPayload))) {
    throw new Error("ANTI_SLOP_EVALUATION_RECEIPT_PAYLOAD_MISMATCH");
  }
  if (digest(evaluationPayload) !== evaluationReceiptSha) throw new Error("ANTI_SLOP_EVALUATION_RECEIPT_DIGEST_MISMATCH");

  const evidenceSha256 = crypto.createHash("sha256").update(JSON.stringify(packet)).digest("hex");
  return {
    status: "PASS",
    task: packet.task,
    job_id: jobId,
    product_id: productId,
    subject_id: subjectId,
    scope: packet.scope,
    samples: packet.samples.length,
    reference_sha256: referenceSha,
    reference_manifest_sha256: referenceManifestSha,
    artifact_sha256: artifactSha,
    extraction_manifest_sha256: extractionSha,
    anti_slop_evaluation_receipt_sha256: evaluationReceiptSha,
    evidence_sha256: evidenceSha256,
    claim: "NO_SCORE",
  };
}
