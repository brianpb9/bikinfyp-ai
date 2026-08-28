import crypto from "node:crypto";

function parseObject(value, field) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { throw new Error(`${field}_INVALID_JSON`); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field}_NOT_OBJECT`);
  }
  return parsed;
}

function timestamp(value, field) {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) throw new Error(`${field}_INVALID_TIMESTAMP`);
  return parsed;
}

function nonEmpty(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field}_MISSING`);
  return value;
}

function sameProvider(requestProvider, outputProvider) {
  return requestProvider === outputProvider || outputProvider.startsWith(`${requestProvider}-`);
}

export function verifyPromptArchiveTrace(input) {
  const job = parseObject(input?.job, "JOB");
  const archive = parseObject(input?.archive, "ARCHIVE");
  const requests = input?.requests;
  if (!Array.isArray(requests) || requests.length === 0) throw new Error("PROVIDER_REQUESTS_MISSING");

  const jobId = nonEmpty(job.id, "JOB_ID");
  if (job.state !== "READY") throw new Error("JOB_NOT_READY");
  if (archive.job_id !== jobId) throw new Error("ARCHIVE_JOB_MISMATCH");
  nonEmpty(job.output_url, "ARTIFACT");
  nonEmpty(job.provider_video, "JOB_PROVIDER");
  const verdict = parseObject(job.qc_result, "VERDICT");
  if (verdict.passed !== true) throw new Error("VERDICT_NOT_PASS");
  const completedAt = timestamp(job.completed_at, "JOB_COMPLETED_AT");

  const spec = parseObject(archive.spec_json, "SPEC");
  const modelParams = parseObject(archive.model_params, "MODEL_PARAMS");
  const shots = spec.shots;
  if (!Array.isArray(shots) || shots.length === 0) throw new Error("PROMPT_SHOTS_MISSING");
  const indices = shots.map((shot) => {
    if (!shot || !Number.isInteger(shot.idx) || typeof shot.prompt !== "string" || !shot.prompt.trim()) {
      throw new Error("PROMPT_SHOT_INVALID");
    }
    return shot.idx;
  });
  if (new Set(indices).size !== indices.length) throw new Error("PROMPT_SHOT_INDEX_DUPLICATE");
  nonEmpty(spec.model, "MODEL");
  if (typeof modelParams.qualityTier !== "string" && typeof modelParams.quality_tier !== "string") {
    throw new Error("MODEL_TIER_MISSING");
  }

  const archiveAt = timestamp(archive.created_at, "ARCHIVE_CREATED_AT");
  const byShot = new Map();
  for (const requestRaw of requests) {
    const request = parseObject(requestRaw, "PROVIDER_REQUEST");
    if (request.job_id !== jobId) throw new Error("REQUEST_JOB_MISMATCH");
    if (!Number.isInteger(request.shot_index)) throw new Error("REQUEST_SHOT_INDEX_INVALID");
    nonEmpty(request.task_id, "REQUEST_ID");
    // Memo memakai keluarga provider (`byteplus`), sedangkan output memakai
    // adapter konkret (`byteplus-ark-seedance`). Keduanya harus tetap terikat
    // dengan exact family prefix; provider lain tidak boleh ikut lolos.
    if (!sameProvider(request.provider, job.provider_video)) throw new Error("REQUEST_PROVIDER_MISMATCH");
    const requestAt = timestamp(request.created_at, "REQUEST_CREATED_AT");
    if (requestAt < archiveAt) {
      throw new Error("ARCHIVE_AFTER_PROVIDER_REQUEST");
    }
    if (requestAt > completedAt) throw new Error("REQUEST_AFTER_JOB_COMPLETION");
    if (byShot.has(request.shot_index)) throw new Error("AMBIGUOUS_REQUEST_FOR_SHOT");
    byShot.set(request.shot_index, request.task_id);
  }
  if (byShot.size !== indices.length || indices.some((idx) => !byShot.has(idx))) {
    throw new Error("REQUEST_SHOT_COVERAGE_MISMATCH");
  }
  if (new Set(byShot.values()).size !== byShot.size) throw new Error("REQUEST_ID_REUSED");

  const archiveFingerprint = crypto.createHash("sha256").update(JSON.stringify({
    job_id: jobId,
    spec,
    model_params: modelParams,
    negative_prompt: archive.negative_prompt,
    created_at: archive.created_at,
  })).digest("hex");

  return {
    status: "PASS",
    trace_kind: "PROMPT_MODEL_VERDICT_ARTIFACT_REQUEST",
    job_id: jobId,
    prompt_shots: indices.length,
    provider_requests: requests.length,
    provider: job.provider_video,
    model: spec.model,
    verdict: "PASS",
    artifact: job.output_url,
    archive_fingerprint_sha256: archiveFingerprint,
  };
}
