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
const runtimeEvidenceHashes = {
  "METADATA-PREFLIGHT-MANAGED-JOB-RAW.json":"f2e4a283f9a30c3e24973caab3a68834c4b63d8539419d057735c09846d69a4f",
  "METADATA-PREFLIGHT-MANAGED-LOG-RAW.json":"a16a33bfccf0f8ea2d6f7ea4d98efdd97b377a9cda3e31b5808b4542751f2506",
  "ACTIVATION-MANAGED-JOB-RAW.json":"37a95a0cbd410933ea6b68d78433a59ca013752e3f16c5d766ab743cd46ad489",
  "ACTIVATION-MANAGED-LOG-RAW.json":"75908af535a8b42a017fe3e1c2ff01f59113fd5fbe2e3763d5731fb2f8965250",
  "LEASE-PRE-SWEEP-MANAGED-JOB-RAW.json":"7b8b58201bbe325f24e7404ae5f78aa275cf754926227f83fb772f01bc337405",
  "LEASE-PRE-SWEEP-MANAGED-LOG-RAW.json":"43b3d129d17465384b860831cdaaecda7a491b8c6855258d7d04460e827ae83b",
  "LEASE-POST-SWEEP-MANAGED-JOB-RAW.json":"22f3f513a153d4e74d669bcc6f7b9750181ad13e584f74368c8a0cd1a3d5a178",
  "LEASE-POST-SWEEP-MANAGED-LOG-RAW.json":"614a9ee15f93dfe1995d8fcc0ed8fbd8e59de4123451fec8df03803aac203ab8",
  "WORKER-DEPLOY-RAW.json":"a7a6870235d9e1d62d0266a373ac9846b794ae8215e7cb6abf90e80fb6bb4687",
  "WORKER-RUNTIME-LOGS-RAW.json":"0a859db6c4bb97696e7451edaab0df05d5fc71b5fad8f5ae76131a6d4e8e8b3f",
  "WORKER-POST-SWEEP-SERVICE-RAW.json":"72fbab061e1edc51b870a701acaafc83948a6d8599f49e247359ba0875b20cde",
};
const runtimeEvidence = Object.fromEntries(Object.keys(runtimeEvidenceHashes)
  .map((path) => [path,JSON.parse(read(path))]));
const creation = JSON.parse(creationRaw), postExit = JSON.parse(postExitRaw), state = JSON.parse(stateRaw);
const managedJob = JSON.parse(managedJobRaw), managedLog = JSON.parse(managedLogRaw);
const scriptDigestJob = JSON.parse(scriptDigestJobRaw), scriptDigestLog = JSON.parse(scriptDigestLogRaw);
const admission = read("../../../lib/staging-jj-glow-exact-admission.ts");
const runner = read("../../../scripts/staging-jj-glow-candidate.cjs");
const freeze = read("../../../scripts/staging-jj-glow-final-evidence.ts");
const provider = read("../../../lib/providers/normal-evidence.ts");
const stateReadback = read("../../../scripts/staging-jj-glow-candidate4-state-readback.cjs");
const scriptDigestReadback = read("../../../scripts/staging-jj-glow-candidate4-script-digest-readback.cjs");
const leaseSweepReadback = read("../../../scripts/staging-jj-glow-candidate4-lease-sweep-readback.cjs");
const workerSource = read("../../../scripts/worker.ts");
const postgresWorkerSource = read("../../../lib/postgres/worker.ts");
const postgresJobsSource = read("../../../lib/postgres/jobs.ts");
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
assert.equal(sha256(leaseSweepReadback), "7ea26c167df953753295e7f4ecbcf275e4f4dc9a5b089772540d78b6c3a65031");
for (const [path,digest] of Object.entries(runtimeEvidenceHashes)) assert.equal(sha256(read(path)),digest,path);
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

