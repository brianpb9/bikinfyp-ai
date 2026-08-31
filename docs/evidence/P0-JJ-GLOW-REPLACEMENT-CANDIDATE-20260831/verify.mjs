import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;

const authorityBytes = fs.readFileSync(path.join(dir, "RAW-AUTHORITY.json"));
const authority = JSON.parse(authorityBytes);
const incident = readJson("INCIDENT.json");
const pg = readJson("RAW-POSTGRES.json");
const lineage = readJson("RAW-LINEAGE-ENDPOINT.json");
const worker = readJson("RAW-WORKER.json");
const jobs = readJson("RAW-RENDER-JOBS.json");
const deploy = readJson("RAW-DEPLOY.json");
const rawJobsBytes = fs.readFileSync(path.join(dir, jobs.capture.raw_response_file));
const rawJobs = JSON.parse(rawJobsBytes);
const rawLogBytes = fs.readFileSync(path.join(dir, pg.raw_log_response_file));
const rawLog = JSON.parse(rawLogBytes);
const rawDeployBytes = fs.readFileSync(path.join(dir, deploy.raw_response_file));
const rawDeploys = JSON.parse(rawDeployBytes);

assert.equal(sha(authorityBytes), "71920b7bb408718db873d3a8d07c3063bca6fe6f4f8f24f7141ede2b93c78192");
assert.equal(authority.task, "P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831");
assert.match(authority.body, /MAX_CANONICAL_CANDIDATES_CREATED=2/);
assert.match(authority.body, /ONE_REPLACEMENT_CANDIDATE_ONLY=YES/);
assert.equal(incident.historical_candidate_loss_receipt.status, "PASS");
assert.equal(incident.historical_candidate_loss_receipt.exact_evidence_sha, "84a1221356502273907de34fcc6fb503a4fe8df3");

assert.equal(sha(Buffer.from(jobs.capture.query)), jobs.capture.query_sha256);
assert.equal(jobs.capture.pagination_flags_available, false);
assert.equal(sha(rawJobsBytes), jobs.capture.raw_response_sha256);
assert.equal(rawJobs.length, jobs.capture.raw_response_count);
assert.equal(rawJobs.length, 20);
assert.equal(new Set(rawJobs.map((job) => job.id)).size, rawJobs.length);
for (let index = 1; index < rawJobs.length; index += 1) {
  assert.ok(Date.parse(rawJobs[index - 1].createdAt) >= Date.parse(rawJobs[index].createdAt));
}
assert.equal(rawJobs[0].createdAt, jobs.capture.newest_returned_at);
assert.equal(rawJobs.at(-1).createdAt, jobs.capture.oldest_returned_at);
assert.ok(Date.parse(jobs.capture.captured_at) > Date.parse(jobs.authorized_window.end_inclusive));
assert.ok(Date.parse(jobs.capture.oldest_returned_at) < Date.parse(jobs.authorized_window.start_inclusive));
assert.ok(Date.parse(jobs.capture.newest_returned_at) <= Date.parse(jobs.authorized_window.end_inclusive));
const rawWindow = rawJobs.filter((job) => Date.parse(job.createdAt) >= Date.parse(jobs.authorized_window.start_inclusive)
  && Date.parse(job.createdAt) <= Date.parse(jobs.authorized_window.end_inclusive));
