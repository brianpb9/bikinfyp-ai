/** Independent, read-only managed-runtime receipt for candidate #4. */
const { Pool } = require("pg");
const { postgresRuntimeBinding } = require(`${process.cwd()}/lib/postgres/runtime-binding.cjs`);

const TASK = "FINAL-POST-SWEEP-CANDIDATE-4-20260901";
const PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const PREDECESSOR_JOB_ID = "55284f20-efb8-4b18-8a24-f90fc91af733";
const PREDECESSOR_SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
const CANDIDATE_JOB_ID = "2c49a5c8-9465-4400-a214-159336a2c097";
const CANDIDATE_SCRIPT_ID = "ca32178f-2731-4234-bb07-48f24a2f2079";

async function main() {
  if (process.env.RACUN_DEPLOY_ENV !== "staging" || process.env.RENDER_SERVICE_ID !== "srv-d9n28tijnfac73a87lt0") {
    throw new Error("CANDIDATE_4_READBACK_RUNTIME_MISMATCH");
  }
  const expectedCorrelation = process.env.JJ_GLOW_LIFECYCLE_CORRELATION_ID;
  const expectedStateSha = process.env.JJ_GLOW_EXPECTED_STATE_SHA256;
  const expectedBinding = process.env.JJ_GLOW_EXPECTED_DATABASE_BINDING_SHA256;
  if (!/^[0-9a-f-]{36}$/.test(expectedCorrelation || "") || !/^[0-9a-f]{64}$/.test(expectedStateSha || "")
      || !/^[0-9a-f]{64}$/.test(expectedBinding || "")) throw new Error("CANDIDATE_4_READBACK_EXPECTATION_REQUIRED");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const binding = await postgresRuntimeBinding(client);
    const rows = (await client.query(
      `SELECT j.id,j.script_id,j.state,j.provider_video,j.provider_voice,j.output_url,
        (SELECT count(*)::int FROM jobs WHERE product_id=$1) product_job_count,
        (SELECT count(*)::int FROM scripts WHERE product_id=$1) product_script_count,
        (SELECT count(*)::int FROM jobs WHERE product_id=$1 AND script_id=$2) predecessor_job_count,
        (SELECT count(*)::int FROM jobs WHERE product_id=$1 AND script_id=$3) candidate4_job_count,
        (SELECT count(*)::int FROM scripts WHERE product_id=$1 AND id=$3) candidate4_script_count,
        (SELECT count(*)::int FROM provider_tasks WHERE job_id=j.id) provider_tasks,
        (SELECT coalesce(sum(provider_post_count),0)::int FROM normal_representative_evidence_runs WHERE job_id=j.id) provider_posts,
        (SELECT count(*)::int FROM outputs WHERE job_id=j.id) outputs,
        (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=j.id AND posted_url IS NOT NULL) fyp_posted,
        (SELECT count(*)::int FROM post_plans WHERE job_id=j.id) post_plans,
        (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='hold') holds,
        (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='release') releases,
        (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='capture') captures,
        (SELECT count(*)::int FROM normal_representative_evidence_runs WHERE job_id=$4) candidate4_evidence_rows,
        a.meta lifecycle_meta
       FROM jobs j JOIN audit_log a ON a.entity='jobs' AND a.entity_id=j.id AND a.action='candidate.lifecycle.created'
       WHERE j.id IN ($4,$5) ORDER BY j.id`,
      [PRODUCT_ID, PREDECESSOR_SCRIPT_ID, CANDIDATE_SCRIPT_ID, CANDIDATE_JOB_ID, PREDECESSOR_JOB_ID],
    )).rows;
    if (binding.sha256 !== expectedBinding || rows.length !== 2) throw new Error("CANDIDATE_4_READBACK_BINDING_OR_CARDINALITY");
    const predecessor = rows.find((row) => row.id === PREDECESSOR_JOB_ID);
    const candidate = rows.find((row) => row.id === CANDIDATE_JOB_ID);
    const meta = candidate && JSON.parse(candidate.lifecycle_meta);
    const noEffects = (row) => Number(row.provider_tasks) === 0 && Number(row.provider_posts) === 0
      && Number(row.outputs) === 0 && Number(row.fyp_posted) === 0 && Number(row.post_plans) === 0;
    if (!predecessor || predecessor.script_id !== PREDECESSOR_SCRIPT_ID || predecessor.state !== "REFUNDED"
        || predecessor.provider_video !== null || predecessor.provider_voice !== null || predecessor.output_url !== null
        || !noEffects(predecessor) || Number(predecessor.holds) !== 1 || Number(predecessor.releases) !== 1 || Number(predecessor.captures) !== 0
        || !candidate || candidate.script_id !== CANDIDATE_SCRIPT_ID || candidate.state !== "QUEUED"
        || candidate.provider_video !== null || candidate.provider_voice !== null || candidate.output_url !== null
        || !noEffects(candidate) || Number(candidate.holds) !== 1 || Number(candidate.releases) !== 0 || Number(candidate.captures) !== 0
        || Number(candidate.product_job_count) !== 2 || Number(candidate.product_script_count) !== 2
        || Number(candidate.predecessor_job_count) !== 1 || Number(candidate.candidate4_job_count) !== 1
        || Number(candidate.candidate4_script_count) !== 1 || Number(candidate.candidate4_evidence_rows) !== 0
        || meta.task !== TASK || meta.correlation_id !== expectedCorrelation
        || meta.post_commit_state_sha256 !== expectedStateSha || meta.final_candidate_ordinal !== 4
        || meta.max_canonical_candidates_created !== 4) throw new Error("CANDIDATE_4_READBACK_STATE_MISMATCH");
    await client.query("COMMIT");
    console.log(JSON.stringify({event:"JJ_GLOW_CANDIDATE_4_INDEPENDENT_STATE_READBACK_PASS",task:TASK,
      runtime_sha:process.env.RENDER_GIT_COMMIT,database_binding_sha256:binding.sha256,
      product_job_count:2,product_script_count:2,predecessor_job_count:1,candidate4_job_count:1,
      candidate4_script_count:1,candidate5_authorized:false,candidate5_present:false,
      predecessor:{job_id:PREDECESSOR_JOB_ID,state:"REFUNDED",provider_tasks:0,provider_posts:0,outputs:0,publication:false,holds:1,releases:1,captures:0},
      candidate4:{job_id:CANDIDATE_JOB_ID,script_id:CANDIDATE_SCRIPT_ID,state:"QUEUED",lifecycle_correlation_id:expectedCorrelation,
        post_commit_state_sha256:expectedStateSha,provider_tasks:0,provider_posts:0,outputs:0,publication:false,holds:1,releases:0,captures:0,evidence_rows:0},
      read_only:true,new_process:true,new_pool:true,fresh_connection:true}));
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error("CANDIDATE_4_STATE_READBACK_FAIL", error.message); process.exit(1); });
