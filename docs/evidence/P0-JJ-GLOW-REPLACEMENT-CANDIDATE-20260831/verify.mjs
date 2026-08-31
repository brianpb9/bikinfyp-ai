import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

const authorityBytes = fs.readFileSync(path.join(dir, "RAW-AUTHORITY.json"));
const authority = JSON.parse(authorityBytes);
const incident = readJson("INCIDENT.json");
const pg = readJson("RAW-POSTGRES.json");
const lineage = readJson("RAW-LINEAGE-ENDPOINT.json");
const worker = readJson("RAW-WORKER.json");
const jobs = readJson("RAW-RENDER-JOBS.json");

assert.equal(sha(authorityBytes), "71920b7bb408718db873d3a8d07c3063bca6fe6f4f8f24f7141ede2b93c78192");
assert.equal(authority.task, "P0-JJ-GLOW-REPLACEMENT-CANDIDATE-20260831");
assert.match(authority.body, /MAX_CANONICAL_CANDIDATES_CREATED=2/);
assert.match(authority.body, /ONE_REPLACEMENT_CANDIDATE_ONLY=YES/);
assert.equal(incident.historical_candidate_loss_receipt.status, "PASS");
assert.equal(incident.historical_candidate_loss_receipt.exact_evidence_sha, "84a1221356502273907de34fcc6fb503a4fe8df3");

const admission = jobs.jobs.find((job) => job.purpose === "sole_authorized_replacement_admission_attempt");
assert.equal(admission.id, "job-daagcs9f2nfc73a8gsp0");
assert.equal(admission.status, "succeeded");
assert.equal(admission.candidate_runner_sha256, "d564430920b06b0195b4411ab6c1fa00361dbc4055726ec72b8bb212271406ac");
assert.equal(incident.replacement_attempt.attempt_count, 1);
assert.equal(incident.replacement_attempt.replay_performed, false);

assert.equal(lineage.http_status, 409);
assert.match(lineage.matching_web_log, /sole exact candidate required/);
assert.equal(pg.transaction, "BEGIN READ ONLY");
assert.deepEqual(pg.rows, []);
assert.deepEqual(pg.totals, { scripts: 0, jobs: 0, provider_tasks: 0 });
assert.equal(pg.mutation, false);
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