const exactReviewedSha = "13c22bc7a3a340f0ea5f4bb0db9a905691676c77";
const metadataJob = runtimeEvidence["METADATA-PREFLIGHT-MANAGED-JOB-RAW.json"];
const metadataLog = runtimeEvidence["METADATA-PREFLIGHT-MANAGED-LOG-RAW.json"];
const activationJob = runtimeEvidence["ACTIVATION-MANAGED-JOB-RAW.json"];
const activationLog = runtimeEvidence["ACTIVATION-MANAGED-LOG-RAW.json"];
const preSweepJob = runtimeEvidence["LEASE-PRE-SWEEP-MANAGED-JOB-RAW.json"];
const preSweepLog = runtimeEvidence["LEASE-PRE-SWEEP-MANAGED-LOG-RAW.json"];
const postSweepJob = runtimeEvidence["LEASE-POST-SWEEP-MANAGED-JOB-RAW.json"];
const postSweepLog = runtimeEvidence["LEASE-POST-SWEEP-MANAGED-LOG-RAW.json"];
const workerDeploy = runtimeEvidence["WORKER-DEPLOY-RAW.json"];
const workerLogs = runtimeEvidence["WORKER-RUNTIME-LOGS-RAW.json"];
const workerService = runtimeEvidence["WORKER-POST-SWEEP-SERVICE-RAW.json"];
const assertManagedLog = (job,log) => {
  assert.equal(job.serviceId,"srv-d9n28tijnfac73a87lt0");
  assert.equal(job.planId,"plan-srv-006");
  assert.equal(job.status,"succeeded");
  assert.equal(log.labels.find(({name}) => name === "resource")?.value,job.id);
  assert.equal(log.labels.find(({name}) => name === "level")?.value,"info");
  assert.equal(log.labels.find(({name}) => name === "type")?.value,"app");
  assert.ok(Date.parse(log.timestamp) >= Date.parse(job.startedAt));
  assert.ok(Date.parse(log.timestamp) <= Date.parse(job.finishedAt));
  return JSON.parse(log.message);
};
const metadataReceipt = assertManagedLog(metadataJob,metadataLog);
const activationReceipt = assertManagedLog(activationJob,activationLog);
assert.equal(metadataJob.id,"job-daaun8nqj5pc73bbjang");
assert.equal(activationJob.id,"job-daaunf710e5c73cr1b80");
assert.match(metadataJob.startCommand,/staging-jj-glow-final-evidence\.cjs preflight$/);
assert.match(activationJob.startCommand,/JJ_GLOW_FINAL_EVIDENCE_ACTIVATE_CONFIRM=FINAL-POST-SWEEP-CANDIDATE-4-20260901/);
assert.match(activationJob.startCommand,/staging-jj-glow-final-evidence\.cjs activate$/);
assert.equal(metadataReceipt.event,"JJ_GLOW_METADATA_FREEZE_PASS");
assert.equal(metadataReceipt.metadataMutation,false);
assert.equal(metadataReceipt.activeEvidenceLease,false);
assert.equal(activationReceipt.event,"JJ_GLOW_FINAL_EVIDENCE_ACTIVATED_NO_POST");
assert.equal(activationReceipt.metadataMutation,"LEDGER_AND_ACTIVE_EVIDENCE_LEASE");
assert.equal(activationReceipt.activeEvidenceLease,true);
for (const receipt of [metadataReceipt,activationReceipt]) {
  assert.equal(receipt.taskId,contract.task);
  assert.equal(receipt.jobId,jobId);
  assert.equal(receipt.deploySha,exactReviewedSha);
  assert.equal(receipt.databaseBindingSha256,bindingSha);
  assert.equal(receipt.approvedScriptSha256,frozenScriptDigest);
  assert.equal(receipt.idempotencyKey,"17523707c5f39c34c89552874b8e0420315bd2a8085ccf9be31a7808b3c8bf2c");
  assert.equal(receipt.scriptCount,2);assert.equal(receipt.candidateCount,2);
  assert.equal(receipt.predecessorVerified,true);assert.equal(receipt.predecessorState,"REFUNDED");
  assert.deepEqual([receipt.predecessorProviderTasks,receipt.predecessorProviderPosts,receipt.predecessorOutputs,
    receipt.predecessorPublication,receipt.predecessorHoldCount,receipt.predecessorReleaseCount,receipt.predecessorCaptureCount],
  [0,0,0,false,1,1,0]);
  assert.deepEqual([receipt.providerTasks,receipt.providerPosts,receipt.outputs,receipt.fypPosted,receipt.postPlans,
    receipt.holdCount,receipt.terminalLedgerCount,receipt.publication],[0,0,0,0,0,1,0,false]);
}

