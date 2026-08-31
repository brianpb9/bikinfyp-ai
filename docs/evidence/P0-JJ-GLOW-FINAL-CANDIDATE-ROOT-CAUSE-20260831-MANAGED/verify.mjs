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
assert.ok(captureMetadata.captures.every((capture) => !capture.command.includes("select exact")), "capture commands must be literal/executable");
assert.match(captureMetadata.captures.find((capture) => capture.file === "CAPTURE-WEB-JOBS-SOURCE.json").command,
  /\.id==\"job-daahme4s728c738dpagg\"/);
assert.match(captureMetadata.captures.find((capture) => capture.file === "CAPTURE-WORKER-JOBS-SOURCE.json").command,
  /\.id==\"job-daahn19srm7s73f06i70\"/);
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
const capturedFinalDeploy = JSON.parse(captureBytes.get("CAPTURE-FINAL-DEPLOY-SOURCE.json"));
const capturedFinalWebJobs = JSON.parse(captureBytes.get("CAPTURE-FINAL-WEB-JOBS-SOURCE.json"));
const capturedFinalLogs = JSON.parse(captureBytes.get("CAPTURE-FINAL-LOGS-SOURCE.json"));
const capturedFinalHealth = JSON.parse(captureBytes.get("CAPTURE-FINAL-HEALTH-SOURCE.json"));
const durabilitySha = "630a0a1369522a2e17ac79b3eb136a4c3bc9e625";
const webSha = "146214a8675b07da55770de021639f481f717f06";
const binding = "6d8f03e28a15f4f6fe729387c6f8a7e94645853d6729fd3c908a636b1d47683c";

assert.equal(evidence.task, "P0-JJ-GLOW-FINAL-CANDIDATE-ROOT-CAUSE-20260831");
assert.equal(evidence.reviewed_runtime_sha, webSha);
assert.equal(evidence.durability.runtime_sha, durabilitySha);
assert.equal(raw.deploy.commit, durabilitySha);
assert.equal(raw.deploy.status, "live");
assert.deepEqual(raw.health, { ok: true, build_sha: durabilitySha });
assert.equal(deployRaw.receipt.id, "dep-daahkngn74is73b08ba0");
assert.equal(deployRaw.receipt.commit.id, durabilitySha);
assert.equal(deployRaw.receipt.status, "live");
assert.equal(capturedDeploy.id, "dep-daahkngn74is73b08ba0");
assert.equal(capturedDeploy.commit.id, durabilitySha);
assert.equal(capturedDeploy.status, "live");
assert.equal(capturedHealth.ok, true);
assert.equal(capturedHealth.build_sha, durabilitySha);
assert.equal(capturedFinalDeploy.id, evidence.staging_web.deploy_id);
assert.equal(capturedFinalDeploy.commit.id, webSha);
assert.equal(capturedFinalDeploy.status, "live");
assert.equal(capturedFinalHealth.ok, true);
assert.equal(capturedFinalHealth.build_sha, webSha);
assert.equal(evidence.staging_web.deploy_status, "live");
assert.equal(evidence.staging_web.health_ok, true);
assert.equal(evidence.staging_web.health_build_sha, webSha);
assert.equal(evidence.staging_web.database_query_executed, true);
assert.equal(evidence.staging_web.authenticated_db_query_candidate_absent, true);
assert.equal(evidence.staging_web.database_binding_sha256_directly_emitted, true);
assert.equal(evidence.staging_web.database_binding_sha256, binding);
assert.equal(evidence.staging_web.authenticated_db_query_http, 200);

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
]) {
  assert.equal(capturedJobReceipts.get(jobId)?.status, "succeeded", `${jobId} status`);
}
const allCapturedJobIds = [
  ...capturedWebJobs.map((job) => job.id),
  ...capturedWorkerJobs.map((job) => job.id),
  ...capturedFinalWebJobs.map((job) => job.id),
];
assert.equal(allCapturedJobIds.length, 7, "expected exact captured job set");
assert.equal(new Set(allCapturedJobIds).size, allCapturedJobIds.length, "all captured jobs must be distinct");
for (const job of capturedWebJobs) assert.equal(job.serviceId, "srv-d9n28tijnfac73a87lt0", `${job.id} web provenance`);
for (const job of capturedFinalWebJobs) assert.equal(job.serviceId, "srv-d9n28tijnfac73a87lt0", `${job.id} final web provenance`);
for (const job of capturedWorkerJobs) assert.equal(job.serviceId, "srv-d9n28ue417fc73ch2b60", `${job.id} worker provenance`);
const finalJobReceipts = new Map(capturedFinalWebJobs.map((job) => [job.id, job]));
assert.equal(finalJobReceipts.get(evidence.staging_web.authenticated_db_query_job_id)?.status, "succeeded");
assert.equal(finalJobReceipts.get(evidence.database_bindings.runner.job_id)?.status, "succeeded");
const capturedMessages = new Map(logsRaw.events.map((item) => [item.resource, JSON.parse(item.message)]));
const providerLogMessages = new Map(capturedLogs
  .filter((item) => item.message.startsWith("{"))
  .map((item) => [item.labels.find((label) => label.name === "resource")?.value, JSON.parse(item.message)]));