const normalizedWindow = rawWindow.map((job) => ({
  id: job.id,
  service_id: job.serviceId,
  status: job.status,
  created_at: job.createdAt,
  started_at: job.startedAt,
  finished_at: job.finishedAt,
  start_command_sha256: sha(Buffer.from(job.startCommand)),
}));
assert.deepEqual(normalizedWindow, jobs.jobs);
assert.equal(sha(Buffer.from(JSON.stringify(canonical(jobs.jobs)))), jobs.authorized_window.response_sha256);
assert.equal(rawWindow.length, 12);
for (const job of jobs.jobs) {
  assert.equal(job.service_id, "srv-d9n28tijnfac73a87lt0");
  assert.ok(Date.parse(job.created_at) >= Date.parse(jobs.authorized_window.start_inclusive));
  assert.ok(Date.parse(job.created_at) <= Date.parse(jobs.authorized_window.end_inclusive));
  assert.match(job.start_command_sha256, /^[0-9a-f]{64}$/);
}
assert.equal(sha(fs.readFileSync(path.join(dir, "../../../scripts/staging-jj-glow-candidate.cjs"))), jobs.canonical_admission_signature.candidate_runner_sha256);
assert.equal(sha(fs.readFileSync(path.join(dir, "../BPOM-KO-NA18260500350-20260831.json"))), jobs.canonical_admission_signature.bpom_evidence_sha256);
const matchingAdmissions = jobs.jobs.filter((job) => job.start_command_sha256 === jobs.canonical_admission_signature.exact_start_command_sha256);
assert.equal(matchingAdmissions.length, 1);
const [admission] = matchingAdmissions;
const rawMatchingAdmissions = rawWindow.filter((job) => sha(Buffer.from(job.startCommand)) === jobs.canonical_admission_signature.exact_start_command_sha256);
assert.equal(rawMatchingAdmissions.length, 1);
assert.equal(rawMatchingAdmissions[0].id, admission.id);
assert.equal(admission.id, "job-daagcs9f2nfc73a8gsp0");
assert.equal(admission.status, "succeeded");
assert.equal(admission.started_at, "2026-08-31T04:43:29Z");
assert.equal(admission.finished_at, "2026-08-31T04:43:57Z");
assert.deepEqual(jobs.actual_control_plane_completion_record, {
  id: admission.id,
  plan_id: "plan-srv-006",
  service_id: admission.service_id,
  status: admission.status,
  created_at: admission.created_at,
  started_at: admission.started_at,
  finished_at: admission.finished_at,
  start_command_sha256: admission.start_command_sha256,
});
assert.equal(jobs.application_completion_log_query.entry_count, 0);
assert.equal(jobs.application_completion_log_query.raw_response_sha256, sha(Buffer.alloc(0)));
assert.match(jobs.application_completion_log_query.query, new RegExp(admission.id));
assert.match(jobs.application_completion_log_query.interpretation, /ambiguity/);
assert.equal(incident.replacement_attempt.attempt_count, 1);
assert.equal(incident.replacement_attempt.replay_performed, false);

