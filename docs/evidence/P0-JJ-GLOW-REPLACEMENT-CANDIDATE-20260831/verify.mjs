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

assert.equal(sha(authorityBytes), "71920b7bb408718db873d3a8d07c3063bca6fe6f4f8f24f7141ede2b93c78192");
assert.equal(authority.task, "P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831");
assert.match(authority.body, /MAX_CANONICAL_CANDIDATES_CREATED=2/);
assert.match(authority.body, /ONE_REPLACEMENT_CANDIDATE_ONLY=YES/);
assert.equal(incident.historical_candidate_loss_receipt.status, "PASS");
assert.equal(incident.historical_candidate_loss_receipt.exact_evidence_sha, "84a1221356502273907de34fcc6fb503a4fe8df3");

assert.equal(sha(Buffer.from(jobs.capture.query)), jobs.capture.query_sha256);
assert.equal(jobs.capture.pagination_flags_available, false);
assert.equal(jobs.capture.raw_response_count, 20);
assert.equal(jobs.capture.raw_response_sha256, "a24a35542dd71ce805caeb9302a76f17420f35c4bcbf95b0a57031bcb2cee5d5");
assert.ok(Date.parse(jobs.capture.captured_at) > Date.parse(jobs.authorized_window.end_inclusive));
assert.ok(Date.parse(jobs.capture.oldest_returned_at) < Date.parse(jobs.authorized_window.start_inclusive));
assert.ok(Date.parse(jobs.capture.newest_returned_at) <= Date.parse(jobs.authorized_window.end_inclusive));
assert.equal(sha(Buffer.from(JSON.stringify(canonical(jobs.jobs)))), jobs.authorized_window.response_sha256);
assert.equal(jobs.jobs.length, 12);
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
assert.equal(deploy.service_id, "srv-d9n28tijnfac73a87lt0");
assert.equal(deploy.live_deploy.id, "dep-daad38e7bikc7383gc6g");
assert.equal(deploy.live_deploy.status, "live");
assert.equal(deploy.live_deploy.commit_sha, "952276cae06be50b124894f611c85a8bce218d9d");
assert.equal(pg.job.id, "job-daagflijnfac738fht2g");
assert.equal(pg.job.service_id, deploy.service_id);
assert.equal(pg.deployed_identity.service_id, deploy.service_id);
assert.equal(pg.deployed_identity.deploy_id, deploy.live_deploy.id);
assert.equal(pg.deployed_identity.deployed_sha, deploy.live_deploy.commit_sha);
const executedCommand = Buffer.from(pg.executed_start_command_base64, "base64");
assert.equal(sha(executedCommand), pg.executed_start_command_sha256);
const commandText = executedCommand.toString("utf8");
assert.match(commandText, /BEGIN READ ONLY/);
assert.match(commandText, new RegExp(pg.target.product_id));
assert.match(commandText, new RegExp(pg.target.script_id));
assert.match(commandText, new RegExp(pg.target.principal_id));
assert.match(commandText, /JJ_DB_READBACK/);
const emittedPrefix = "JJ_DB_READBACK ";
assert.ok(pg.exact_emitted_log_line.startsWith(emittedPrefix));
const emittedPayload = JSON.parse(pg.exact_emitted_log_line.slice(emittedPrefix.length));
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
