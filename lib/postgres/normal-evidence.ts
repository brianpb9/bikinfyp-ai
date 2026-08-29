import crypto from "node:crypto";
import { config } from "../config";
import { getPool } from "./pool";
import type { NormalEvidenceContract, NormalEvidenceStore } from "../providers/normal-evidence";
import { assertNormalEvidenceReceiptMatchesArtifact } from "../media/normal-evidence-offline-qc";

const map = (row: Record<string, unknown>): NormalEvidenceContract => ({
  taskId: String(row.task_id), idempotencyKey: String(row.idempotency_key), jobId: String(row.job_id),
  userId: String(row.user_id), productId: String(row.product_id), subjectId: String(row.subject_id),
  referenceSha256: String(row.reference_sha256), referenceManifestSha256: String(row.reference_manifest_sha256),
  referenceBrand: String(row.reference_brand), authorizationSource: String(row.authorization_source),
  productSnapshotSha256: String(row.product_snapshot_sha256), deploySha: String(row.deploy_sha),
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
      "SELECT * FROM normal_representative_evidence_runs WHERE job_id=$1", [jobId]
    )).rows[0];
    return row ? map(row) : null;
  },
  async claimPost(jobId, payloadSha256) {
    const pool = getPool(config.databaseUrl);
    // This commit is the durable point of no return and occurs before the
    // network call. The unique job/task/idempotency constraints make 0 -> 1
    // the only possible outbound transition.
    const claimed = await pool.query(
      `UPDATE normal_representative_evidence_runs
          SET provider_post_count=1,state='POST_ATTEMPTED',payload_sha256=$2,post_attempted_at=$3,updated_at=$3
        WHERE job_id=$1 AND state='PREPOST_READY' AND provider_post_count=0
        RETURNING job_id`, [jobId, payloadSha256, new Date().toISOString()]
    );
    if (claimed.rowCount === 1) return { action: "POST" as const };
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
      "UPDATE normal_representative_evidence_runs SET state='STOP_NO_RETRY',stop_reason='AMBIGUOUS_POST_WITHOUT_TASK',updated_at=$2 WHERE job_id=$1 AND state<>'CAPTURED_NO_PUBLICATION'",
      [jobId, new Date().toISOString()]
    );
    return { action: "STOP_NO_RETRY" as const };
  },
  async bindTask(jobId, payloadSha256, taskId) {
    const result = await getPool(config.databaseUrl).query(
      `UPDATE normal_representative_evidence_runs SET state='TASK_BOUND',provider_task_id=$3,task_bound_at=$4,updated_at=$4
        WHERE job_id=$1 AND state='POST_ATTEMPTED' AND provider_post_count=1 AND payload_sha256=$2 AND provider_task_id IS NULL`,
      [jobId, payloadSha256, taskId, new Date().toISOString()]
    );
    if (result.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_TASK_BIND_AMBIGUOUS");
  },
  async recordProviderSuccess(jobId, input) {
    const result = await getPool(config.databaseUrl).query(
      `UPDATE normal_representative_evidence_runs
          SET state='PROVIDER_SUCCEEDED',provider_usage_json=$2,actual_cost_usd=$3,provider_succeeded_at=$4,updated_at=$4
        WHERE job_id=$1 AND state IN ('TASK_BOUND','PROVIDER_SUCCEEDED') AND provider_post_count=1 AND provider_task_id=$5 AND $3 <= max_cost_usd`,
      [jobId, JSON.stringify(input.usage ?? null), input.actualCostUsd, new Date().toISOString(), input.taskId]
    );
    if (result.rowCount !== 1) throw new Error("NORMAL_EVIDENCE_SUCCESS_CORRELATION_MISSING");
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
                correlation_json=$5,redaction_verified=FALSE,captured_at=$6,updated_at=$6
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
      const evidence = (await client.query<{ state: string }>(
        "SELECT state FROM normal_representative_evidence_runs WHERE job_id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!evidence || evidence.state !== "STOP_NO_RETRY") throw new Error("NORMAL_EVIDENCE_STOP_STATE_REQUIRED");
      const job = (await client.query<{ user_id: string; org_id: string | null; state: string }>(
        "SELECT user_id,org_id,state FROM jobs WHERE id=$1 FOR UPDATE", [jobId]
      )).rows[0];
      if (!job) throw new Error("NORMAL_EVIDENCE_STOP_JOB_MISSING");
      if (["READY", "FAILED", "REFUNDED"].includes(job.state)) throw new Error("NORMAL_EVIDENCE_STOP_JOB_ALREADY_TERMINAL");
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
