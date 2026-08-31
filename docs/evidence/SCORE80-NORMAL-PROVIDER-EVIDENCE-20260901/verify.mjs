import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const read=(name)=>fs.readFileSync(new URL(name,import.meta.url),"utf8");
const hashes={
  "CREDENTIAL-PREFLIGHT.json":"c7dc5de7286fefa886dc7aa63a596b10648a167e847272c2df7f6c358638a952",
  "EXECUTION-COMPILE-FAILED-JOB-RAW.json":"23f6500bc143678fd012e99d911abf3b715583f4c3c183a4fc2aca01e53d09c7",
  "EXECUTION-COMPILE-FAILED-LOG-RAW.json":"7763b542a73a8b4d73b333e8e3f3eaf625dba9c1d48fa97f5ed981da47e23d88",
  "EXECUTION-PG-TYPE-FAILED-JOB-RAW.json":"3e266eb1179c77707351164c597c54a52c56c26c950392dfb58bb42b24f47b56",
  "EXECUTION-PG-TYPE-FAILED-LOG-RAW.json":"4c21500c6c0ef1a6e6f9b0c63ed12299b8f6de4a694fa01478f8226dcb2c02b3",
  "EXTERNAL-LAUNCHER-ATTEST-JOB-RAW.json":"c496f2b0a5add7741c2dee0c433937d0deede6a3108e5e4eb99caedbb034781f",
  "EXTERNAL-LAUNCHER-ATTEST-LOG-RAW.json":"e857b98a0374eb5476f3c13d6ad932a5961a17764ec0315d0e864302c1c354b7",
  "INITIAL-PRECALL-PASS-JOB-RAW.json":"9628dac346a3c95764e1baa7dbfd0431169ecd89b9d3e05511565c73e5c417a0",
  "INITIAL-PRECALL-PASS-LOG-RAW.json":"15dcc71a0d0884303d5d43c48175785524f1b3d5e72170dc9750a5f8d4daa0aa",
  "MANAGED-CREDENTIAL-JOBS-RAW.json":"11947dd28b7174e822546a3600f95874a60d94ec4754e76b4bbd15933e0c87e6",
  "MANAGED-CREDENTIAL-LOGS-RAW.json":"38311e0497cb5f0717ff44e8214406778ea7dc92f3345875effbe3a98a6a13d1",
  "LEGACY-PREFLIGHT-FAILED-JOB-RAW.json":"d7df18a1be2e3779151328b4db54ed5d66ff38200d967a7334ed977b87097d2e",
  "LEGACY-PREFLIGHT-FAILED-LOG-RAW.json":"70eb6fbbbdc994ce548886836c777d5d79a3812c7234749d892775078772dc8f",
  "OBSOLETE-STATE-PREFLIGHT-FAILED-JOB-RAW.json":"e60250fe25a8316f4de5c4fec8e10b4403fda020865e449e46f2de1136163d30",
  "OBSOLETE-STATE-PREFLIGHT-FAILED-LOG-RAW.json":"945e58b93869802d4006104660e3ad2326d0341187178271e7d62b630d4d1af8",
  "POSTFAIL-PRECALL-PASS-JOB-RAW.json":"195ce3396ce36cf2e5254ae7c31efd6ec4b52b0b719fe5295cf48b16ec683d87",
  "POSTFAIL-PRECALL-PASS-LOG-RAW.json":"3653f67bdba11772b55839614f93848c82fb5245562db600bb7820240091e812",
  "EXACT-RUNTIME-DEPLOYS-RAW.json":"810b5c8429720cdb3c39c6fc7ec3927706b9b3e48ff6e4e5a5e25e1b3b173996",
  "RENDER-ENV-CONFIG-REDACTED.json":"f4b4fefe46be2e3d1f7af41d8833d92b79de2e42718e1cdb562d416dc7dd545c",
  "SUCCESSOR-AUTHORIZATION-JOB-RAW.json":"2cc0768ba293bf83e2633c4462e00c1d00f1584868a23fd5039fea66958f4669",
  "SUCCESSOR-AUTHORIZATION-LOG-RAW.json":"034898a537d2ed05b56ce52a52ea0b7519fb909b46278bc8187ad6f6ad1ff950",
  "SUCCESSOR-PRECALL-JOB-RAW.json":"e6b47e0ce792cd7855261972e6c1e0fff09e05d9d2244e726dcb83032bd48c4e",
  "SUCCESSOR-PRECALL-LOG-RAW.json":"4d9665fad99574ec8c7da4a374b327f2fdce33e0370a7361a555fd256cf424b7",
  "TASK-RAW.json":"f298733ce002b7f3c92aaaecb8cd89fde7b643a7c8f4c39b0a2a0d578bc86408",
};
const raw={};for(const [name,hash] of Object.entries(hashes)){const bytes=read(name);assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),hash,name);raw[name]=JSON.parse(bytes)}
const task=raw["TASK-RAW.json"];
assert.deepEqual([task.id,task.type,task.task,task.sha],["1788216339000-reviewer-TASK","TASK","SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901","4c6023ca6406d28065ae5a64dcf5bbcae4f1cb6a"]);

