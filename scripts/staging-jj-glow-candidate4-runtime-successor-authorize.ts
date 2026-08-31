/** Append-only authorization for the reviewed runtime that contains the
 * Candidate #4 mixed PostgreSQL timestamp-type fix. This script cannot reach
 * candidate, queue, provider, output, publication, or credit mutation paths. */
import type { PoolClient } from "pg";
import { config } from "../lib/config";
import { getPool } from "../lib/postgres/pool";
import { postgresRuntimeBinding } from "../lib/postgres/runtime-binding.cjs";
import { JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID } from "../lib/providers/normal-evidence";
import { JJ_GLOW_PRINCIPAL_ID, JJ_GLOW_STAGING_WEB_SERVICE_ID } from "../lib/staging-jj-glow-exact-admission";

const PRIOR_RUNTIME_SHA="4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1";
const DATABASE_BINDING_SHA256="f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610";
const EXECUTION_TASK="SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901";

function authority() {
  const authorizerDeploySha=process.env.RENDER_GIT_COMMIT?.trim();
  const providerRuntimeSha=process.env.JJ_GLOW_PROVIDER_RUNTIME_TARGET_SHA?.trim();
  if (process.env.NODE_ENV!=="production" || process.env.RACUN_DEPLOY_ENV!=="staging"
      || process.env.RENDER_SERVICE_ID!==JJ_GLOW_STAGING_WEB_SERVICE_ID
      || process.env.RACUN_DB_RUNTIME!=="postgres" || config.storageMode!=="r2" || config.r2Bucket!=="bikinfyp-staging"
      || !authorizerDeploySha || !/^[0-9a-f]{40}$/.test(authorizerDeploySha)
      || !providerRuntimeSha || !/^[0-9a-f]{40}$/.test(providerRuntimeSha) || providerRuntimeSha===PRIOR_RUNTIME_SHA
      || providerRuntimeSha!==authorizerDeploySha
      || process.env.JJ_GLOW_RUNTIME_SUCCESSOR_AUTHORIZE_CONFIRM!==EXECUTION_TASK) {
    throw new Error("JJ_GLOW_RUNTIME_SUCCESSOR_AUTHORIZATION_ENVIRONMENT_MISMATCH");
  }
  return {authorizerDeploySha,providerRuntimeSha};
}

async function lockAndVerifyZeroEffect(client: PoolClient) {
  const row=(await client.query(`SELECT j.state,j.provider_video,j.provider_voice,j.output_url,
      e.state evidence_state,e.provider_post_count,e.provider_task_id,e.payload_sha256,e.artifact_key,e.actual_cost_usd,
      e.lease_kind,e.lease_expires_at,a.provider_runtime_sha prior_runtime_sha,a.database_binding_sha256,
      (SELECT count(*)::int FROM provider_tasks WHERE job_id=j.id) provider_tasks,
      (SELECT count(*)::int FROM outputs WHERE job_id=j.id) outputs,
      (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=j.id AND posted_url IS NOT NULL) publications,
      (SELECT count(*)::int FROM post_plans WHERE job_id=j.id) post_plans
    FROM jobs j JOIN normal_representative_evidence_runs e ON e.job_id=j.id
    JOIN normal_evidence_runtime_authorizations a ON a.job_id=j.id
    WHERE j.id=$1 FOR UPDATE OF j,e`,[JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
  if (!row || row.state!=="GENERATING_VISUAL" || row.provider_video!==null || row.provider_voice!==null || row.output_url!==null
      || row.evidence_state!=="PREPOST_READY" || Number(row.provider_post_count)!==0 || row.provider_task_id!==null
      || row.payload_sha256!==null || row.artifact_key!==null || row.actual_cost_usd!==null
      || row.lease_kind!=="ACTIVE_EVIDENCE_LEASE" || !row.lease_expires_at || Date.parse(row.lease_expires_at)<=Date.now()
      || row.prior_runtime_sha!==PRIOR_RUNTIME_SHA || row.database_binding_sha256!==DATABASE_BINDING_SHA256
      || Number(row.provider_tasks)!==0 || Number(row.outputs)!==0 || Number(row.publications)!==0 || Number(row.post_plans)!==0) {
    throw new Error("JJ_GLOW_RUNTIME_SUCCESSOR_PRIOR_EFFECT_OR_AUTHORITY_MISMATCH");
  }
}

async function main() {
  const {authorizerDeploySha,providerRuntimeSha}=authority();
  const pool=getPool(config.databaseUrl),client=await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const binding=await postgresRuntimeBinding(client);
    if (binding.sha256!==DATABASE_BINDING_SHA256) throw new Error("JJ_GLOW_RUNTIME_SUCCESSOR_DATABASE_BINDING_MISMATCH");
    await lockAndVerifyZeroEffect(client);
    await client.query(`INSERT INTO normal_evidence_runtime_successor_authorizations
      (job_id,prior_provider_runtime_sha,provider_runtime_sha,database_binding_sha256,
       authorization_task_id,authorized_by,authorizer_deploy_sha,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
    [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID,PRIOR_RUNTIME_SHA,providerRuntimeSha,DATABASE_BINDING_SHA256,
      EXECUTION_TASK,JJ_GLOW_PRINCIPAL_ID,authorizerDeploySha]);
    const result=(await client.query("SELECT * FROM normal_evidence_runtime_successor_authorizations WHERE job_id=$1",
      [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
    await client.query("COMMIT");
    console.log(JSON.stringify({event:"JJ_GLOW_PROVIDER_RUNTIME_SUCCESSOR_AUTHORIZED_NO_POST",transaction:"SERIALIZABLE",
      job_id:result.job_id,prior_provider_runtime_sha:result.prior_provider_runtime_sha,
      provider_runtime_sha:result.provider_runtime_sha,database_binding_sha256:result.database_binding_sha256,
      authorization_task_id:result.authorization_task_id,authorized_by:result.authorized_by,
      authorizer_deploy_sha:result.authorizer_deploy_sha,created_at:result.created_at,
      provider_posts:0,provider_tasks:0,outputs:0,publication:false,candidate_created:false,
      mutation:"APPEND_ONLY_RUNTIME_SUCCESSOR_AUTHORIZATION"}));
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release();await pool.end(); }
}

main().catch((error)=>{console.error("JJ_GLOW_RUNTIME_SUCCESSOR_AUTHORIZATION_FAIL",error instanceof Error?error.message:String(error));process.exit(1);});
