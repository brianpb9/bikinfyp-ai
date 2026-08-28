import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { verifyPromptArchiveTrace } from "../lib/prompt-archive-trace.mjs";

function fixture() {
  return {
    job: {
      id: "job-1", provider_video: "byteplus-ark-seedance", output_url: "outputs/job-1.mp4",
      qc_result: JSON.stringify({ passed: true, checks: [{ code: "QC-08", status: "pass" }] }),
      completed_at: "2026-08-28T05:02:00.000Z",
    },
    archive: {
      job_id: "job-1",
      spec_json: JSON.stringify({ model: "seedance-1-0-pro", shots: [
        { idx: 0, prompt: "shot zero" }, { idx: 1, prompt: "shot one" },
      ] }),
      negative_prompt: "unsafe anatomy",
      model_params: JSON.stringify({ qualityTier: "pro", ratio: "9:16" }),
      created_at: "2026-08-28T05:00:00.000Z",
    },
    requests: [0, 1].map((shot_index) => ({
      job_id: "job-1", shot_index, provider: "byteplus", task_id: `request-${shot_index}`,
      created_at: `2026-08-28T05:01:0${shot_index}.000Z`,
    })),
  };
}

test("binds prompt, model, verdict, artifact, and provider requests", () => {
  const result = verifyPromptArchiveTrace(fixture());
  assert.equal(result.status, "PASS");
  assert.equal(result.trace_kind, "PROMPT_MODEL_VERDICT_ARTIFACT_REQUEST");
  assert.equal(result.prompt_shots, 2);
  assert.match(result.archive_fingerprint_sha256, /^[0-9a-f]{64}$/);
});

test("fails closed when a prompt shot has no provider request", () => {
  const input = fixture();
  input.requests.pop();
  assert.throws(() => verifyPromptArchiveTrace(input), /REQUEST_SHOT_COVERAGE_MISMATCH/);
});

test("fails closed when archive post-dates a provider request", () => {
  const input = fixture();
  input.archive.created_at = "2026-08-28T05:01:30.000Z";
  assert.throws(() => verifyPromptArchiveTrace(input), /ARCHIVE_AFTER_PROVIDER_REQUEST/);
});

test("fails closed for ambiguous provider requests", () => {
  const input = fixture();
  input.requests.push({ ...input.requests[0], task_id: "request-retry" });
  assert.throws(() => verifyPromptArchiveTrace(input), /AMBIGUOUS_REQUEST_FOR_SHOT/);
});

test("fails closed when request family does not match output provider", () => {
  const input = fixture();
  input.requests[0].provider = "provider-lain";
  assert.throws(() => verifyPromptArchiveTrace(input), /REQUEST_PROVIDER_MISMATCH/);
});

test("fails closed when verdict or artifact is missing", () => {
  const noVerdict = fixture();
  noVerdict.job.qc_result = JSON.stringify({ passed: false });
  assert.throws(() => verifyPromptArchiveTrace(noVerdict), /VERDICT_NOT_PASS/);
  const noArtifact = fixture();
  noArtifact.job.output_url = null;
  assert.throws(() => verifyPromptArchiveTrace(noArtifact), /ARTIFACT_MISSING/);
});

test("worker freezes provider request correlation before clearing retry memo", () => {
  const source = fs.readFileSync("lib/postgres/worker.ts", "utf8");
  const select = source.indexOf("SELECT job_id,shot_index,provider,task_id,created_at FROM provider_tasks");
  const archive = source.indexOf("provider_requests: requests", select);
  const ready = source.indexOf('jobs.transition(row.id, "READY"', archive);
  const clear = source.indexOf("pgTaskMemo.clear(row.id)", archive);
  assert.ok(select >= 0, "worker tidak membaca request provider terminal");
  assert.ok(archive > select, "worker tidak membekukan request ke arsip prompt");
  assert.ok(ready > archive, "READY dipublikasikan sebelum usaha pembekuan audit");
  assert.ok(clear > archive, "memo provider dibersihkan sebelum korelasi dibekukan");
});
