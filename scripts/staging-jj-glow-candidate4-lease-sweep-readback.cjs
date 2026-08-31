/** Read-only Candidate #4 lease/sweep receipt from managed staging web. */
const { Pool } = require("pg");
const { Queue } = require("bullmq");
const PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const PREDECESSOR_ID = "55284f20-efb8-4b18-8a24-f90fc91af733";
const CANDIDATE_ID = "2c49a5c8-9465-4400-a214-159336a2c097";
const TASK = "FINAL-POST-SWEEP-CANDIDATE-4-20260901";

async function main() {
  if (process.env.RACUN_DEPLOY_ENV !== "staging" || process.env.RENDER_SERVICE_ID !== "srv-d9n28tijnfac73a87lt0") {
    throw new Error("CANDIDATE_4_LEASE_READBACK_RUNTIME_MISMATCH");
  }
  const phase = process.env.CANDIDATE4_READBACK_PHASE;
  if (!new Set(["pre-sweep","post-sweep"]).has(phase)) throw new Error("CANDIDATE_4_LEASE_READBACK_PHASE_INVALID");
  const pool = new Pool({connectionString:process.env.DATABASE_URL,max:1}), client = await pool.connect();
  let receipt;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const rows = (await client.query(`SELECT j.id,j.script_id,j.state,j.created_at,j.state_changed_at,
      j.provider_video,j.provider_voice,j.output_url,
      (SELECT count(*)::int FROM provider_tasks WHERE job_id=j.id) provider_tasks,
      (SELECT coalesce(sum(provider_post_count),0)::int FROM normal_representative_evidence_runs WHERE job_id=j.id) provider_posts,
      (SELECT count(*)::int FROM outputs WHERE job_id=j.id) outputs,
      (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=j.id AND posted_url IS NOT NULL) fyp_posted,
      (SELECT count(*)::int FROM post_plans WHERE job_id=j.id) post_plans,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='hold') holds,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='release') releases,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='capture') captures
      FROM jobs j WHERE j.id IN ($1,$2) ORDER BY j.id`,[PREDECESSOR_ID,CANDIDATE_ID])).rows;
    const evidence = (await client.query(`SELECT task_id,idempotency_key,job_id,deploy_sha,approved_script_sha256,
      state,provider_post_count,provider_task_id,artifact_key,actual_cost_usd,lease_kind,
      lease_last_progress_at,lease_expires_at,created_at,updated_at
      FROM normal_representative_evidence_runs WHERE job_id=$1`,[CANDIDATE_ID])).rows;
    const counts = (await client.query(`SELECT
      (SELECT count(*)::int FROM jobs WHERE product_id=$1) product_jobs,
      (SELECT count(*)::int FROM scripts WHERE product_id=$1) product_scripts`,[PRODUCT_ID])).rows[0];
    const predecessor=rows.find((row)=>row.id===PREDECESSOR_ID),candidate=rows.find((row)=>row.id===CANDIDATE_ID),ledger=evidence[0];
    const noEffects=(row)=>Number(row.provider_tasks)===0&&Number(row.provider_posts)===0&&Number(row.outputs)===0
      &&Number(row.fyp_posted)===0&&Number(row.post_plans)===0&&row.provider_video===null&&row.provider_voice===null&&row.output_url===null;
    const evaluatedAt=new Date(),lastProgress=new Date(candidate?.state_changed_at??candidate?.created_at),leaseExpires=new Date(ledger?.lease_expires_at);
    if(rows.length!==2||Number(counts.product_jobs)!==2||Number(counts.product_scripts)!==2
      ||!predecessor||predecessor.state!=="REFUNDED"||!noEffects(predecessor)||Number(predecessor.holds)!==1||Number(predecessor.releases)!==1||Number(predecessor.captures)!==0
      ||!candidate||candidate.state!=="QUEUED"||!noEffects(candidate)||Number(candidate.holds)!==1||Number(candidate.releases)!==0||Number(candidate.captures)!==0
      ||evidence.length!==1||ledger.task_id!==TASK||ledger.state!=="PREPOST_READY"||Number(ledger.provider_post_count)!==0
      ||ledger.provider_task_id!==null||ledger.artifact_key!==null||ledger.actual_cost_usd!==null
      ||ledger.lease_kind!=="ACTIVE_EVIDENCE_LEASE"||!(leaseExpires>evaluatedAt)
      ||!(evaluatedAt-lastProgress>30*60*1000)) throw new Error("CANDIDATE_4_LEASE_READBACK_STATE_MISMATCH");
    receipt={phase,runtime_sha:process.env.RENDER_GIT_COMMIT,transaction:"REPEATABLE READ READ ONLY",
      evaluated_at:evaluatedAt.toISOString(),candidate_age_seconds:(evaluatedAt-lastProgress)/1000,
      product_jobs:2,product_scripts:2,predecessor,candidate,evidence:ledger,mutation:false};
    await client.query("ROLLBACK");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); await pool.end(); }
  const queue = new Queue(process.env.REDIS_QUEUE_NAME||"racun-jobs",{connection:{url:process.env.REDIS_URL,maxRetriesPerRequest:null}});
  try {
    receipt.queue_paused=await queue.isPaused(); receipt.queue_counts=await queue.getJobCounts("waiting","active","delayed","prioritized","failed");
    if(receipt.queue_paused!==true||Number(receipt.queue_counts.active)!==0) throw new Error("CANDIDATE_4_QUEUE_NOT_SAFELY_PAUSED");
  } finally { await queue.close(); }
  console.log(JSON.stringify({event:"JJ_GLOW_CANDIDATE_4_LEASE_SWEEP_READBACK_PASS",...receipt}));
}
main().catch((error)=>{console.error("JJ_GLOW_CANDIDATE_4_LEASE_SWEEP_READBACK_FAIL",error.message);process.exit(1);});
