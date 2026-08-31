import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const contract = JSON.parse(read("PRE-CREATION-CONTRACT.json"));
const creationRaw = read("POST-CREATION-RECEIPT.json");
const postExitRaw = read("POST-EXIT-READBACK.json");
const stateRaw = read("INDEPENDENT-STATE-READBACK.json");
const creation = JSON.parse(creationRaw), postExit = JSON.parse(postExitRaw), state = JSON.parse(stateRaw);
const admission = read("../../../lib/staging-jj-glow-exact-admission.ts");
const runner = read("../../../scripts/staging-jj-glow-candidate.cjs");
const freeze = read("../../../scripts/staging-jj-glow-final-evidence.ts");
const provider = read("../../../lib/providers/normal-evidence.ts");
const stateReadback = read("../../../scripts/staging-jj-glow-candidate4-state-readback.cjs");

assert.equal(contract.task, "FINAL-POST-SWEEP-CANDIDATE-4-20260901");
assert.equal(contract.candidate_ordinal, 4);
assert.equal(contract.max_canonical_candidates_created, 4);
assert.equal(contract.candidate_5_authorized, false);
assert.equal(contract.lease_kind, "ACTIVE_EVIDENCE_LEASE");
assert.equal(contract.lease_ttl_seconds, 21600);
assert.equal(sha256(creationRaw), "99a6239ec7fc9e429263f0fe926c92fb58a0b7f247b1d2ce8c0c8cea91a068d1");
assert.equal(sha256(postExitRaw), "fb771557e7bf903000c03b1d1f292c6dfac3c551664f64ad99e4219bd38d2f13");
assert.equal(sha256(stateRaw), "a6be0c28c39e11975423dfb0e19ba28d2bb565c9e43b33355019a7109df4e4bf");
const jobId = "2c49a5c8-9465-4400-a214-159336a2c097";
const correlation = "84e77d2f-6da7-4bb3-a56f-a59aa25cea5a";
const stateSha = "097177242cec9cf35e9875d2f8dcce148944003790bec4e497f934a497024306";
const bindingSha = "f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610";
assert.deepEqual([creation.job_id,postExit.job_id,state.candidate4.job_id],[jobId,jobId,jobId]);
assert.deepEqual([creation.lifecycle_correlation_id,postExit.lifecycle_correlation_id,state.candidate4.lifecycle_correlation_id],
  [correlation,correlation,correlation]);
assert.deepEqual([creation.post_commit_state_sha256,postExit.post_commit_state_sha256,state.candidate4.post_commit_state_sha256],
  [stateSha,stateSha,stateSha]);
assert.equal(postExit.database_binding_sha256,bindingSha);
assert.equal(state.database_binding_sha256,bindingSha);
assert.equal(creation.render_job_status,"succeeded");
assert.equal(postExit.render_job_status,"succeeded");
assert.equal(state.render_job_status,"succeeded");
assert.equal(state.product_job_count,2);assert.equal(state.product_script_count,2);
assert.equal(state.predecessor_job_count,1);assert.equal(state.candidate4_job_count,1);assert.equal(state.candidate4_script_count,1);
assert.equal(state.candidate5_authorized,false);assert.equal(state.candidate5_present,false);
assert.deepEqual({state:state.predecessor.state,provider_tasks:state.predecessor.provider_tasks,
  provider_posts:state.predecessor.provider_posts,outputs:state.predecessor.outputs,publication:state.predecessor.publication,
  holds:state.predecessor.holds,releases:state.predecessor.releases,captures:state.predecessor.captures},
{state:"REFUNDED",provider_tasks:0,provider_posts:0,outputs:0,publication:false,holds:1,releases:1,captures:0});
assert.deepEqual({state:state.candidate4.state,provider_tasks:state.candidate4.provider_tasks,
  provider_posts:state.candidate4.provider_posts,outputs:state.candidate4.outputs,publication:state.candidate4.publication,
  holds:state.candidate4.holds,releases:state.candidate4.releases,captures:state.candidate4.captures,evidence_rows:state.candidate4.evidence_rows},
{state:"QUEUED",provider_tasks:0,provider_posts:0,outputs:0,publication:false,holds:1,releases:0,captures:0,evidence_rows:0});
assert.equal(state.read_only,true);assert.equal(state.new_process,true);assert.equal(state.fresh_connection,true);
assert.match(admission, /candidate4Authority[\s\S]*final_candidate_ordinal === 4[\s\S]*max_canonical_candidates_created === 4/);
assert.match(runner, /JJ_GLOW_CANDIDATE_4_AUTHORITY_REQUIRED/);
assert.match(runner, /candidate #4 historical preflight invariant mismatch/);
assert.match(runner, /prior\[0\]\.state !== "REFUNDED"/);
assert.match(runner, /prior\[0\]\.candidate4_scripts !== 0/);
assert.match(runner, /const expectedTotal = CANDIDATE_4_MODE \? 2 : 1/);
assert.match(freeze, /JJ_GLOW_EVIDENCE_CANDIDATE_ORDINAL === "4"/);
assert.match(freeze, /normalEvidenceLeaseWindow\(now\)/);
assert.match(freeze, /assertJjGlowCandidate4PredecessorInvariant\(predecessor\)/);
assert.match(freeze, /FROM jobs j WHERE j\.id=\$1\$\{suffix\}/);
assert.match(provider, /JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK/);
assert.match(stateReadback, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
assert.match(stateReadback, /candidate5_present:false/);
console.log("CANDIDATE_4_POST_CREATION_PRE_ACTIVATION_CONTRACT=PASS");
