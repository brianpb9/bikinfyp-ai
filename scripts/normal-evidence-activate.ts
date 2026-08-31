/**
 * Explicit staging activation. This is the ONLY writer that creates the
 * PREPOST_READY row; the read-only preflight never locks or mutates.
 *
 * Run from the canonical managed staging worker shell only:
 *   NORMAL_EVIDENCE_ACTIVATE_CONFIRM=NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829 \
 *   tsx scripts/normal-evidence-activate.ts <job-id>
 *
 * It performs a fresh SERIALIZABLE/FOR UPDATE revalidation and inserts the
 * durable run contract atomically. It does not enqueue, POST, or spend.
 */
import crypto from "node:crypto";
import { config } from "../lib/config";
import { getPool } from "../lib/postgres/pool";
import { parseJobReferenceManifest } from "../lib/job-reference-manifest";
import { parseJobProductSnapshot } from "../lib/job-product-snapshot";
import {
  NORMAL_EVIDENCE_AUTHORIZATION_SOURCE, NORMAL_EVIDENCE_DURATION_S, NORMAL_EVIDENCE_ESTIMATE_USD,
  NORMAL_EVIDENCE_FORMAT, NORMAL_EVIDENCE_MAX_USD, NORMAL_EVIDENCE_MODEL, NORMAL_EVIDENCE_RESOLUTION,
  NORMAL_EVIDENCE_TASK, assertNormalEvidenceManagedRuntime, expectedNormalEvidenceIdempotencyKey,
} from "../lib/providers/normal-evidence";

const jobId = process.argv[2]?.trim();
const deploySha = process.env.RENDER_GIT_COMMIT?.trim() ?? "";
if (!jobId) throw new Error("job-id wajib diberikan");
if (process.env.NORMAL_EVIDENCE_ACTIVATE_CONFIRM !== NORMAL_EVIDENCE_TASK) throw new Error("NORMAL_EVIDENCE_ACTIVATION_NOT_CONFIRMED");
assertNormalEvidenceManagedRuntime({ runtime: process.env, databaseUrl: config.databaseUrl, storageMode: config.storageMode, storageBucket: config.r2Bucket });
if (!/^[0-9a-f]{40}$/.test(deploySha)) throw new Error("RENDER_GIT_COMMIT wajib exact 40-char SHA");

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const pool = getPool(config.databaseUrl);
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  const result = await client.query<{
    job_id: string; user_id: string; product_id: string; subject_id: string | null; org_id: string | null;
    format: string; duration_s: number; quality_tier: string; state: string; requires_approval: boolean;
    approved_reference_manifest: string; job_product_snapshot: string; output_url: string | null;
    output_rows: string; task_rows: string; evidence_rows: string; hold_rows: string; terminal_rows: string;
  }>(`SELECT j.id AS job_id,j.user_id,j.product_id,j.persona_id AS subject_id,j.org_id,j.format,j.duration_s,
             j.quality_tier,j.state,j.requires_approval,j.approved_reference_manifest,j.job_product_snapshot,j.output_url,
             (SELECT COUNT(*)::text FROM outputs o WHERE o.job_id=j.id) AS output_rows,
             (SELECT COUNT(*)::text FROM provider_tasks pt WHERE pt.job_id=j.id) AS task_rows,
             (SELECT COUNT(*)::text FROM normal_representative_evidence_runs ne WHERE ne.job_id=j.id) AS evidence_rows,
             (SELECT COUNT(*)::text FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type='hold') AS hold_rows,
             (SELECT COUNT(*)::text FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type IN ('capture','release')) AS terminal_rows
        FROM jobs j WHERE j.id=$1 FOR UPDATE`, [jobId]);
  const row = result.rows[0];
  if (!row) throw new Error("NORMAL_EVIDENCE_JOB_NOT_FOUND");
  if (!row.subject_id) throw new Error("NORMAL_EVIDENCE_SUBJECT_NOT_FROZEN");
  if (row.state !== "QUEUED" || row.requires_approval) throw new Error("NORMAL_EVIDENCE_JOB_NOT_CLEAN_QUEUED");
  if (row.format !== NORMAL_EVIDENCE_FORMAT || Number(row.duration_s) !== NORMAL_EVIDENCE_DURATION_S || row.quality_tier !== "high_quality") throw new Error("NORMAL_EVIDENCE_JOB_SHAPE_MISMATCH");
  if (row.output_url || Number(row.output_rows) || Number(row.task_rows) || Number(row.evidence_rows)) throw new Error("NORMAL_EVIDENCE_PRIOR_EFFECT_EXISTS");
  if (Number(row.hold_rows) !== 1 || Number(row.terminal_rows) !== 0) throw new Error("NORMAL_EVIDENCE_CUSTOMER_LEDGER_NOT_REVERSIBLE");

  const manifest = parseJobReferenceManifest(row.approved_reference_manifest);
  const snapshot = parseJobProductSnapshot(row.job_product_snapshot, { requirePrice: true });
  const brand = snapshot.trustedBrand.value?.trim();
  if (!brand) throw new Error("NORMAL_EVIDENCE_BRAND_NOT_FROZEN");
  const frozen = {
    taskId: NORMAL_EVIDENCE_TASK, jobId: row.job_id, productId: row.product_id, subjectId: row.subject_id,
    referenceSha256: manifest.references[0].sha256,
    referenceManifestSha256: sha256(row.approved_reference_manifest),
    productSnapshotSha256: sha256(row.job_product_snapshot), deploySha, model: NORMAL_EVIDENCE_MODEL,
    approvedScriptSha256: null,
    category: snapshot.category, format: NORMAL_EVIDENCE_FORMAT, durationS: NORMAL_EVIDENCE_DURATION_S,
    resolution: NORMAL_EVIDENCE_RESOLUTION,
  };
  const idempotencyKey = expectedNormalEvidenceIdempotencyKey(frozen);
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO normal_representative_evidence_runs
      (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
       reference_brand,authorization_source,product_snapshot_sha256,deploy_sha,model,category,format,duration_s,
       resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,0,'PREPOST_READY',$20,$20)`,
    [NORMAL_EVIDENCE_TASK, idempotencyKey, row.job_id, row.user_id, row.product_id, row.subject_id,
      frozen.referenceSha256, frozen.referenceManifestSha256, brand, NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,
      frozen.productSnapshotSha256, deploySha, NORMAL_EVIDENCE_MODEL, snapshot.category, NORMAL_EVIDENCE_FORMAT,
      NORMAL_EVIDENCE_DURATION_S, NORMAL_EVIDENCE_RESOLUTION, NORMAL_EVIDENCE_ESTIMATE_USD,
      NORMAL_EVIDENCE_MAX_USD, now]
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ verdict: "ACTIVATED_NO_POST", taskId: NORMAL_EVIDENCE_TASK, jobId, deploySha,
    idempotencyKey, referenceSha256: frozen.referenceSha256, referenceManifestSha256: frozen.referenceManifestSha256,
    productSnapshotSha256: frozen.productSnapshotSha256, publication: "disabled" }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
