import crypto from "node:crypto";
import { config } from "../config";
import { getPool } from "./pool";
import {
  assertNormalEvidenceManagedRuntime, assertNormalEvidenceRuntimeSha,
  isJjGlowFinalEvidenceContract, jjGlowApprovedScriptSha256,
  JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID, JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK,
  type NormalEvidenceContract, type NormalEvidenceStore,
} from "../providers/normal-evidence";
import { assertNormalEvidenceReceiptMatchesArtifact } from "../media/normal-evidence-offline-qc";
import { normalEvidenceLeaseWindow } from "../normal-evidence-lease";
import { postgresRuntimeBinding } from "./runtime-binding.cjs";

const map = (row: Record<string, unknown>): NormalEvidenceContract => ({
  taskId: String(row.task_id), idempotencyKey: String(row.idempotency_key), jobId: String(row.job_id),
  userId: String(row.user_id), productId: String(row.product_id), subjectId: String(row.subject_id),
  referenceSha256: String(row.reference_sha256), referenceManifestSha256: String(row.reference_manifest_sha256),
  referenceBrand: String(row.reference_brand), authorizationSource: String(row.authorization_source),
  productSnapshotSha256: String(row.product_snapshot_sha256),
  approvedScriptSha256: row.approved_script_sha256 ? String(row.approved_script_sha256) : null,
  deploySha: String(row.deploy_sha),
  providerRuntimeSha: row.provider_runtime_sha ? String(row.provider_runtime_sha) : String(row.deploy_sha),
  model: String(row.model), category: String(row.category), format: String(row.format),
  resolution: String(row.resolution), durationS: Number(row.duration_s),
  estimatedCostUsd: Number(row.estimated_cost_usd), maxCostUsd: Number(row.max_cost_usd),
  providerPostCount: Number(row.provider_post_count), state: String(row.state),
  providerTaskId: row.provider_task_id ? String(row.provider_task_id) : null,
  payloadSha256: row.payload_sha256 ? String(row.payload_sha256) : null,
});