const finalProviderLogMessages = new Map(capturedFinalLogs
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

for (const runtime of [evidence.database_bindings.runner, evidence.database_bindings.web_process, evidence.database_bindings.worker_one_off]) {
  assert.equal(runtime.sha256, binding);
  assert.equal(runtime.database_name_present, true);
  assert.equal(runtime.server_version_present, true);
  assert.equal(runtime.system_identifier_present, true);
}
assert.equal(evidence.database_bindings.runner_web_worker_match, true);
assert.equal(evidence.database_bindings.contains_database_url_or_secret, false);
assert.equal(evidence.database_bindings.worker_one_off.persistent_service_suspended, true);
const worker = raw.events.find((item) => item.event === "WORKER_DB_BINDING_PASS");
const web = raw.events.find((item) => item.event === "WEB_DB_QUERY_ATTESTATION");
assert.ok(worker && web);
assert.equal(worker.status, "succeeded");
assert.equal(worker.binding_sha256, binding);
assert.equal(web.status, "succeeded");
assert.equal(web.caller_sha, durabilitySha);
assert.equal(web.http, 409);
assert.equal(web.web_candidate_absent, true);
assert.equal(web.secret_exposed, false);
assert.equal(capturedMessages.get(worker.render_job_id).binding_sha256, binding);
assert.equal(capturedMessages.get(web.render_job_id).web_candidate_absent, true);
assert.equal(providerLogMessages.get(worker.render_job_id).binding_sha256, binding);
assert.equal(providerLogMessages.get(web.render_job_id).web_candidate_absent, true);
const directWeb = finalProviderLogMessages.get(evidence.staging_web.authenticated_db_query_job_id);
const finalRunner = finalProviderLogMessages.get(evidence.database_bindings.runner.job_id);
assert.equal(directWeb.event, "WEB_DB_BINDING_DIRECT_PASS");
assert.equal(directWeb.caller_sha, webSha);
assert.equal(directWeb.http, 200);
assert.equal(directWeb.response.deployed_sha, webSha);
assert.equal(directWeb.response.candidate_present, false);
assert.equal(directWeb.response.candidate_row_count, 0);
assert.equal(directWeb.response.runtime, "live-web-pool-read-only");
assert.equal(directWeb.response.database_binding.sha256, binding);
assert.equal(directWeb.response.database_binding.database_name_present, true);
assert.equal(directWeb.response.database_binding.server_version_present, true);
assert.equal(directWeb.response.database_binding.system_identifier_present, true);
assert.equal(directWeb.provider_calls, 0);
assert.equal(directWeb.queue_writes, 0);
assert.equal(directWeb.mutation, false);
assert.equal(finalRunner.event, "FINAL_RUNNER_BINDING_COUNT_PASS");
assert.equal(finalRunner.deploy_sha, webSha);
assert.equal(finalRunner.binding_sha256, binding);
assert.equal(finalRunner.canonical_scripts, 0);
assert.equal(finalRunner.canonical_jobs, 0);
assert.equal(finalRunner.canonical_provider_tasks, 0);
assert.equal(finalRunner.provider_calls, 0);
assert.equal(finalRunner.queue_writes, 0);
assert.equal(finalRunner.mutation, false);
assert.equal(evidence.database_bindings.runner.sha256, directWeb.response.database_binding.sha256);
assert.equal(evidence.database_bindings.worker_one_off.sha256, directWeb.response.database_binding.sha256);

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
console.log("REVIEWED_RUNTIME_SHA=" + webSha);
console.log("DURABILITY_NEW_PROCESS_READBACK=PASS");
console.log("SCOPED_CLEANUP=PASS");
console.log("PROVIDER_POST_COUNT=0");
console.log("CANDIDATE_3_CREATED=NO");
console.log("RUNNER_WEB_WORKER_DB_BINDING_MATCH=PASS");
console.log("WEB_DB_BINDING_DIRECT_EXECUTION_PROOF=PASS");
console.log("ROOT_CAUSE_IDENTIFIED=NO");
console.log("FINAL_ATTEMPT_SAFE=NO");