assert.equal(lineage.http_status, 409);
assert.match(lineage.matching_web_log, /sole exact candidate required/);
assert.equal(sha(Buffer.from(deploy.query)), deploy.query_sha256);
assert.match(deploy.query, new RegExp(deploy.service_id));
assert.equal(sha(rawDeployBytes), deploy.raw_response_sha256);
assert.equal(rawDeploys.length, 20);
const rawLiveDeploys = rawDeploys.filter((item) => item.status === "live");
assert.equal(rawLiveDeploys.length, 1);
const [rawLiveDeploy] = rawLiveDeploys;
assert.equal(deploy.service_id, "srv-d9n28tijnfac73a87lt0");
assert.equal(rawLiveDeploy.id, deploy.live_deploy.id);
assert.equal(rawLiveDeploy.status, deploy.live_deploy.status);
assert.equal(rawLiveDeploy.commit.id, deploy.live_deploy.commit_sha);
assert.ok(Date.parse(rawLiveDeploy.finishedAt) < Date.parse(pg.job.created_at));
assert.equal(rawDeploys[0].id, rawLiveDeploy.id);
assert.equal(pg.job.id, "job-daagflijnfac738fht2g");
assert.equal(pg.job.service_id, deploy.service_id);
assert.equal(pg.deployed_identity.service_id, deploy.service_id);
assert.equal(pg.deployed_identity.deploy_id, deploy.live_deploy.id);
assert.equal(pg.deployed_identity.deployed_sha, deploy.live_deploy.commit_sha);
const executedCommand = Buffer.from(pg.executed_start_command_base64, "base64");
assert.equal(sha(executedCommand), pg.executed_start_command_sha256);
const rawPgJobs = rawJobs.filter((job) => job.id === pg.job.id);
assert.equal(rawPgJobs.length, 1);
const [rawPgJob] = rawPgJobs;
assert.equal(rawPgJob.serviceId, pg.job.service_id);
assert.equal(rawPgJob.status, pg.job.status);
assert.equal(rawPgJob.startedAt, pg.job.started_at);
assert.equal(rawPgJob.finishedAt, pg.job.finished_at);
assert.equal(sha(Buffer.from(rawPgJob.startCommand)), pg.executed_start_command_sha256);
assert.equal(rawPgJob.startCommand, executedCommand.toString("utf8"));
const commandText = executedCommand.toString("utf8");
assert.match(commandText, /BEGIN READ ONLY/);
assert.match(commandText, new RegExp(pg.target.product_id));
assert.match(commandText, new RegExp(pg.target.script_id));
assert.match(commandText, new RegExp(pg.target.principal_id));
assert.match(commandText, /JJ_DB_READBACK/);
const emittedPrefix = "JJ_DB_READBACK ";
assert.equal(sha(Buffer.from(pg.raw_log_query)), pg.raw_log_query_sha256);
assert.match(pg.raw_log_query, new RegExp(pg.job.id));
assert.equal(sha(rawLogBytes), pg.raw_log_response_sha256);
assert.equal(rawLog.labels.filter((label) => label.name === "resource" && label.value === pg.job.id).length, 1);
assert.equal(rawLog.labels.filter((label) => label.name === "type" && label.value === "app").length, 1);
assert.equal(rawLog.message, pg.exact_emitted_log_line);
assert.ok(rawLog.message.startsWith(emittedPrefix));
assert.ok(Date.parse(rawLog.timestamp) >= Date.parse(pg.job.started_at));
assert.ok(Date.parse(rawLog.timestamp) <= Date.parse(pg.job.finished_at));
const emittedPayload = JSON.parse(rawLog.message.slice(emittedPrefix.length));
assert.deepEqual(emittedPayload, pg.parsed_emitted_payload);
assert.equal(pg.transaction, "BEGIN READ ONLY");
assert.deepEqual(emittedPayload.rows, []);
assert.deepEqual(emittedPayload.totals, { scripts: 0, jobs: 0, provider_tasks: 0 });
assert.equal(emittedPayload.mutation, false);
assert.equal(worker.suspended, "suspended");
assert.deepEqual(worker.suspenders, ["user"]);

assert.equal(incident.current_state.replacement_candidate_created, "UNPROVEN");
assert.equal(incident.current_state.current_eligible_candidate_count, 0);
assert.equal(incident.current_state.provider_post_count, 0);
assert.equal(incident.current_state.publication_count, 0);
assert.equal(incident.current_state.production_mutation_count, 0);
assert.equal(incident.current_state.real_money_mutation_count, 0);
assert.equal(incident.decision.result, "FOUNDER_DECISION_REQUIRED");
assert.equal(incident.decision.candidate_replay, "PROHIBITED_WITHOUT_NEW_EXPLICIT_AUTHORITY");
assert.equal(incident.decision.provider_post, "PROHIBITED");

console.log("HISTORICAL_CANDIDATE_LOSS_RECEIPT=PASS");
console.log("REPLACEMENT_ADMISSION_ATTEMPT_COUNT=1");
console.log("REPLACEMENT_CANDIDATE_CREATED=UNPROVEN");
console.log("CURRENT_ELIGIBLE_CANDIDATE_COUNT=0");
console.log("PROVIDER_POST_COUNT=0");
console.log("FOUNDER_DECISION_REQUIRED=PASS");
