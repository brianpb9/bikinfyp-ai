import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const evidence = JSON.parse(fs.readFileSync(
  new URL("./managed-evidence.json", import.meta.url), "utf8",
));
const raw = JSON.parse(fs.readFileSync(
  new URL("./raw-managed-events.json", import.meta.url), "utf8",
));
const deployRaw = JSON.parse(fs.readFileSync(new URL("./RAW-DEPLOY.json", import.meta.url), "utf8"));
const jobsRaw = JSON.parse(fs.readFileSync(new URL("./RAW-DURABILITY-JOBS.json", import.meta.url), "utf8"));
const logsRaw = JSON.parse(fs.readFileSync(new URL("./RAW-RENDER-LOGS.json", import.meta.url), "utf8"));
const captureMetadata = JSON.parse(fs.readFileSync(new URL("./capture-metadata.json", import.meta.url), "utf8"));
const captureBytes = new Map(captureMetadata.captures.map((capture) => {
  const bytes = fs.readFileSync(new URL(`./${capture.file}`, import.meta.url));
  assert.equal(bytes.byteLength, capture.bytes, `${capture.file} byte count`);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), capture.sha256, `${capture.file} digest`);
  return [capture.file, bytes];
}));
const capturedDeploy = JSON.parse(captureBytes.get("CAPTURE-DEPLOY-SOURCE.json"));
const capturedWebJobs = JSON.parse(captureBytes.get("CAPTURE-WEB-JOBS-SOURCE.json"));
const capturedWorkerJobs = JSON.parse(captureBytes.get("CAPTURE-WORKER-JOBS-SOURCE.json"));
const capturedLogs = JSON.parse(captureBytes.get("CAPTURE-LOGS-SOURCE.json"));
const capturedHealth = JSON.parse(captureBytes.get("CAPTURE-HEALTH-SOURCE.json"));
const sha = "630a0a1369522a2e17ac79b3eb136a4c3bc9e625";
const binding = "6d8f03e28a15f4f6fe729387c6f8a7e94645853d6729fd3c908a636b1d47683c";

assert.equal(evidence.task, "P0-JJ-GLOW-FINAL-CANDIDATE-ROOT-CAUSE-20260831");
assert.equal(evidence.reviewed_runtime_sha, sha);
assert.equal(raw.deploy.commit, sha);
assert.equal(raw.deploy.status, "live");
assert.deepEqual(raw.health, { ok: true, build_sha: sha });
assert.equal(deployRaw.receipt.id, evidence.staging_web.deploy_id);
assert.equal(deployRaw.receipt.commit.id, sha);
assert.equal(deployRaw.receipt.status, "live");
assert.equal(capturedDeploy.id, evidence.staging_web.deploy_id);
assert.equal(capturedDeploy.commit.id, sha);
assert.equal(capturedDeploy.status, "live");
assert.equal(capturedHealth.ok, true);
assert.equal(capturedHealth.build_sha, sha);
assert.equal(evidence.staging_web.deploy_status, "live");
assert.equal(evidence.staging_web.health_ok, true);
assert.equal(evidence.staging_web.health_build_sha, sha);
assert.equal(evidence.staging_web.database_query_executed, true);
assert.equal(evidence.staging_web.authenticated_db_query_candidate_absent, true);
assert.equal(evidence.staging_web.database_binding_sha256_directly_emitted, false);

assert.deepEqual(evidence.failed_probe_cleanup.failed_suffix_scripts_after, 0);
assert.deepEqual(evidence.failed_probe_cleanup.failed_suffix_jobs_after, 0);
assert.equal(evidence.failed_probe_cleanup.canonical_provider_tasks_after, 0);
const cleanupCheck = raw.events.find((item) => item.event === "JJ_MANAGED_READONLY_PASS");
assert.ok(cleanupCheck);
assert.equal(cleanupCheck.status, "succeeded");
assert.equal(cleanupCheck.failed_suffix_scripts, 0);
assert.equal(cleanupCheck.failed_suffix_jobs, 0);
assert.equal(cleanupCheck.canonical_provider_tasks, 0);

