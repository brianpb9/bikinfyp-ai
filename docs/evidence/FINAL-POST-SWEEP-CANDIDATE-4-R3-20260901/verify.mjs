import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const read=(rel)=>fs.readFileSync(new URL(rel,import.meta.url),"utf8");
const migration=read("../../../migrations/postgres/0047_candidate4_provider_runtime_authorization.sql");
const provider=read("../../../lib/providers/normal-evidence.ts");
const store=read("../../../lib/postgres/normal-evidence.ts");
const jobs=read("../../../lib/postgres/jobs.ts");
const worker=read("../../../lib/postgres/worker.ts");
const authorizer=read("../../../scripts/staging-jj-glow-candidate4-runtime-authorize.ts");
const webDocker=read("../../../Dockerfile.web");

const RUNTIME="4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1";
const BINDING="f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610";
const JOB="2c49a5c8-9465-4400-a214-159336a2c097";
const TASK="FINAL-POST-SWEEP-CANDIDATE-4-R3-20260901";
const rawHashes={
  "AUTH-JOB-RAW.json":"e6c4687eda915a3b7829880348bf734c6681afdb5f2deb207ea210128f3c6c07",
  "AUTH-LOG-RAW.json":"b37dde24def95482741ccdd1f1b3068092615939d5aca7674590ca1d5a1f54f6",
  "POST-READBACK-JOB-RAW.json":"2096b2bbec3a877e9d41db1b6a7d9d6b0b19513657b6c1e30280ebb9e20880da",
  "POST-READBACK-LOG-RAW.json":"b9c42614b828e2f67aeebc83087ea94cbac5aebd43bc1a8b2e9d5e993f859d9c",
  "PRE-READBACK-JOB-RAW.json":"38e8724686c7d1db793951d7228d46ffc6af379633c9318d697987f4105b189b",
  "PRE-READBACK-LOG-RAW.json":"b5e1bd9e94c517780b7ead4f0865b9f20ae81328d8337c5ab13c5a79471444db",
  "WEB-DEPLOY-RAW.json":"055d7d80ae1d9787af980bf1c9d9dd643acacfc6ef3af8c2875133d88a82ff21",
  "WORKER-EXACT-DEPLOY-RAW.json":"66d81cd83606e968ca460a07e04d828ff76112cca39f500aabde6e8668aa8d43",
  "WORKER-SUSPENDED-SERVICE-RAW.json":"72510c36fa44f84807a6c4ec55ebd8eb17c42281052381f835a7877c1786d6d9",
  "WORKER-SWEEP-LOG-RAW.json":"aee63812f59d316c25b2724d5c4f803008905cf7a66d18099df0d132422f840f",
  "WORKER-WRONG-CANCELED-DEPLOY-RAW.json":"56b24010643d8f16ff73b7164370de615940cfda589b91fe6be578a834c77e2c",
};
const raw={};
for(const [name,expected] of Object.entries(rawHashes)){
  const bytes=read(name);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),expected,`${name} hash`);
  raw[name]=JSON.parse(bytes);
}
const message=(name)=>JSON.parse(raw[name].message);
const millis=(value)=>{const result=Date.parse(value);assert.ok(Number.isFinite(result),value);return result;};

assert.match(migration,/job_id='2c49a5c8-9465-4400-a214-159336a2c097'/);
assert.match(migration,/activation_deploy_sha='13c22bc7a3a340f0ea5f4bb0db9a905691676c77'/);
assert.match(migration,/database_binding_sha256='f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610'/);
assert.match(migration,/authorization_task_id='FINAL-POST-SWEEP-CANDIDATE-4-R3-20260901'/);
assert.match(migration,/evidence\.deploy_sha<>NEW\.activation_deploy_sha/);
assert.match(migration,/evidence\.lease_expires_at<=CURRENT_TIMESTAMP/);
assert.match(migration,/BEFORE UPDATE OR DELETE/);

