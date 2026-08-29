/**
 * Read-only staging metadata freeze for NORMAL-REPRESENTATIVE-EVIDENCE.
 *
 * Usage (does not print DATABASE_URL, provider keys, raw prompts, or image bytes):
 *   NODE_ENV=production RACUN_DEPLOY_ENV=staging RACUN_DB_RUNTIME=postgres \
 *   RENDER_SERVICE_ID=<canonical-staging-worker> RENDER_GIT_COMMIT=<40-char-sha> \
 *   tsx scripts/normal-evidence-readonly-preflight.ts <job-id>
 */
import crypto from "node:crypto";
import { config } from "../lib/config";
import { getPool } from "../lib/postgres/pool";
import { parseJobReferenceManifest } from "../lib/job-reference-manifest";
import { parseJobProductSnapshot } from "../lib/job-product-snapshot";
import {
  NORMAL_EVIDENCE_AUTHORIZATION_SOURCE, NORMAL_EVIDENCE_DURATION_S, NORMAL_EVIDENCE_ESTIMATE_USD,
  NORMAL_EVIDENCE_ESTIMATED_TOKENS, NORMAL_EVIDENCE_FORMAT, NORMAL_EVIDENCE_MAX_USD, NORMAL_EVIDENCE_MODEL, NORMAL_EVIDENCE_RESOLUTION,
  NORMAL_EVIDENCE_USD_PER_M_TOKENS,
  NORMAL_EVIDENCE_TASK, expectedNormalEvidenceIdempotencyKey,
  assertNormalEvidenceManagedRuntime,
} from "../lib/providers/normal-evidence";

const jobId = process.argv[2]?.trim();
const deploySha = process.env.RENDER_GIT_COMMIT?.trim() ?? "";
if (!jobId) throw new Error("job-id wajib diberikan");
assertNormalEvidenceManagedRuntime({ runtime: process.env, databaseUrl: config.databaseUrl, storageMode: config.storageMode, storageBucket: config.r2Bucket });
if (!/^[0-9a-f]{40}$/.test(deploySha)) throw new Error("RENDER_GIT_COMMIT wajib exact 40-char SHA");
if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) throw new Error("DATABASE_URL PostgreSQL staging wajib tersedia");

const sha256 = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const pool = getPool(config.databaseUrl);
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const result = await client.query<{
    job_id: string; user_id: string; product_id: string; subject_id: string | null;
    format: string; duration_s: number; quality_tier: string; state: string; requires_approval: boolean;
    approved_reference_manifest: string; job_product_snapshot: string;
    output_url: string | null; output_rows: string; task_rows: string; evidence_rows: string; hold_rows: string; terminal_rows: string;
  }>(`SELECT j.id AS job_id,j.user_id,j.product_id,j.persona_id AS subject_id,j.format,j.duration_s,
             j.quality_tier,j.state,j.requires_approval,j.approved_reference_manifest,j.job_product_snapshot,j.output_url,
             (SELECT COUNT(*)::text FROM outputs o WHERE o.job_id=j.id) AS output_rows,
             (SELECT COUNT(*)::text FROM provider_tasks pt WHERE pt.job_id=j.id) AS task_rows,
             (SELECT COUNT(*)::text FROM normal_representative_evidence_runs ne WHERE ne.job_id=j.id) AS evidence_rows,
             (SELECT COUNT(*)::text FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type='hold') AS hold_rows,
             (SELECT COUNT(*)::text FROM credit_ledger cl WHERE cl.job_id=j.id AND cl.type IN ('capture','release')) AS terminal_rows
        FROM jobs j WHERE j.id=$1`, [jobId]);
  const row = result.rows[0];
  if (!row) throw new Error("NORMAL_EVIDENCE_JOB_NOT_FOUND");
  if (!row.subject_id) throw new Error("NORMAL_EVIDENCE_SUBJECT_NOT_FROZEN");
  if (row.state !== "QUEUED" || row.requires_approval) throw new Error("NORMAL_EVIDENCE_JOB_NOT_CLEAN_QUEUED");
  if (row.format !== NORMAL_EVIDENCE_FORMAT || Number(row.duration_s) !== NORMAL_EVIDENCE_DURATION_S || row.quality_tier !== "high_quality") {
    throw new Error("NORMAL_EVIDENCE_JOB_SHAPE_MISMATCH");
  }
  if (row.output_url || Number(row.output_rows) !== 0) throw new Error("NORMAL_EVIDENCE_ALREADY_PUBLIC_OR_OUTPUT_EXISTS");
  if (Number(row.task_rows) !== 0) throw new Error("NORMAL_EVIDENCE_PRIOR_PROVIDER_TASK_EXISTS");
  if (Number(row.evidence_rows) !== 0) throw new Error("NORMAL_EVIDENCE_LEDGER_ALREADY_EXISTS");
  if (Number(row.hold_rows) !== 1 || Number(row.terminal_rows) !== 0) throw new Error("NORMAL_EVIDENCE_CUSTOMER_LEDGER_NOT_REVERSIBLE");

  const manifest = parseJobReferenceManifest(row.approved_reference_manifest);
  const snapshot = parseJobProductSnapshot(row.job_product_snapshot, { requirePrice: true });
  const brand = snapshot.trustedBrand.value?.trim();
  if (!brand) throw new Error("NORMAL_EVIDENCE_BRAND_NOT_FROZEN");
  const frozen = {
    taskId: NORMAL_EVIDENCE_TASK,
    jobId: row.job_id,
    productId: row.product_id,
    subjectId: row.subject_id,
    referenceSha256: manifest.references[0].sha256,
    referenceManifestSha256: sha256(row.approved_reference_manifest),
    productSnapshotSha256: sha256(row.job_product_snapshot),
    deploySha,
    model: NORMAL_EVIDENCE_MODEL,
    category: snapshot.category,
    format: NORMAL_EVIDENCE_FORMAT,
    durationS: NORMAL_EVIDENCE_DURATION_S,
    resolution: NORMAL_EVIDENCE_RESOLUTION,
  };
  // Deliberately emit only frozen identifiers/digests and public product
  // classification—not raw prompt, manifest paths, URLs, image bytes, or env.
  console.log(JSON.stringify({
    verdict: "READ_ONLY_PREFLIGHT_PASS",
    ...frozen,
    userId: row.user_id,
    referenceBrand: brand,
    authorizationSource: NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,
    idempotencyKey: expectedNormalEvidenceIdempotencyKey(frozen),
    estimatedCostUsd: NORMAL_EVIDENCE_ESTIMATE_USD,
    estimatedOutputTokens: NORMAL_EVIDENCE_ESTIMATED_TOKENS,
    usdPerMillionTokens: NORMAL_EVIDENCE_USD_PER_M_TOKENS,
    maxCostUsd: NORMAL_EVIDENCE_MAX_USD,
    providerPostCount: 0,
    publication: "disabled",
  }, null, 2));
  await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