const managedJobs=raw["MANAGED-CREDENTIAL-JOBS-RAW.json"],managedLogs=raw["MANAGED-CREDENTIAL-LOGS-RAW.json"];
const byJob=Object.fromEntries(managedJobs.map(value=>[value.id,value]));
assert.deepEqual([byJob["job-dab0idmk1f9s739of47g"].serviceId,byJob["job-dab0idmk1f9s739of47g"].status],["srv-d9n28ue417fc73ch2b60","succeeded"]);
assert.deepEqual([byJob["job-dab0mkvavr4c73een4r0"].serviceId,byJob["job-dab0mkvavr4c73een4r0"].status],["srv-d9n28tijnfac73a87lt0","succeeded"]);
const managedReceipt=(event)=>managedLogs.map(x=>{try{return JSON.parse(x.message)}catch{return null}}).find(x=>x?.event===event);
const workerCredential=managedReceipt("CANDIDATE4_MANAGED_WORKER_CREDENTIAL_PROBE_PASS");
const webAbsent=managedReceipt("CANDIDATE4_MANAGED_WEB_KEY_ABSENCE_PASS");
assert.deepEqual([workerCredential.render_service_id,workerCredential.key_sha256,workerCredential.probe_method,
  workerCredential.http_status,workerCredential.authenticated,workerCredential.provider_post,workerCredential.secret_value_output],
  ["srv-d9n28ue417fc73ch2b60","e235f534009788cbcb817e86779919604b8cc4255c98d62e0ce13829587603ab","GET",404,true,false,false]);
assert.deepEqual([webAbsent.render_service_id,webAbsent.render_git_commit,webAbsent.key_present,webAbsent.provider_post],
  ["srv-d9n28tijnfac73a87lt0","23fa4923ec667a44ef8044e309140ee169864f88",false,false]);
assert.ok(managedLogs.some(x=>x.message==="CANDIDATE4_MANAGED_WEB_KEY_ABSENCE_FAIL"),"stale web credential discovery must remain archived");
const envConfig=raw["RENDER-ENV-CONFIG-REDACTED.json"],envByService=Object.fromEntries(envConfig.services.map(x=>[x.service_id,x]));
assert.equal(envConfig.pagination_complete,true);assert.equal(envConfig.production_mutation,false);
assert.deepEqual(envByService["srv-d9n28tijnfac73a87lt0"].key_rows,[]);
assert.equal(envByService["srv-d9n28ue417fc73ch2b60"].key_rows[0].value_sha256,workerCredential.key_sha256);
assert.equal(envByService["srv-d9ni3ndaeets73c07kq0"].key_rows[0].value_sha256,"13503e470ca13bb18eddb001c492a28e9c91ffa34513592e7a4768c7da6342cf");
assert.notEqual(workerCredential.key_sha256,envByService["srv-d9ni3ndaeets73c07kq0"].key_rows[0].value_sha256);

for(const deployment of raw["EXACT-RUNTIME-DEPLOYS-RAW.json"]){assert.equal(deployment.status,"live");assert.equal(deployment.commit.id,"23fa4923ec667a44ef8044e309140ee169864f88")}
assert.deepEqual(raw["SUCCESSOR-AUTHORIZATION-JOB-RAW.json"].map(x=>[x.id,x.status]),[["job-dab0n5id0e5s73d0s7a0","succeeded"]]);
const successor=JSON.parse(raw["SUCCESSOR-AUTHORIZATION-LOG-RAW.json"].find(x=>x.message.startsWith("{"))?.message??"null");
assert.equal(successor.event,"JJ_GLOW_PROVIDER_RUNTIME_SUCCESSOR_AUTHORIZED_NO_POST");
assert.deepEqual([successor.prior_provider_runtime_sha,successor.provider_runtime_sha,successor.authorizer_deploy_sha],
  ["4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1","23fa4923ec667a44ef8044e309140ee169864f88","23fa4923ec667a44ef8044e309140ee169864f88"]);
