import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const contract = JSON.parse(read("PRE-CREATION-CONTRACT.json"));
const creationRaw = read("POST-CREATION-RECEIPT.json");
const postExitRaw = read("POST-EXIT-READBACK.json");
const stateRaw = read("INDEPENDENT-STATE-READBACK.json");
const managedJobRaw = read("MANAGED-READBACK-JOB-RAW.json");
const managedLogRaw = read("MANAGED-READBACK-LOG-RAW.json");
const scriptDigestJobRaw = read("SCRIPT-DIGEST-MANAGED-JOB-RAW.json");
const scriptDigestLogRaw = read("SCRIPT-DIGEST-MANAGED-LOG-RAW.json");
const creation = JSON.parse(creationRaw), postExit = JSON.parse(postExitRaw), state = JSON.parse(stateRaw);
const managedJob = JSON.parse(managedJobRaw), managedLog = JSON.parse(managedLogRaw);
const scriptDigestJob = JSON.parse(scriptDigestJobRaw), scriptDigestLog = JSON.parse(scriptDigestLogRaw);
const admission = read("../../../lib/staging-jj-glow-exact-admission.ts");
const runner = read("../../../scripts/staging-jj-glow-candidate.cjs");
const freeze = read("../../../scripts/staging-jj-glow-final-evidence.ts");
const provider = read("../../../lib/providers/normal-evidence.ts");
const stateReadback = read("../../../scripts/staging-jj-glow-candidate4-state-readback.cjs");
const scriptDigestReadback = read("../../../scripts/staging-jj-glow-candidate4-script-digest-readback.cjs");
const migration0046 = read("../../../migrations/postgres/0046_jj_glow_candidate4_exact_evidence_format.sql");
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const deterministicDigest = (value) => sha256(canonical(value));

assert.equal(contract.task, "FINAL-POST-SWEEP-CANDIDATE-4-20260901");
assert.equal(contract.candidate_ordinal, 4);
assert.equal(contract.max_canonical_candidates_created, 4);
assert.equal(contract.candidate_5_authorized, false);
assert.equal(contract.lease_kind, "ACTIVE_EVIDENCE_LEASE");
assert.equal(contract.lease_ttl_seconds, 21600);
assert.equal(sha256(creationRaw), "99a6239ec7fc9e429263f0fe926c92fb58a0b7f247b1d2ce8c0c8cea91a068d1");
assert.equal(sha256(postExitRaw), "fb771557e7bf903000c03b1d1f292c6dfac3c551664f64ad99e4219bd38d2f13");
assert.equal(sha256(stateRaw), "a6be0c28c39e11975423dfb0e19ba28d2bb565c9e43b33355019a7109df4e4bf");
assert.equal(sha256(managedJobRaw), "49e452f92b5113acd4ddd79910a2b3c0b49bf65941f8d627d2488d24b702ea54");
assert.equal(sha256(managedLogRaw), "e2dfbe0d4becf9ea1d44f5d6dd666c89d5ba46a140867625611c0c76bba4d959");
assert.equal(sha256(scriptDigestJobRaw), "a942d42ef97ad4471608157cfc055a13638d1a7b5bd26b0e56cb50bb84f4c85e");
assert.equal(sha256(scriptDigestLogRaw), "84736c3378762f1c91d78c9be75e98e1f30cdc468bbf08c060b5bf2013243248");
assert.equal(sha256(scriptDigestReadback), "bfba4320b65caeaf5be4de5e5f3c782b7c7f8991dada4cf1fcc650294810d663");
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
assert.equal(managedJob.id,state.render_job_id);
assert.equal(managedJob.serviceId,"srv-d9n28tijnfac73a87lt0");
assert.equal(managedJob.status,state.render_job_status);
assert.equal(managedJob.planId,"plan-srv-006");
assert.ok(Date.parse(managedJob.startedAt) <= Date.parse(managedJob.finishedAt));
const encodedSource = managedJob.startCommand.match(/eval\(Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)\.toString\(\)\)"$/)?.[1];
assert.ok(encodedSource,"managed command must carry the archived readback source");
assert.equal(Buffer.from(encodedSource,"base64").toString("utf8"),stateReadback,
  "the source executed by the old runtime must exactly equal the reviewed archived source");