assert.match(provider,/providerRuntimeSha\?: string/);
assert.match(provider,/const authorized = contract\.providerRuntimeSha \|\| contract\.deploySha/);
assert.match(provider,/assertNormalEvidenceRuntimeSha\(contract, env\.RENDER_GIT_COMMIT\)/);
assert.match(store,/LEFT JOIN normal_evidence_runtime_authorizations/);
assert.match(store,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
assert.match(store,/status:"ACCEPTED_NO_POST"/);
assert.doesNotMatch(store.slice(store.indexOf("jjGlowCandidate4RuntimePreflightNoPost")),/claimPost\(/);

assert.match(jobs,/postgresRuntimeBinding\(receiptClient\)/);
assert.match(jobs,/transactionOnClient\(receiptClient/);
assert.match(worker,/database_binding_sha256:sweep\.databaseBindingSha256/);
assert.match(worker,/candidate4_provider_runtime_preflight:candidate4ProviderRuntimePreflight/);

assert.match(authorizer,/BEGIN ISOLATION LEVEL SERIALIZABLE/);
assert.match(authorizer,/INSERT INTO normal_evidence_runtime_authorizations/);
assert.match(authorizer,/JJ_GLOW_PROVIDER_RUNTIME_AUTHORIZED_NO_POST/);
assert.match(authorizer,/lease_expires_at/);
assert.doesNotMatch(authorizer,/fetch\(|createTask|enqueueJob|claimPost|provider_tasks\s+INSERT/i);
assert.match(webDocker,/esbuild scripts\/staging-jj-glow-candidate4-runtime-authorize\.ts/);
assert.match(webDocker,/COPY --from=build[^\n]+staging-jj-glow-candidate4-runtime-authorize\.cjs/);
assert.match(webDocker,/test -f \/srv\/app\/scripts\/staging-jj-glow-candidate4-runtime-authorize\.cjs/);
assert.match(webDocker,/node --check \/srv\/app\/scripts\/staging-jj-glow-candidate4-runtime-authorize\.cjs/);

const webDeploy=raw["WEB-DEPLOY-RAW.json"];
assert.deepEqual([webDeploy.id,webDeploy.status,webDeploy.commit.id],["dep-daavv0btqb8s73ecfseg","live",RUNTIME]);

const authJob=raw["AUTH-JOB-RAW.json"];
assert.deepEqual([authJob.id,authJob.status],["job-dab00bf40ujc739dqaug","succeeded"]);
assert.equal(authJob.startCommand,`env JJ_GLOW_RUNTIME_AUTHORIZE_CONFIRM=${TASK} node scripts/staging-jj-glow-candidate4-runtime-authorize.cjs`);
const auth=message("AUTH-LOG-RAW.json");
assert.deepEqual({
  event:auth.event,runtime_sha:auth.runtime_sha,provider_runtime_sha:auth.provider_runtime_sha,
  database_binding_sha256:auth.database_binding_sha256,job_id:auth.job_id,
  authorization_task_id:auth.authorization_task_id,provider_posts:auth.provider_posts,
  provider_tasks:auth.provider_tasks,outputs:auth.outputs,publication:auth.publication,
  candidate_created:auth.candidate_created,mutation:auth.mutation,
},{event:"JJ_GLOW_PROVIDER_RUNTIME_AUTHORIZED_NO_POST",runtime_sha:RUNTIME,provider_runtime_sha:RUNTIME,
  database_binding_sha256:BINDING,job_id:JOB,authorization_task_id:TASK,provider_posts:0,
  provider_tasks:0,outputs:0,publication:false,candidate_created:false,
  mutation:"APPEND_ONLY_RUNTIME_AUTHORIZATION"});

const preJob=raw["PRE-READBACK-JOB-RAW.json"];
const postJob=raw["POST-READBACK-JOB-RAW.json"];
assert.deepEqual([preJob.id,preJob.status,postJob.id,postJob.status],
  ["job-dab011rtqb8s73ecn9f0","succeeded","job-dab03mc9v7es73blf5kg","succeeded"]);
const embedded=(command)=>command.match(/Buffer\.from\('([^']+)'/)[1];
assert.equal(embedded(preJob.startCommand),embedded(postJob.startCommand),"readbacks execute identical source");
assert.match(preJob.startCommand,/^env R3_READBACK_PHASE=pre-sweep /);
assert.match(postJob.startCommand,/^env R3_READBACK_PHASE=post-sweep /);

const pre=message("PRE-READBACK-LOG-RAW.json");
const post=message("POST-READBACK-LOG-RAW.json");
for(const [receipt,phase] of [[pre,"pre-sweep"],[post,"post-sweep"]]){
  assert.equal(receipt.event,"JJ_GLOW_CANDIDATE_4_R3_STATE_READBACK_PASS");
  assert.equal(receipt.phase,phase); assert.equal(receipt.runtime_sha,RUNTIME);
  assert.equal(receipt.database_binding_sha256,BINDING);
  assert.equal(receipt.transaction,"REPEATABLE READ READ ONLY");
  assert.equal(receipt.mutation,false); assert.equal(receipt.queue_paused,true);
  assert.deepEqual(receipt.queue_counts,{waiting:0,active:0,delayed:0,prioritized:0,failed:0,paused:2});
  assert.deepEqual([receipt.product_jobs,receipt.product_scripts],[2,2]);
  assert.deepEqual([
    receipt.candidate.state,receipt.candidate.provider_runtime_sha,
    receipt.candidate.database_binding_sha256,receipt.candidate.authorization_task_id,
    receipt.candidate.provider_post_count,receipt.candidate.provider_tasks,
    receipt.candidate.outputs,receipt.candidate.fyp_posted,receipt.candidate.post_plans,
    receipt.candidate.terminal_ledger,
  ],["QUEUED",RUNTIME,BINDING,TASK,0,0,0,0,0,0]);
  assert.equal(receipt.candidate.provider_task_id,null);
  assert.equal(receipt.candidate.output_url,null);
}
const stable=(receipt)=>{const clone=structuredClone(receipt);delete clone.phase;delete clone.evaluated_at;return clone;};
assert.deepEqual(stable(pre),stable(post),"sweep did not mutate the readback state");

const wrong=raw["WORKER-WRONG-CANCELED-DEPLOY-RAW.json"];
assert.deepEqual([wrong.id,wrong.status,wrong.commit.id],
  ["dep-dab024h42hec739ft9cg","canceled","46499ac5e345997b394e4ac522759e40fe2eae22"]);
const workerDeploy=raw["WORKER-EXACT-DEPLOY-RAW.json"];
assert.deepEqual([workerDeploy.id,workerDeploy.status,workerDeploy.commit.id],
  ["dep-dab0283tqb8s73ecra1g","live",RUNTIME]);
const sweep=message("WORKER-SWEEP-LOG-RAW.json");
assert.deepEqual({
  event:sweep.event,runtime_sha:sweep.runtime_sha,database_binding_sha256:sweep.database_binding_sha256,
  swept_jobs:sweep.swept_jobs,reconciled_ready_holds:sweep.reconciled_ready_holds,
  reconciled_promo_holds:sweep.reconciled_promo_holds,preflight:sweep.candidate4_provider_runtime_preflight,
},{event:"POSTGRES_STALE_SWEEP_COMPLETED",runtime_sha:RUNTIME,database_binding_sha256:BINDING,
  swept_jobs:0,reconciled_ready_holds:0,reconciled_promo_holds:0,
  preflight:{status:"ACCEPTED_NO_POST",job_id:JOB,provider_runtime_sha:RUNTIME,database_binding_sha256:BINDING}});

const suspended=raw["WORKER-SUSPENDED-SERVICE-RAW.json"];
assert.deepEqual([suspended.id,suspended.name,suspended.suspended],
  ["srv-d9n28ue417fc73ch2b60","racun-ai-staging-worker","suspended"]);
assert.ok(millis(webDeploy.finishedAt)<millis(auth.created_at));
assert.ok(millis(auth.created_at)<millis(pre.evaluated_at));
assert.ok(millis(pre.evaluated_at)<millis(workerDeploy.finishedAt));
assert.ok(millis(workerDeploy.finishedAt)<millis(sweep.started_at));
assert.ok(millis(sweep.completed_at)<millis(post.evaluated_at));
assert.ok(millis(post.evaluated_at)<millis(suspended.updatedAt));

console.log("CANDIDATE_4_R3_MANAGED_AUTHORIZATION_SWEEP_AND_SUSPENSION_EVIDENCE=PASS");