const leaseJobSource = (job,phase) => {
  assert.equal(job.serviceId,"srv-d9n28tijnfac73a87lt0");
  assert.equal(job.planId,"plan-srv-006");assert.equal(job.status,"succeeded");
  assert.match(job.startCommand,new RegExp(`CANDIDATE4_READBACK_PHASE=${phase}`));
  const encoded = job.startCommand.match(/eval\(Buffer\.from\('([A-Za-z0-9+/=]+)','base64'\)\.toString\(\)\)"$/)?.[1];
  assert.ok(encoded);return Buffer.from(encoded,"base64").toString("utf8");
};
assert.equal(preSweepJob.id,"job-daauodn10e5c73cr46lg");
assert.equal(postSweepJob.id,"job-daaurirtqb8s73b8vfug");
assert.equal(leaseJobSource(preSweepJob,"pre-sweep"),leaseSweepReadback);
assert.equal(leaseJobSource(postSweepJob,"post-sweep"),leaseSweepReadback);
const preSweep = assertManagedLog(preSweepJob,preSweepLog);
const postSweep = assertManagedLog(postSweepJob,postSweepLog);
for (const [receipt,phase] of [[preSweep,"pre-sweep"],[postSweep,"post-sweep"]]) {
  assert.equal(receipt.event,"JJ_GLOW_CANDIDATE_4_LEASE_SWEEP_READBACK_PASS");
  assert.equal(receipt.phase,phase);assert.equal(receipt.runtime_sha,exactReviewedSha);
  assert.equal(receipt.transaction,"REPEATABLE READ READ ONLY");assert.equal(receipt.mutation,false);
  assert.equal(receipt.product_jobs,2);assert.equal(receipt.product_scripts,2);
  assert.equal(receipt.queue_paused,true);assert.equal(receipt.queue_counts.active,0);
  assert.ok(receipt.candidate_age_seconds > 1800);
  assert.deepEqual([receipt.predecessor.state,receipt.predecessor.provider_tasks,receipt.predecessor.provider_posts,
    receipt.predecessor.outputs,receipt.predecessor.fyp_posted,receipt.predecessor.post_plans,
    receipt.predecessor.holds,receipt.predecessor.releases,receipt.predecessor.captures],
  ["REFUNDED",0,0,0,0,0,1,1,0]);
  assert.deepEqual([receipt.candidate.state,receipt.candidate.provider_tasks,receipt.candidate.provider_posts,
    receipt.candidate.outputs,receipt.candidate.fyp_posted,receipt.candidate.post_plans,
    receipt.candidate.holds,receipt.candidate.releases,receipt.candidate.captures],
  ["QUEUED",0,0,0,0,0,1,0,0]);
  assert.equal(receipt.evidence.task_id,contract.task);assert.equal(receipt.evidence.job_id,jobId);
  assert.equal(receipt.evidence.deploy_sha,exactReviewedSha);
  assert.equal(receipt.evidence.approved_script_sha256,frozenScriptDigest);
  assert.equal(receipt.evidence.state,"PREPOST_READY");assert.equal(receipt.evidence.lease_kind,"ACTIVE_EVIDENCE_LEASE");
  assert.deepEqual([receipt.evidence.provider_post_count,receipt.evidence.provider_task_id,
    receipt.evidence.artifact_key,receipt.evidence.actual_cost_usd],[0,null,null,null]);
  assert.ok(Date.parse(receipt.evidence.lease_expires_at) > Date.parse(receipt.evaluated_at));
}
assert.deepEqual(postSweep.predecessor,preSweep.predecessor);
assert.deepEqual(postSweep.candidate,preSweep.candidate);
assert.deepEqual(postSweep.evidence,preSweep.evidence);
assert.deepEqual(postSweep.queue_counts,preSweep.queue_counts);

assert.equal(workerDeploy.id,"dep-daaupcm7bikc73ceaing");assert.equal(workerDeploy.status,"live");
assert.equal(workerDeploy.commit.id,exactReviewedSha);
assert.equal(workerService.id,"srv-d9n28ue417fc73ch2b60");
assert.equal(workerService.name,"racun-ai-staging-worker");assert.equal(workerService.suspended,"suspended");
const workerStart = workerLogs.find(({message}) => message === "[worker] Redis queue racun-jobs-staging; concurrency=1");
assert.ok(workerStart,"canonical worker startup log missing");
assert.ok(Date.parse(workerStart.timestamp) >= Date.parse(workerDeploy.finishedAt));
assert.ok(Date.parse(postSweep.evaluated_at) > Date.parse(workerStart.timestamp),
  "the later readback must follow canonical worker startup");
assert.ok(Date.parse(workerService.updatedAt) >= Date.parse(postSweep.evaluated_at));
assert.match(workerSource,/setInterval\(\(\) => \{[\s\S]*sweepPostgresStaleJobs\(\)[\s\S]*\}, 60_000\)/);
assert.match(postgresWorkerSource,/const swept = await jobs\.sweepStaleJobs\(\)/);
assert.match(postgresWorkerSource,/event:"POSTGRES_STALE_SWEEP_COMPLETED"/);
assert.match(postgresWorkerSource,/runtime_sha:process\.env\.RENDER_GIT_COMMIT/);
assert.match(postgresJobsSource,/normal_representative_evidence_runs WHERE job_id=\$1 FOR UPDATE/);
assert.match(postgresJobsSource,/if \(evidence && hasUnexpiredEvidenceLease\(evidence, evaluatedAt\)\) return false/);
assert.match(postgresJobsSource,/trigger: "WORKER_INTERVAL_60000_MS"/);
assert.match(leaseSweepReadback,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
assert.match(leaseSweepReadback,/candidate_age_seconds/);
assert.match(leaseSweepReadback,/queue_paused/);
console.log("CANDIDATE_4_ACTIVATION_PRE_EXPLICIT_SWEEP_RECEIPT_CONTRACT=PASS");