assert.equal(managedLog.labels.find(({name}) => name === "resource")?.value,managedJob.id);
assert.equal(managedLog.labels.find(({name}) => name === "level")?.value,"info");
assert.equal(managedLog.labels.find(({name}) => name === "type")?.value,"app");
assert.ok(Date.parse(managedLog.timestamp) >= Date.parse(managedJob.startedAt));
assert.ok(Date.parse(managedLog.timestamp) <= Date.parse(managedJob.finishedAt));
const managedMessage = JSON.parse(managedLog.message);
assert.equal(managedMessage.runtime_sha,"588567c809326736bb316ce74df90a5feb9b9875");
assert.equal(managedMessage.event,state.event);
assert.equal(managedMessage.task,state.task);
assert.deepEqual(managedMessage,Object.fromEntries(Object.entries(state)
  .filter(([key]) => !["render_job_id","render_job_status"].includes(key))));
assert.equal(scriptDigestJob.id,"job-daauhlqfngtc73afltj0");
assert.equal(scriptDigestJob.serviceId,"srv-d9n28tijnfac73a87lt0");
assert.equal(scriptDigestJob.planId,"plan-srv-006");
assert.equal(scriptDigestJob.status,"succeeded");
assert.ok(Date.parse(scriptDigestJob.startedAt) <= Date.parse(scriptDigestJob.finishedAt));
const scriptDigestEncodedSource = scriptDigestJob.startCommand.match(/eval\(Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)\.toString\(\)\)"$/)?.[1];
assert.ok(scriptDigestEncodedSource);
assert.equal(Buffer.from(scriptDigestEncodedSource,"base64").toString("utf8"),scriptDigestReadback);
assert.equal(scriptDigestLog.labels.find(({name}) => name === "resource")?.value,scriptDigestJob.id);
assert.equal(scriptDigestLog.labels.find(({name}) => name === "level")?.value,"info");
assert.equal(scriptDigestLog.labels.find(({name}) => name === "type")?.value,"app");
assert.ok(Date.parse(scriptDigestLog.timestamp) >= Date.parse(scriptDigestJob.startedAt));
assert.ok(Date.parse(scriptDigestLog.timestamp) <= Date.parse(scriptDigestJob.finishedAt));
const digestReceipt = JSON.parse(scriptDigestLog.message);
assert.equal(digestReceipt.event,"JJ_GLOW_CANDIDATE_4_SCRIPT_DIGEST_READBACK_PASS");
assert.equal(digestReceipt.service_id,scriptDigestJob.serviceId);
assert.equal(digestReceipt.runtime_sha,"588567c809326736bb316ce74df90a5feb9b9875");
assert.equal(digestReceipt.transaction,"REPEATABLE READ READ ONLY");
assert.equal(digestReceipt.mutation,false);
const digestFields = ["approved_by_user_at","caption","created_at","edited_by_user","emotion","hashtags",
  "hook_family","hook_level","id","job_id","manual_evidence_audit","product_id","quality_tier","register",
  "segments","validation_result"].sort();
assert.deepEqual(Object.keys(digestReceipt.script).sort(),digestFields);
assert.equal(digestReceipt.script.id,"ca32178f-2731-4234-bb07-48f24a2f2079");
assert.equal(digestReceipt.script.job_id,jobId);
assert.equal(digestReceipt.script.product_id,"c470390e-ad3d-4cc8-9ba2-4557691fa7a7");
assert.equal(digestReceipt.script.manual_evidence_audit.actor,"ac8b0a3e-8835-4e64-80e6-2e2cae6198b8");
const manualMeta = JSON.parse(digestReceipt.script.manual_evidence_audit.meta);
assert.equal(manualMeta.task,"FINAL-POST-SWEEP-CANDIDATE-4-20260901");
assert.equal(manualMeta.lifecycle_correlation_id,correlation);
assert.equal(manualMeta.final_candidate_ordinal,4);
assert.equal(manualMeta.max_canonical_candidates_created,4);
const frozenScriptDigest = "110198510c75de3dba61d57260dce12af7cb0f06c6a4ddfc2254479cb8f05e7c";
assert.equal(deterministicDigest(digestReceipt.script),frozenScriptDigest);
assert.equal(digestReceipt.approved_script_sha256,frozenScriptDigest);
assert.match(migration0046,new RegExp(`approved_script_sha256='${frozenScriptDigest}'`));
assert.match(provider,/function jjGlowApprovedScriptSha256[\s\S]*manual_evidence_audit:manualAudit/);
assert.match(scriptDigestReadback,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
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