export const pgNormalEvidenceStore: NormalEvidenceStore = {
  async get(jobId) {
    const row = (await getPool(config.databaseUrl).query(
      `SELECT ne.*,ra.provider_runtime_sha
         FROM normal_representative_evidence_runs ne
         LEFT JOIN normal_evidence_runtime_authorizations ra ON ra.job_id=ne.job_id
        WHERE ne.job_id=$1`, [jobId]
    )).rows[0];
    return row ? map(row) : null;
  },
  async claimPost(jobId, payloadSha256) {
    const pool = getPool(config.databaseUrl);
    // This commit is the durable point of no return and occurs before the
    // network call. The unique job/task/idempotency constraints make 0 -> 1
    // the only possible outbound transition.
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const jobAuthority = (await client.query<{ state: string }>(
        "SELECT state FROM jobs WHERE id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!jobAuthority || ["READY", "FAILED", "REFUNDED"].includes(jobAuthority.state)) {
        await client.query("COMMIT");
        return { action: "STOP_NO_RETRY" as const };
      }
      const evidenceRaw = (await client.query(
        `SELECT *,
           (lease_kind='ACTIVE_EVIDENCE_LEASE'
             AND lease_last_progress_at IS NOT NULL
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at > CURRENT_TIMESTAMP) active_evidence_lease
           FROM normal_representative_evidence_runs WHERE job_id=$1 FOR UPDATE`, [jobId]
      )).rows[0];
      if (evidenceRaw && evidenceRaw.state === "PREPOST_READY" && Number(evidenceRaw.provider_post_count) === 0) {
        // Database time is authoritative and this row is locked. An expired
        // pre-provider lease must be reactivated explicitly; claimPost may not
        // silently revive it and spend before the periodic stale sweep runs.
        if (evidenceRaw.active_evidence_lease !== true) {
          await client.query("COMMIT");
          return { action: "STOP_NO_RETRY" as const };
        }
        const evidence = map(evidenceRaw);
        if (isJjGlowFinalEvidenceContract(evidence)) {
          const frozen = (await client.query(`SELECT s.*,j.provider_video,j.provider_voice,j.output_url,
            (SELECT count(*)::int FROM audit_log a WHERE a.entity='scripts' AND a.entity_id=s.id AND a.action='script.manual_staged') manual_audit_count,
            (SELECT json_build_object('actor',a.actor,'created_at',a.created_at,'meta',a.meta)
               FROM audit_log a WHERE a.entity='scripts' AND a.entity_id=s.id AND a.action='script.manual_staged'
               ORDER BY a.created_at,a.id LIMIT 1) manual_audit
            FROM jobs j JOIN scripts s ON s.id=j.script_id WHERE j.id=$1 FOR UPDATE OF j,s`, [jobId])).rows[0];
          if (!frozen || frozen.provider_video !== null || frozen.provider_voice !== null || frozen.output_url !== null) {
            throw new Error("JJ_GLOW_EVIDENCE_PRIOR_JOB_EFFECT");
          }
          if (Number(frozen.manual_audit_count) !== 1
              || jjGlowApprovedScriptSha256(frozen, frozen.manual_audit) !== evidence.approvedScriptSha256) {
            throw new Error("JJ_GLOW_EVIDENCE_SCRIPT_DIGEST_MISMATCH");
          }
        }
        const now = new Date().toISOString(), lease = normalEvidenceLeaseWindow(now);
        const claimed = await client.query(
          `UPDATE normal_representative_evidence_runs
              SET provider_post_count=1,state='POST_ATTEMPTED',payload_sha256=$2,post_attempted_at=$3,updated_at=$3,
                  lease_kind=$4,lease_last_progress_at=$3,lease_expires_at=$5
            WHERE job_id=$1 AND state='PREPOST_READY' AND provider_post_count=0
              AND lease_kind='ACTIVE_EVIDENCE_LEASE' AND lease_last_progress_at IS NOT NULL
              AND lease_expires_at IS NOT NULL AND lease_expires_at > CURRENT_TIMESTAMP
            RETURNING job_id`,
          [jobId,payloadSha256,now,lease.kind,lease.expiresAt]);
        if (claimed.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_POST_CLAIM_RACE");
        await client.query("COMMIT");
        return { action:"POST" as const };
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
    const row = (await pool.query(
      "SELECT state,provider_post_count,provider_task_id,payload_sha256 FROM normal_representative_evidence_runs WHERE job_id=$1",
      [jobId]
    )).rows[0];
    // Missing row and every ambiguous post-without-task state fail closed.
    if (!row) return { action: "STOP_NO_RETRY" as const };
    if (row.payload_sha256 !== payloadSha256) throw new Error("NORMAL_EVIDENCE_PAYLOAD_MISMATCH");
    if (Number(row.provider_post_count) === 1 && row.provider_task_id
        && ["TASK_BOUND", "PROVIDER_SUCCEEDED"].includes(String(row.state))) {
      return { action: "POLL_ONLY" as const, taskId: String(row.provider_task_id) };
    }
    await pool.query(
      `UPDATE normal_representative_evidence_runs
          SET state='STOP_NO_RETRY',stop_reason='AMBIGUOUS_POST_WITHOUT_TASK',updated_at=$2,
              lease_kind=NULL,lease_last_progress_at=NULL,lease_expires_at=NULL
        WHERE job_id=$1 AND state<>'CAPTURED_NO_PUBLICATION'`,
      [jobId, new Date().toISOString()]
    );
    return { action: "STOP_NO_RETRY" as const };
  },
  async bindTask(jobId, payloadSha256, taskId) {
    const client = await getPool(config.databaseUrl).connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const job = (await client.query<{ state: string }>("SELECT state FROM jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0];
      if (!job || ["READY", "FAILED", "REFUNDED"].includes(job.state)) throw new Error("NORMAL_EVIDENCE_TASK_BIND_JOB_TERMINAL");
      const now = new Date().toISOString(), lease = normalEvidenceLeaseWindow(now);
      const result = await client.query(
        `UPDATE normal_representative_evidence_runs
            SET state='TASK_BOUND',provider_task_id=$3,task_bound_at=$4,updated_at=$4,
                lease_kind=$5,lease_last_progress_at=$4,lease_expires_at=$6
          WHERE job_id=$1 AND state='POST_ATTEMPTED' AND provider_post_count=1 AND payload_sha256=$2 AND provider_task_id IS NULL`,
        [jobId, payloadSha256, taskId, now, lease.kind, lease.expiresAt]
      );
      if (result.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_TASK_BIND_AMBIGUOUS");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  },
  async recordProviderSuccess(jobId, input) {
    const client = await getPool(config.databaseUrl).connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const job = (await client.query<{ state: string }>("SELECT state FROM jobs WHERE id=$1 FOR UPDATE", [jobId])).rows[0];
      if (!job || ["READY", "FAILED", "REFUNDED"].includes(job.state)) throw new Error("NORMAL_EVIDENCE_SUCCESS_JOB_TERMINAL");
      const now = new Date().toISOString(), lease = normalEvidenceLeaseWindow(now);
      const result = await client.query(
        `UPDATE normal_representative_evidence_runs
            SET state='PROVIDER_SUCCEEDED',provider_usage_json=$2,actual_cost_usd=$3,provider_succeeded_at=$4,updated_at=$4,
                lease_kind=$6,lease_last_progress_at=$4,lease_expires_at=$7
          WHERE job_id=$1 AND state IN ('TASK_BOUND','PROVIDER_SUCCEEDED') AND provider_post_count=1 AND provider_task_id=$5 AND $3 <= max_cost_usd`,
        [jobId, JSON.stringify(input.usage ?? null), input.actualCostUsd, now, input.taskId, lease.kind, lease.expiresAt]
      );
      if (result.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_SUCCESS_CORRELATION_MISSING");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  },
  async captureNoPublication(jobId, input) {
    // Repeat the digest/receipt check at the durable boundary. The worker may
    // have checked earlier, but the store must never trust an arbitrary caller.
    assertNormalEvidenceReceiptMatchesArtifact(input.qc, input.artifactSha256);
    const client = await getPool(config.databaseUrl).connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const job = (await client.query<{ user_id: string; org_id: string | null; state: string; output_url: string | null }>(
        "SELECT user_id,org_id,state,output_url FROM jobs WHERE id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!job || job.output_url || ["READY", "FAILED", "REFUNDED"].includes(job.state)) {
        throw new Error("NORMAL_EVIDENCE_JOB_NOT_PRIVATE_ACTIVE");
      }
      const published = await client.query("SELECT 1 FROM outputs WHERE job_id=$1", [jobId]);
      if (published.rowCount) throw new Error("NORMAL_EVIDENCE_PUBLICATION_DETECTED");
      const now = new Date().toISOString();
      const frozen = await client.query(
        `UPDATE normal_representative_evidence_runs
            SET state='CAPTURED_NO_PUBLICATION',qc_json=$2,artifact_key=$3,retrieval_sha256=$4,
                correlation_json=$5,redaction_verified=FALSE,captured_at=$6,updated_at=$6,
                lease_kind=NULL,lease_last_progress_at=NULL,lease_expires_at=NULL
          WHERE job_id=$1 AND state='PROVIDER_SUCCEEDED' AND provider_post_count=1 AND provider_task_id=$7`,
        [jobId, JSON.stringify(input.qc), input.artifactKey, input.artifactSha256,
          JSON.stringify(input.correlation), now, input.taskId]
      );
      if (frozen.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_CAPTURE_NOT_FROZEN");

      // The evidence run is internal and delivers no customer output. Close
      // the customer's append-only ledger with a release—not capture—in the
      // same transaction that terminalizes the private evidence and job.
      if (job.org_id) await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [job.org_id]);
      else await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [job.user_id]);
      const terminal = await client.query("SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [jobId]);
      if (terminal.rowCount) throw new Error("NORMAL_EVIDENCE_CUSTOMER_LEDGER_ALREADY_TERMINAL");
      const held = Number((await client.query<{ held: string }>(
        "SELECT COALESCE(-SUM(delta),0) AS held FROM credit_ledger WHERE job_id=$1 AND type='hold'", [jobId]
      )).rows[0].held);
      if (!(held > 0)) throw new Error("NORMAL_EVIDENCE_CUSTOMER_HOLD_MISSING");
      await client.query(
        "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,$4,'release',$5,NULL,$6)",
        [crypto.randomUUID(), job.user_id, job.org_id, held, jobId, now]
      );
      const failed = await client.query(
        "UPDATE jobs SET state='FAILED',completed_at=$2,state_changed_at=$2 WHERE id=$1 AND state NOT IN ('READY','FAILED','REFUNDED')",
        [jobId, now]
      );
      if (failed.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_JOB_TERMINALIZATION_FAILED");
      await client.query(
        "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,'worker','job.transition','jobs',$2,$3,$4)",
        [crypto.randomUUID(), jobId, JSON.stringify({ to: "FAILED", reason: "NORMAL_EVIDENCE_CAPTURED_NO_PUBLICATION" }), now]
      );
      const refunded = await client.query("UPDATE jobs SET state='REFUNDED',state_changed_at=$2 WHERE id=$1 AND state='FAILED'", [jobId, now]);
      if (refunded.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_JOB_REFUND_TERMINALIZATION_FAILED");
      await client.query(
        `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES
          ($1,'worker','job.transition','jobs',$3,$4,$5),
          ($2,'worker','normal_evidence.private_capture','jobs',$3,$6,$5)`,
        [crypto.randomUUID(), crypto.randomUUID(), jobId,
          JSON.stringify({ to: "REFUNDED", refunded_credits: held }), now,
          JSON.stringify({ state: "REFUNDED", released_credits: held, publication: false })]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
  async settleStopNoRetry(jobId) {
    const client = await getPool(config.databaseUrl).connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const job = (await client.query<{ user_id: string; org_id: string | null; state: string }>(
        "SELECT user_id,org_id,state FROM jobs WHERE id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!job) throw new Error("NORMAL_EVIDENCE_STOP_JOB_MISSING");
      if (["READY", "FAILED", "REFUNDED"].includes(job.state)) throw new Error("NORMAL_EVIDENCE_STOP_JOB_ALREADY_TERMINAL");
      const evidence = (await client.query<{ state: string }>(
        "SELECT state FROM normal_representative_evidence_runs WHERE job_id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!evidence || evidence.state !== "STOP_NO_RETRY") throw new Error("NORMAL_EVIDENCE_STOP_STATE_REQUIRED");
      if (job.org_id) await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [job.org_id]);
      else await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [job.user_id]);
      const terminal = await client.query("SELECT 1 FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [jobId]);
      if (terminal.rowCount) throw new Error("NORMAL_EVIDENCE_CUSTOMER_LEDGER_ALREADY_TERMINAL");
      const held = Number((await client.query<{ held: string }>(
        "SELECT COALESCE(-SUM(delta),0) AS held FROM credit_ledger WHERE job_id=$1 AND type='hold'", [jobId]
      )).rows[0].held);
      if (!(held > 0)) throw new Error("NORMAL_EVIDENCE_CUSTOMER_HOLD_MISSING");
      const now = new Date().toISOString();
      await client.query(
        "INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,$4,'release',$5,NULL,$6)",
        [crypto.randomUUID(), job.user_id, job.org_id, held, jobId, now]
      );
      const failed = await client.query(
        "UPDATE jobs SET state='FAILED',completed_at=$2,state_changed_at=$2 WHERE id=$1 AND state NOT IN ('READY','FAILED','REFUNDED')",
        [jobId, now]
      );
      if (failed.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_STOP_FAILED_TRANSITION_MISSING");
      await client.query(
        "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,'worker','job.transition','jobs',$2,$3,$4)",
        [crypto.randomUUID(), jobId, JSON.stringify({ to: "FAILED", reason: "NORMAL_EVIDENCE_AMBIGUOUS_STOP_NO_RETRY" }), now]
      );
      const refunded = await client.query("UPDATE jobs SET state='REFUNDED',state_changed_at=$2 WHERE id=$1 AND state='FAILED'", [jobId, now]);
      if (refunded.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_STOP_REFUND_TRANSITION_MISSING");
      await client.query(
        `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES
          ($1,'worker','job.transition','jobs',$2,$3,$4),
          ($5,'worker','normal_evidence.stop_no_retry_settled','jobs',$2,$6,$4)`,
        [crypto.randomUUID(), jobId, JSON.stringify({ to: "REFUNDED", refunded_credits: held }), now,
          crypto.randomUUID(), JSON.stringify({ released_credits: held, provider_post_count: 1 })]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};

/** Read-only, actual-worker preflight for the one append-only Candidate #4
 * runtime authorization. It deliberately stops before payload construction,
 * claimPost, queue consumption, or any provider boundary. */
export async function jjGlowCandidate4RuntimePreflightNoPost(
  sweepDatabaseBindingSha256: string,
): Promise<null | { status: "ACCEPTED_NO_POST"; job_id: string; provider_runtime_sha: string; database_binding_sha256: string }> {
  const pool = getPool(config.databaseUrl), client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const binding = await postgresRuntimeBinding(client);
    if (binding.sha256 !== sweepDatabaseBindingSha256) throw new Error("JJ_GLOW_SWEEP_PREFLIGHT_DATABASE_BINDING_MISMATCH");
    const row = (await client.query(`SELECT ne.*,ra.provider_runtime_sha,ra.database_binding_sha256,
        j.state job_state,j.provider_video,j.provider_voice,j.output_url,
        (SELECT count(*)::int FROM provider_tasks pt WHERE pt.job_id=j.id) provider_tasks,
        (SELECT count(*)::int FROM outputs o WHERE o.job_id=j.id) outputs,
        (SELECT count(*)::int FROM fyp_snapshots f WHERE f.job_id=j.id AND f.posted_url IS NOT NULL) fyp_posted,
        (SELECT count(*)::int FROM post_plans pp WHERE pp.job_id=j.id) post_plans
      FROM normal_representative_evidence_runs ne
      JOIN jobs j ON j.id=ne.job_id
      LEFT JOIN normal_evidence_runtime_authorizations ra ON ra.job_id=ne.job_id
      WHERE ne.job_id=$1`, [JJ_GLOW_CANDIDATE_4_EVIDENCE_JOB_ID])).rows[0];
    if (!row?.provider_runtime_sha) { await client.query("ROLLBACK"); return null; }
    const contract = map(row);
    assertNormalEvidenceManagedRuntime({ databaseUrl:config.databaseUrl, storageMode:config.storageMode, storageBucket:config.r2Bucket });
    assertNormalEvidenceRuntimeSha(contract, process.env.RENDER_GIT_COMMIT);
    if (contract.taskId !== JJ_GLOW_CANDIDATE_4_EVIDENCE_TASK || contract.state !== "PREPOST_READY"
        || contract.providerPostCount !== 0 || contract.providerTaskId !== null
        || row.lease_kind !== "ACTIVE_EVIDENCE_LEASE" || !row.lease_expires_at || Date.parse(row.lease_expires_at) <= Date.now()
        || row.job_state !== "QUEUED" || row.provider_video !== null || row.provider_voice !== null || row.output_url !== null
        || Number(row.provider_tasks) !== 0 || Number(row.outputs) !== 0 || Number(row.fyp_posted) !== 0 || Number(row.post_plans) !== 0
        || row.database_binding_sha256 !== binding.sha256) throw new Error("JJ_GLOW_RUNTIME_PREFLIGHT_PRIOR_EFFECT_OR_AUTHORITY_MISMATCH");
    await client.query("ROLLBACK");
    return { status:"ACCEPTED_NO_POST",job_id:contract.jobId,provider_runtime_sha:contract.providerRuntimeSha!,database_binding_sha256:binding.sha256 };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