assert.deepEqual([successor.provider_posts,successor.provider_tasks,successor.outputs,successor.publication],[0,0,0,false]);
assert.deepEqual(raw["SUCCESSOR-PRECALL-JOB-RAW.json"].map(x=>[x.id,x.status]),[["job-dab0p0c9v7es73bn44rg","succeeded"]]);
const successorPrecall=JSON.parse(raw["SUCCESSOR-PRECALL-LOG-RAW.json"].find(x=>x.message.startsWith("{"))?.message??"null");
assert.equal(successorPrecall.event,"CANDIDATE4_PROVIDER_PRECALL_FREEZE_PASS");assert.equal(successorPrecall.runtime_sha,"23fa4923ec667a44ef8044e309140ee169864f88");
assert.deepEqual([successorPrecall.database_to_r2_reference_digest,successorPrecall.approved_script_digest,successorPrecall.cross_row_metadata],['PASS','PASS','PASS']);
assert.deepEqual([successorPrecall.provider_post_count,successorPrecall.provider_tasks,successorPrecall.outputs,successorPrecall.publication,
  successorPrecall.queue_paused,successorPrecall.queue_counts.active,successorPrecall.contract_sha256],
  [0,0,0,false,true,0,"9cfbbed2ae2088a40293ea58c9abad8fe89dd35196a804aebd1a885b43f7fa62"]);

const externalSource=read("../../../scripts/staging-jj-glow-candidate4-provider-external.cjs");
const externalSha=crypto.createHash("sha256").update(externalSource).digest("hex");
assert.equal(externalSha,"b7c500b1645dd737fe72c70a0b5dea7412045ad1d57d415fd43b57f5932a864e");
const externalJob=raw["EXTERNAL-LAUNCHER-ATTEST-JOB-RAW.json"][0];
assert.deepEqual([externalJob.id,externalJob.serviceId,externalJob.status],
  ["job-dab0taad0e5s73d1eomg","srv-d9n28ue417fc73ch2b60","succeeded"]);
assert.match(externalJob.startCommand,/^env CANDIDATE4_PROVIDER_EXECUTION_MODE=ATTEST_NO_POST node -e /);
const encodedExternal=externalJob.startCommand.match(/Buffer\.from\('([^']+)','base64'\)/)?.[1];
assert.ok(encodedExternal,"managed start command must embed launcher bytes");
assert.equal(Buffer.from(encodedExternal,"base64").toString(),externalSource,"managed start command bytes must equal reviewed artifact");
assert.match(externalJob.startCommand,new RegExp(externalSha));
const externalReceipt=JSON.parse(raw["EXTERNAL-LAUNCHER-ATTEST-LOG-RAW.json"].find(x=>x.message.startsWith("{"))?.message??"null");
assert.deepEqual([externalReceipt.event,externalReceipt.launcher_sha256,externalReceipt.runtime_sha,
  externalReceipt.execution_mode,externalReceipt.queue_paused,externalReceipt.queue_counts.active,
  externalReceipt.provider_post,externalReceipt.mutation],
  ["CANDIDATE4_EXTERNAL_LAUNCHER_ATTESTED_NO_POST",externalSha,"23fa4923ec667a44ef8044e309140ee169864f88",
    "ATTEST_NO_POST",true,0,false,false]);
assert.match(externalSource,/EXECUTE_EXACTLY_ONCE/);assert.match(externalSource,/CANDIDATE4_PROVIDER_EXECUTE_CONFIRM/);
assert.match(externalSource,/processPostgresJob\(JOB,\{retryViaQueue:true\}\)/);
assert.match(externalSource,/CANDIDATE4_EXTERNAL_LAUNCHER_WORKER_KEY_ATTESTATION_MISMATCH/);

const job=(name)=>raw[name],messages=(name)=>raw[name].map(x=>x.message).join("\n");
assert.deepEqual([job("LEGACY-PREFLIGHT-FAILED-JOB-RAW.json").id,job("LEGACY-PREFLIGHT-FAILED-JOB-RAW.json").status],
  ["job-dab094n40ujc739ejtu0","failed"]);
assert.match(messages("LEGACY-PREFLIGHT-FAILED-LOG-RAW.json"),/JJ_GLOW_FINAL_EVIDENCE_PRIOR_EFFECT_OR_CARDINALITY/);
assert.deepEqual([job("EXECUTION-COMPILE-FAILED-JOB-RAW.json").id,job("EXECUTION-COMPILE-FAILED-JOB-RAW.json").status],
  ["job-dab0ac142hec739gg13g","failed"]);
assert.match(messages("EXECUTION-COMPILE-FAILED-LOG-RAW.json"),/Top-level await is currently not supported/);
assert.deepEqual([job("EXECUTION-PG-TYPE-FAILED-JOB-RAW.json").id,job("EXECUTION-PG-TYPE-FAILED-JOB-RAW.json").status],
  ["job-dab0ar3tqb8s73edklhg","failed"]);
assert.match(messages("EXECUTION-PG-TYPE-FAILED-LOG-RAW.json"),/inconsistent types deduced for parameter \$3/);
assert.doesNotMatch(messages("EXECUTION-COMPILE-FAILED-LOG-RAW.json")+messages("EXECUTION-PG-TYPE-FAILED-LOG-RAW.json"),/\[byteplus\]|task .* dikirim|provider-task/);

