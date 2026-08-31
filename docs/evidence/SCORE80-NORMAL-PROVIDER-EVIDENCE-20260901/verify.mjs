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
  "INITIAL-PRECALL-PASS-JOB-RAW.json":"9628dac346a3c95764e1baa7dbfd0431169ecd89b9d3e05511565c73e5c417a0",
  "INITIAL-PRECALL-PASS-LOG-RAW.json":"15dcc71a0d0884303d5d43c48175785524f1b3d5e72170dc9750a5f8d4daa0aa",
  "LEGACY-PREFLIGHT-FAILED-JOB-RAW.json":"d7df18a1be2e3779151328b4db54ed5d66ff38200d967a7334ed977b87097d2e",
  "LEGACY-PREFLIGHT-FAILED-LOG-RAW.json":"70eb6fbbbdc994ce548886836c777d5d79a3812c7234749d892775078772dc8f",
  "OBSOLETE-STATE-PREFLIGHT-FAILED-JOB-RAW.json":"e60250fe25a8316f4de5c4fec8e10b4403fda020865e449e46f2de1136163d30",
  "OBSOLETE-STATE-PREFLIGHT-FAILED-LOG-RAW.json":"945e58b93869802d4006104660e3ad2326d0341187178271e7d62b630d4d1af8",
  "POSTFAIL-PRECALL-PASS-JOB-RAW.json":"195ce3396ce36cf2e5254ae7c31efd6ec4b52b0b719fe5295cf48b16ec683d87",
  "POSTFAIL-PRECALL-PASS-LOG-RAW.json":"3653f67bdba11772b55839614f93848c82fb5245562db600bb7820240091e812",
  "TASK-RAW.json":"f298733ce002b7f3c92aaaecb8cd89fde7b643a7c8f4c39b0a2a0d578bc86408",
};
const raw={};for(const [name,hash] of Object.entries(hashes)){const bytes=read(name);assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),hash,name);raw[name]=JSON.parse(bytes)}
const task=raw["TASK-RAW.json"],credential=raw["CREDENTIAL-PREFLIGHT.json"];
assert.deepEqual([task.id,task.type,task.task,task.sha],["1788216339000-reviewer-TASK","TASK","SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901","4c6023ca6406d28065ae5a64dcf5bbcae4f1cb6a"]);
assert.deepEqual([credential.worker_key_present,credential.web_key_absent,credential.production_key_present,
  credential.worker_distinct_from_production_shared,credential.authenticated_nonmutating_probe.http_status,
  credential.authenticated_nonmutating_probe.authenticated,credential.provider_post,credential.secret_value_observed,
  credential.secret_value_output],[true,true,true,true,404,true,false,false,false]);

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
assert.match(execute,/RENDER_GIT_COMMIT!==RUNTIME/);assert.match(execute,/RACUN_WORKER_DETERMINISTIC==="1"/);assert.match(execute,/!paused\|\|Number\(counts\.active\)!==0/);
assert.match(execute,/processPostgresJob\(JOB,\{retryViaQueue:true\}\)/);assert.match(execute,/auto_retry:false/);
console.log("CANDIDATE4_ACTIVATED_PRECALL_AND_PARAMETER_TYPING_REMEDIATION=PASS");