assert.equal(evidence.durability.create_process_status, "succeeded");
assert.equal(evidence.durability.readback_cleanup_process_status, "succeeded");
assert.equal(evidence.durability.new_process, true);
assert.equal(evidence.durability.new_pool, true);
assert.equal(evidence.durability.job_rows, 1);
assert.equal(evidence.durability.script_pointer_rows, 1);
assert.equal(evidence.durability.audit_rows, 1);
assert.equal(evidence.durability.ledger_rows, 0);
assert.equal(evidence.durability.cleanup, "PASS");
assert.equal(evidence.durability.provider_calls, 0);
assert.equal(evidence.durability.queue_writes, 0);
assert.deepEqual(evidence.durability.canonical_before, { scripts: 0, jobs: 0 });
assert.deepEqual(evidence.durability.canonical_after_create, evidence.durability.canonical_before);
assert.deepEqual(evidence.durability.canonical_after_cleanup, evidence.durability.canonical_before);
const create = raw.events.find((item) => item.event === "DURABILITY_CREATE_PASS");
const readback = raw.events.find((item) => item.event === "DURABILITY_READBACK_CLEANUP_PASS");
assert.ok(create && readback);
assert.equal(create.status, "succeeded");
assert.equal(readback.status, "succeeded");
assert.equal(create.job_id, readback.job_id);
assert.equal(create.binding_sha256, readback.binding_sha256);
assert.deepEqual(create.canonical_before, create.canonical_after);
assert.deepEqual(readback.canonical_before, readback.canonical_after);
assert.deepEqual(jobsRaw.receipts.map(({ id, status }) => ({ id, status })), [
  { id: evidence.durability.create_process_job_id, status: "succeeded" },
  { id: evidence.durability.readback_cleanup_process_job_id, status: "succeeded" },
]);
const capturedJobReceipts = new Map([...capturedWebJobs, ...capturedWorkerJobs].map((job) => [job.id, job]));
for (const jobId of [
  evidence.durability.create_process_job_id,
  evidence.durability.readback_cleanup_process_job_id,
  evidence.failed_probe_cleanup.verified_by_readonly_job_id,
  evidence.database_bindings.worker_one_off.job_id,
  evidence.staging_web.authenticated_db_query_job_id,
]) {
  assert.equal(capturedJobReceipts.get(jobId)?.status, "succeeded", `${jobId} status`);
}
const capturedMessages = new Map(logsRaw.events.map((item) => [item.resource, JSON.parse(item.message)]));
const providerLogMessages = new Map(capturedLogs
  .filter((item) => item.message.startsWith("{"))
  .map((item) => [item.labels.find((label) => label.name === "resource")?.value, JSON.parse(item.message)]));
const { render_job_id: createRenderJob, status: createStatus, ...createEvent } = create;
const { render_job_id: readbackRenderJob, status: readbackStatus, ...readbackEvent } = readback;
assert.equal(createRenderJob, evidence.durability.create_process_job_id);
assert.equal(readbackRenderJob, evidence.durability.readback_cleanup_process_job_id);
assert.equal(createStatus, "succeeded");
assert.equal(readbackStatus, "succeeded");
assert.deepEqual(capturedMessages.get(createRenderJob), createEvent);
assert.deepEqual(capturedMessages.get(readbackRenderJob), readbackEvent);
assert.deepEqual(providerLogMessages.get(createRenderJob), createEvent);
assert.deepEqual(providerLogMessages.get(readbackRenderJob), readbackEvent);

for (const runtime of [evidence.database_bindings.runner, evidence.database_bindings.worker_one_off]) {
  assert.equal(runtime.sha256, binding);
  assert.equal(runtime.database_name_present, true);
  assert.equal(runtime.server_version_present, true);
  assert.equal(runtime.system_identifier_present, true);
}
assert.equal(evidence.database_bindings.runner_worker_match, true);
assert.equal(evidence.database_bindings.contains_database_url_or_secret, false);
assert.equal(evidence.database_bindings.worker_one_off.persistent_service_suspended, true);
const worker = raw.events.find((item) => item.event === "WORKER_DB_BINDING_PASS");
const web = raw.events.find((item) => item.event === "WEB_DB_QUERY_ATTESTATION");
assert.ok(worker && web);
assert.equal(worker.status, "succeeded");
assert.equal(worker.binding_sha256, binding);
assert.equal(web.status, "succeeded");
assert.equal(web.caller_sha, sha);
assert.equal(web.http, 409);
assert.equal(web.web_candidate_absent, true);
assert.equal(web.secret_exposed, false);
assert.equal(capturedMessages.get(worker.render_job_id).binding_sha256, binding);
assert.equal(capturedMessages.get(web.render_job_id).web_candidate_absent, true);
assert.equal(providerLogMessages.get(worker.render_job_id).binding_sha256, binding);
assert.equal(providerLogMessages.get(web.render_job_id).web_candidate_absent, true);

assert.deepEqual(evidence.safety, {
  staging_only: true,
  production_mutation: false,
  persistent_worker_unsuspended: false,
  candidate_3_created: false,
  provider_post_count: 0,
  publication_count: 0,
});
assert.equal(evidence.historical_root_cause.actor_or_statement_identified, false);
assert.equal(evidence.historical_root_cause.retained_statement_log_available, false);
assert.equal(evidence.historical_root_cause.root_cause_identified, false);
assert.equal(evidence.historical_root_cause.final_attempt_safe, false);

console.log("MANAGED_DURABILITY_EVIDENCE=PASS");
console.log("REVIEWED_RUNTIME_SHA=" + sha);
console.log("DURABILITY_NEW_PROCESS_READBACK=PASS");
console.log("SCOPED_CLEANUP=PASS");
console.log("PROVIDER_POST_COUNT=0");
console.log("CANDIDATE_3_CREATED=NO");
console.log("RUNNER_WORKER_DB_BINDING_MATCH=PASS");
console.log("WEB_DB_BINDING_DIRECT_EXECUTION_PROOF=UNAVAILABLE");
console.log("ROOT_CAUSE_IDENTIFIED=NO");
console.log("FINAL_ATTEMPT_SAFE=NO");
