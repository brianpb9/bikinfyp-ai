import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const dir = new URL("./", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, dir));
const json = (name) => JSON.parse(read(name));
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const metadata = json("capture-metadata.json");
const evidence = json("managed-evidence.json");
for (const capture of metadata.captures) {
  const bytes = read(capture.file);
  assert.equal(bytes.length, capture.bytes, `${capture.file} byte count`);
  assert.equal(digest(bytes), capture.sha256, `${capture.file} digest`);
  assert.ok(!capture.command.includes("select exact"), `${capture.file} command must be executable`);
}

const deploys = json("CAPTURE-DEPLOYS-SOURCE.json");
const jobs = json("CAPTURE-JOBS-SOURCE.json");
const logs = json("CAPTURE-LOGS-SOURCE.json");
const health = json("CAPTURE-HEALTH-SOURCE.json");
const services = json("CAPTURE-SERVICES-SOURCE.json");
const webService = "srv-d9n28tijnfac73a87lt0";
const workerService = "srv-d9n28ue417fc73ch2b60";
const exactSha = evidence.reviewed_runtime_sha;
const deploy = deploys.find((item) => item.id === evidence.deploy_id);
assert.equal(deploy.status, "live");
assert.equal(deploy.commit.id, exactSha);
assert.equal(health.ok, true);
assert.equal(health.build_sha, exactSha);
assert.equal(services.find((item) => item.id === webService)?.suspended, "not_suspended");
assert.equal(services.find((item) => item.id === workerService)?.suspended, "suspended");

const expectedManagedJobs = [evidence.admission_job_id, evidence.fresh_post_exit_job_id, evidence.independent_reviewer_job_id];
assert.equal(new Set(expectedManagedJobs).size, 3);
for (const id of expectedManagedJobs) {
  const job = jobs.find((item) => item.id === id);
  assert.equal(job?.status, "succeeded", `${id} status`);
  assert.equal(job?.serviceId, webService, `${id} service`);
}
const eventFor = (resource) => {
  const row = logs.find((item) => item.labels.some((label) => label.name === "resource" && label.value === resource));
  assert.ok(row, `${resource} log missing`);
  return JSON.parse(row.message);
};
const admission = eventFor(evidence.admission_job_id);
const postExit = eventFor(evidence.fresh_post_exit_job_id);
const reviewer = eventFor(evidence.independent_reviewer_job_id);
assert.equal(admission.event, "JJ_GLOW_CANDIDATE_PASS");
assert.equal(admission.job_id, evidence.candidate.job_id);
assert.equal(admission.lifecycle_correlation_id, evidence.candidate.correlation_id);
assert.equal(admission.post_commit_state_sha256, evidence.candidate.state_sha256);
assert.equal(admission.transaction_commit_receipt.transaction_id, evidence.candidate.transaction_id);
assert.equal(admission.transaction_commit_receipt.atomic_with_job, true);
assert.equal(admission.transaction_commit_receipt.visible_only_after_commit, true);
assert.equal(admission.same_process_readback, true);

assert.equal(postExit.event, "JJ_GLOW_POST_EXIT_READBACK_PASS");
assert.equal(postExit.job_id, evidence.candidate.job_id);
assert.equal(postExit.lifecycle_correlation_id, evidence.candidate.correlation_id);
assert.equal(postExit.post_commit_state_sha256, evidence.candidate.state_sha256);
assert.equal(postExit.database_binding_sha256, evidence.candidate.database_binding_sha256);
assert.equal(postExit.new_process, true);
assert.equal(postExit.new_pool, true);
assert.equal(postExit.fresh_connection, true);
for (const field of ["provider_tasks","provider_posts","outputs","fyp_posted","post_plans"]) assert.equal(postExit[field], 0, `post-exit ${field}`);
assert.equal(postExit.publication, false);

assert.equal(reviewer.event, "INDEPENDENT_REVIEWER_ZERO_SURFACE_READBACK_PASS");
assert.equal(reviewer.reviewed_sha, exactSha);
assert.equal(reviewer.receipt_payload_sha256, evidence.independent_reviewer.receipt_payload_sha256);
assert.equal(reviewer.job_id, evidence.candidate.job_id);
assert.equal(reviewer.correlation_id, evidence.candidate.correlation_id);
assert.equal(reviewer.state_sha256, evidence.candidate.state_sha256);
assert.equal(reviewer.database_binding_sha256, evidence.candidate.database_binding_sha256);
for (const field of ["provider_tasks","provider_posts","outputs","fyp_posted","post_plans","terminal_ledger_count"]) assert.equal(reviewer[field], 0, `reviewer ${field}`);
assert.equal(reviewer.candidate_count, 1);
assert.equal(reviewer.script_count, 1);
assert.equal(reviewer.hold_count, 1);
assert.equal(reviewer.publication, false);
assert.equal(reviewer.mutation, false);
assert.equal(evidence.candidate_replay_count, 0);
assert.equal(evidence.provider_call_count, 0);
assert.equal(evidence.metadata_mutation, false);
assert.equal(evidence.production_mutation, false);
assert.equal(evidence.public_payment_mutation, false);

console.log("FINAL_RECOVERY_CANDIDATE_EVIDENCE=PASS");
console.log(`REVIEWED_RUNTIME_SHA=${exactSha}`);
console.log("CANDIDATE_COUNT=1");
console.log("FRESH_POST_EXIT_ZERO_SURFACES=PASS");
console.log("INDEPENDENT_REVIEWER_ZERO_SURFACES=PASS");
console.log("PROVIDER_POST_COUNT=0");
console.log("METADATA_MUTATION=NO");