const receipt=(name)=>JSON.parse(raw[name].find(x=>x.message.startsWith("{"))?.message??"null");
const initial=receipt("INITIAL-PRECALL-PASS-LOG-RAW.json"),post=receipt("POSTFAIL-PRECALL-PASS-LOG-RAW.json");
for(const [value,state] of [[initial,undefined],[post,"GENERATING_VISUAL"]]){
  assert.equal(value.event,"CANDIDATE4_PROVIDER_PRECALL_FREEZE_PASS");assert.equal(value.runtime_sha,"4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1");
  assert.equal(value.transaction,"REPEATABLE READ READ ONLY");assert.equal(value.database_to_r2_reference_digest,"PASS");
  assert.equal(value.approved_script_digest,"PASS");assert.equal(value.cross_row_metadata,"PASS");assert.equal(value.active_evidence_lease,true);
  assert.deepEqual([value.provider_post_count,value.provider_tasks,value.outputs,value.publication,value.queue_paused,value.queue_counts.active],[0,0,0,false,true,0]);
  assert.equal(value.contract_sha256,"c5c8ac3c3dbc33548cef51ca6ac92ac4ed4ff744d805e19cd1c41ff25d4e6f5c");assert.equal(value.job_state,state);
  assert.equal(value.contract.estimated_cost_usd,1.134);assert.equal(value.contract.max_cost_usd,1.25);assert.equal(value.contract.max_provider_posts,1);
  assert.equal(value.contract.auto_retry,false);assert.equal(value.contract.publication,false);
  assert.deepEqual(value.contract.required_independent_verdicts,["BRAND_FIDELITY","ANTI_SLOP","PROMPT_VERDICT_ARCHIVE"]);
}
assert.deepEqual(initial.contract,post.contract,"failed local attempts cannot alter frozen contract");
assert.deepEqual([job("INITIAL-PRECALL-PASS-JOB-RAW.json").status,job("POSTFAIL-PRECALL-PASS-JOB-RAW.json").status],["succeeded","succeeded"]);
assert.match(messages("OBSOLETE-STATE-PREFLIGHT-FAILED-LOG-RAW.json"),/C4_PROVIDER_PREFLIGHT_JOB_CROSS_ROW/);
assert.ok(Date.parse(job("INITIAL-PRECALL-PASS-JOB-RAW.json").finishedAt)<Date.parse(job("EXECUTION-COMPILE-FAILED-JOB-RAW.json").startedAt));
assert.ok(Date.parse(job("EXECUTION-PG-TYPE-FAILED-JOB-RAW.json").finishedAt)<Date.parse(job("POSTFAIL-PRECALL-PASS-JOB-RAW.json").startedAt));

const store=read("../../../lib/postgres/normal-evidence.ts"),test=read("../../../tests/pg-stale-sweep-evidence-lease.test.ts");
const preflight=read("../../../scripts/staging-jj-glow-candidate4-provider-preflight.cjs"),execute=read("../../../scripts/staging-jj-glow-candidate4-provider-execute.ts");
assert.match(store,/post_attempted_at=\$3::text,updated_at=\$3::text/);assert.match(store,/lease_last_progress_at=\$3::timestamptz,lease_expires_at=\$5::timestamptz/);
assert.match(test,/active PREPOST_READY lease claims once across TEXT and TIMESTAMPTZ progress columns/);
assert.match(preflight,/database_to_r2_reference_digest:"PASS"/);assert.match(preflight,/required_independent_verdicts/);
assert.match(preflight,/const RUNTIME="23fa4923ec667a44ef8044e309140ee169864f88"/);
assert.match(preflight,/normal_evidence_runtime_successor_authorizations/);
assert.match(execute,/RENDER_GIT_COMMIT!==RUNTIME/);assert.match(execute,/RACUN_WORKER_DETERMINISTIC==="1"/);assert.match(execute,/!paused\|\|Number\(counts\.active\)!==0/);
assert.match(execute,/const RUNTIME="23fa4923ec667a44ef8044e309140ee169864f88"/);
assert.match(execute,/const WORKER_KEY_SHA256="e235f534009788cbcb817e86779919604b8cc4255c98d62e0ce13829587603ab"/);
assert.match(execute,/CANDIDATE4_ONE_SHOT_WORKER_KEY_ATTESTATION_MISMATCH/);
assert.match(execute,/processPostgresJob\(JOB,\{retryViaQueue:true\}\)/);assert.match(execute,/auto_retry:false/);
console.log("CANDIDATE4_ACTIVATED_PRECALL_AND_PARAMETER_TYPING_REMEDIATION=PASS");
