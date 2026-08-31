/** Reviewed one-shot wrapper; runtime code remains the exact authorized worker SHA. */
import { Queue } from "bullmq";
import { assertRuntimeAuthSecretSafe } from "../lib/runtime/assert-runtime-auth-secret";
import { setTaskMemo } from "../lib/providers/task-memo";
import { pgTaskMemo } from "../lib/postgres/task-memo";
import { installNormalEvidenceStoreForRuntime } from "../lib/providers/normal-evidence";
import { pgNormalEvidenceStore } from "../lib/postgres/normal-evidence";
import { processPostgresJob } from "../lib/postgres/worker";

const JOB="2c49a5c8-9465-4400-a214-159336a2c097";
const RUNTIME="4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1";

async function main(){
  if(process.env.NODE_ENV!=="production"||process.env.RACUN_DEPLOY_ENV!=="staging"
    ||process.env.RENDER_SERVICE_ID!=="srv-d9n28ue417fc73ch2b60"||process.env.RENDER_GIT_COMMIT!==RUNTIME
    ||process.env.RACUN_DB_RUNTIME!=="postgres"||process.env.STORAGE_MODE!=="r2"
    ||process.env.R2_BUCKET!=="bikinfyp-staging"||!process.env.BYTEPLUS_ARK_API_KEY
    ||process.env.RACUN_WORKER_DETERMINISTIC==="1") throw new Error("CANDIDATE4_ONE_SHOT_RUNTIME_MISMATCH");
  assertRuntimeAuthSecretSafe();
  const queue=new Queue(process.env.REDIS_QUEUE_NAME||"racun-jobs",{connection:{url:process.env.REDIS_URL!,maxRetriesPerRequest:null}});
  const paused=await queue.isPaused(),counts=await queue.getJobCounts("waiting","active","delayed","prioritized","failed");
  await queue.close();
  if(!paused||Number(counts.active)!==0) throw new Error("CANDIDATE4_ONE_SHOT_QUEUE_NOT_PAUSED");
  setTaskMemo(pgTaskMemo);installNormalEvidenceStoreForRuntime(true,pgNormalEvidenceStore);
  await processPostgresJob(JOB,{retryViaQueue:true});
  console.log(JSON.stringify({event:"CANDIDATE4_ONE_SHOT_WORKER_EXIT",job_id:JOB,runtime_sha:RUNTIME,
    queue_paused:true,auto_retry:false,publication:false}));
}
main().catch(error=>{console.error("CANDIDATE4_ONE_SHOT_WORKER_FAIL",error.message);process.exit(1)});
