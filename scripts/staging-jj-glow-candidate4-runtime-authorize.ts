/** One append-only authorization binding Candidate #4's already-activated
 * evidence row to a later exact reviewed safe worker runtime. No candidate,
 * queue, provider, output, publication, or credit mutation is reachable. */
import type { PoolClient } from "pg";
import { config } from "../lib/config";
import { getPool } from "../lib/postgres/pool";
import { postgresRuntimeBinding } from "../lib/postgres/runtime-binding.cjs";
import {
  JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID, JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK,
  JJ_GLOW_CANDIDATE_4_RUNTIME_AUTHORIZATION_TASK,
} from "../lib/providers/normal-evidence";
import { JJ_GLOW_PRINCIPAL_ID, JJ_GLOW_STAGING_WEB_SERVICE_ID } from "../lib/staging-jj-glow-exact-admission";

const ACTIVATION_DEPLOY_SHA="13c22bc7a3a340f0ea5f4bb0db9a905691676c77";
const DATABASE_BINDING_SHA256="f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610";
const APPROVED_SCRIPT_SHA256="110198510c75de3dba61d57260dce12af7cb0f06c6a4ddfc2254479cb8f05e7c";

function runtimeSha(): string {
  const sha=process.env.RENDER_GIT_COMMIT?.trim();
  if (process.env.NODE_ENV!=="production" || process.env.RACUN_DEPLOY_ENV!=="staging"
      || process.env.RENDER_SERVICE_ID!==JJ_GLOW_STAGING_WEB_SERVICE_ID
      || process.env.RACUN_DB_RUNTIME!=="postgres" || config.storageMode!=="r2" || config.r2Bucket!=="bikinfyp-staging"
      || !sha || !/^[0-9a-f]{40}$/.test(sha) || sha===ACTIVATION_DEPLOY_SHA
      || process.env.JJ_GLOW_RUNTIME_AUTHORIZE_CONFIRM!==JJ_GLOW_CANDIDATE_4_RUNTIME_AUTHORIZATION_TASK) {
    throw new Error("JJ_GLOW_RUNTIME_AUTHORIZATION_ENVIRONMENT_MISMATCH");
  }
  return sha;
}

async function lockedAuthority(client: PoolClient) {
  const job=(await client.query(`SELECT j.state,j.provider_video,j.provider_voice,j.output_url,
      (SELECT count(*)::int FROM provider_tasks WHERE job_id=j.id) provider_tasks,
      (SELECT count(*)::int FROM outputs WHERE job_id=j.id) outputs,
      (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=j.id AND posted_url IS NOT NULL) fyp_posted,
      (SELECT count(*)::int FROM post_plans WHERE job_id=j.id) post_plans,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type='hold') holds,
      (SELECT count(*)::int FROM credit_ledger WHERE job_id=j.id AND type IN ('capture','release')) terminal_ledger
    FROM jobs j WHERE j.id=$1 FOR UPDATE`,[JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
  const evidence=(await client.query(`SELECT * FROM normal_representative_evidence_runs WHERE job_id=$1 FOR UPDATE`,
    [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
  if (!job || !evidence || job.state!=="QUEUED" || job.provider_video!==null || job.provider_voice!==null || job.output_url!==null
      || Number(job.provider_tasks)!==0 || Number(job.outputs)!==0 || Number(job.fyp_posted)!==0 || Number(job.post_plans)!==0
      || Number(job.holds)!==1 || Number(job.terminal_ledger)!==0
      || evidence.task_id!==JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK || evidence.deploy_sha!==ACTIVATION_DEPLOY_SHA
      || evidence.approved_script_sha256!==APPROVED_SCRIPT_SHA256 || evidence.state!=="PREPOST_READY"
      || Number(evidence.provider_post_count)!==0 || evidence.provider_task_id!==null || evidence.payload_sha256!==null
      || evidence.artifact_key!==null || evidence.actual_cost_usd!==null || evidence.lease_kind!=="ACTIVE_EVIDENCE_LEASE"
      || !evidence.lease_expires_at || Date.parse(evidence.lease_expires_at)<=Date.now()) {
    throw new Error("JJ_GLOW_RUNTIME_AUTHORIZATION_PRIOR_EFFECT_OR_AUTHORITY_MISMATCH");
  }
  return {job,evidence};
}

async function main() {
  const providerRuntimeSha=runtimeSha();
  const pool=getPool(config.databaseUrl),client=await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const binding=await postgresRuntimeBinding(client);
    if (binding.sha256!==DATABASE_BINDING_SHA256) throw new Error("JJ_GLOW_RUNTIME_AUTHORIZATION_DATABASE_BINDING_MISMATCH");
    await lockedAuthority(client);
    await client.query(`INSERT INTO normal_evidence_runtime_authorizations
      (job_id,evidence_task_id,activation_deploy_sha,provider_runtime_sha,database_binding_sha256,
       authorization_task_id,authorized_by,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
    [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID,JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK,ACTIVATION_DEPLOY_SHA,
      providerRuntimeSha,DATABASE_BINDING_SHA256,JJ_GLOW_CANDIDATE_4_RUNTIME_AUTHORIZATION_TASK,JJ_GLOW_PRINCIPAL_ID]);
    const authorization=(await client.query("SELECT * FROM normal_evidence_runtime_authorizations WHERE job_id=$1",
      [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
    await client.query("COMMIT");
    console.log(JSON.stringify({event:"JJ_GLOW_PROVIDER_RUNTIME_AUTHORIZED_NO_POST",transaction:"SERIALIZABLE",
      runtime_sha:providerRuntimeSha,database_binding_sha256:binding.sha256,job_id:JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID,
      evidence_task_id:authorization.evidence_task_id,activation_deploy_sha:authorization.activation_deploy_sha,
      provider_runtime_sha:authorization.provider_runtime_sha,authorization_task_id:authorization.authorization_task_id,
      authorized_by:authorization.authorized_by,created_at:authorization.created_at,
      provider_posts:0,provider_tasks:0,outputs:0,publication:false,candidate_created:false,mutation:"APPEND_ONLY_RUNTIME_AUTHORIZATION"}));
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release();await pool.end(); }
}

main().catch((error)=>{console.error("JJ_GLOW_RUNTIME_AUTHORIZATION_FAIL",error instanceof Error?error.message:String(error));process.exit(1);});
