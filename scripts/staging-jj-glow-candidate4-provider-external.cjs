/** Exact external one-shot artifact for the already-authorized 23fa runtime.
 * ATTEST_NO_POST and EXECUTE_EXACTLY_ONCE use these identical bytes; only the
 * explicit mode/confirmation environment differs. */
const crypto=require("node:crypto");
const root=process.cwd();
require("tsx/cjs");
const {Queue}=require("bullmq");
const {assertRuntimeAuthSecretSafe}=require(`${root}/lib/runtime/assert-runtime-auth-secret.ts`);
const {setTaskMemo}=require(`${root}/lib/providers/task-memo.ts`);
const {pgTaskMemo}=require(`${root}/lib/postgres/task-memo.ts`);
const {installNormalEvidenceStoreForRuntime}=require(`${root}/lib/providers/normal-evidence.ts`);
const {pgNormalEvidenceStore}=require(`${root}/lib/postgres/normal-evidence.ts`);
const {processPostgresJob}=require(`${root}/lib/postgres/worker.ts`);

const JOB="2c49a5c8-9465-4400-a214-159336a2c097";
const RUNTIME="23fa4923ec667a44ef8044e309140ee169864f88";
const WORKER_KEY_SHA256="e235f534009788cbcb817e86779919604b8cc4255c98d62e0ce13829587603ab";
const TASK="SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901";

async function main(){
  const mode=process.env.CANDIDATE4_PROVIDER_EXECUTION_MODE;
  const launcherSha=globalThis.__CANDIDATE4_EXTERNAL_LAUNCHER_SHA256;
  if(!["ATTEST_NO_POST","EXECUTE_EXACTLY_ONCE"].includes(mode)
    ||typeof launcherSha!=="string"||!/^[0-9a-f]{64}$/.test(launcherSha))
    throw new Error("CANDIDATE4_EXTERNAL_LAUNCHER_ENVELOPE_MISMATCH");
  if(process.env.NODE_ENV!=="production"||process.env.RACUN_DEPLOY_ENV!=="staging"
    ||process.env.RENDER_SERVICE_ID!=="srv-d9n28ue417fc73ch2b60"||process.env.RENDER_GIT_COMMIT!==RUNTIME
    ||process.env.RACUN_DB_RUNTIME!=="postgres"||process.env.STORAGE_MODE!=="r2"
    ||process.env.R2_BUCKET!=="bikinfyp-staging"||!process.env.BYTEPLUS_ARK_API_KEY
    ||process.env.RACUN_WORKER_DETERMINISTIC==="1") throw new Error("CANDIDATE4_EXTERNAL_LAUNCHER_RUNTIME_MISMATCH");
  if(crypto.createHash("sha256").update(process.env.BYTEPLUS_ARK_API_KEY).digest("hex")!==WORKER_KEY_SHA256)
    throw new Error("CANDIDATE4_EXTERNAL_LAUNCHER_WORKER_KEY_ATTESTATION_MISMATCH");
  assertRuntimeAuthSecretSafe();
  const queue=new Queue(process.env.REDIS_QUEUE_NAME||"racun-jobs",{connection:{url:process.env.REDIS_URL,maxRetriesPerRequest:null}});
  const paused=await queue.isPaused(),counts=await queue.getJobCounts("waiting","active","delayed","prioritized","failed");
  await queue.close();
  if(!paused||Number(counts.active)!==0) throw new Error("CANDIDATE4_EXTERNAL_LAUNCHER_QUEUE_NOT_PAUSED");
  setTaskMemo(pgTaskMemo);installNormalEvidenceStoreForRuntime(true,pgNormalEvidenceStore);
  if(mode==="ATTEST_NO_POST"){
    console.log(JSON.stringify({event:"CANDIDATE4_EXTERNAL_LAUNCHER_ATTESTED_NO_POST",launcher_sha256:launcherSha,
      runtime_sha:RUNTIME,job_id:JOB,key_sha256:WORKER_KEY_SHA256,queue_paused:true,queue_counts:counts,
      execution_mode:mode,provider_post:false,mutation:false,secret_value_output:false}));
    return;
  }
  if(process.env.CANDIDATE4_PROVIDER_EXECUTE_CONFIRM!==TASK)
    throw new Error("CANDIDATE4_EXTERNAL_LAUNCHER_EXECUTION_CONFIRMATION_MISSING");
  await processPostgresJob(JOB,{retryViaQueue:true});
  console.log(JSON.stringify({event:"CANDIDATE4_EXTERNAL_LAUNCHER_WORKER_EXIT",launcher_sha256:launcherSha,
    job_id:JOB,runtime_sha:RUNTIME,queue_paused:true,auto_retry:false,publication:false}));
}
main().catch(error=>{console.error("CANDIDATE4_EXTERNAL_LAUNCHER_FAIL",error.message);process.exit(1)});
