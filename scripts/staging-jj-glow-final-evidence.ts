/**
 * Exact-candidate metadata freeze and activation for the one authorized JJ
 * GLOW staging provider POST. `preflight` is DB/R2 read-only. `activate`
 * repeats every check under SERIALIZABLE locks and creates only the durable
 * PREPOST_READY ledger; it never enqueues or calls a provider.
 */
import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../lib/config";
import { parseJobReferenceManifest } from "../lib/job-reference-manifest";
import { createJobProductSnapshotRaw, parseJobProductSnapshot } from "../lib/job-product-snapshot";
import { getPool } from "../lib/postgres/pool";
import {
  JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256, JJ_GLOW_PRINCIPAL_ID, JJ_GLOW_PRODUCT_ID,
  JJ_GLOW_SCRIPT_ID, JJ_GLOW_CANDIDATE_4_SCRIPT_ID, JJ_GLOW_CANDIDATE_4_TASK,
  JJ_GLOW_STAGING_WEB_SERVICE_ID, assertJjGlowLockedProductState,
  jjGlowLifecycleStateSha256,
} from "../lib/staging-jj-glow-exact-admission";
import { mediaStorage } from "../lib/storage";
import { verifyStagingReferenceRightsBinding } from "../lib/staging-reference-rights";
import {
  JJ_GLOW_FINAL_EVIDENCE_JOB_ID, JJ_GLOW_FINAL_EVIDENCE_REFERENCE_SHA256,
  JJ_GLOW_FINAL_EVIDENCE_TASK, NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,
  NORMAL_EVIDENCE_DURATION_S, NORMAL_EVIDENCE_ESTIMATE_USD, NORMAL_EVIDENCE_MAX_USD,
  NORMAL_EVIDENCE_MODEL, NORMAL_EVIDENCE_RESOLUTION, expectedNormalEvidenceIdempotencyKey,
  jjGlowApprovedScriptSha256,
} from "../lib/providers/normal-evidence";
import { normalEvidenceLeaseWindow } from "../lib/normal-evidence-lease";

const { postgresRuntimeBinding } = require("../lib/postgres/runtime-binding.cjs") as {
  postgresRuntimeBinding(client: PoolClient): Promise<{sha256:string}>;
};
const EXPECTED_DATABASE_BINDING_SHA256 = "6d8f03e28a15f4f6fe729387c6f8a7e94645853d6729fd3c908a636b1d47683c";
const EXPECTED_STATE_SHA256 = "c1722c6d967df3071be9449a3303fdf45a5e38dd339a54081375b7adb0aba58d";
const EXPECTED_CORRELATION_ID = "ee52cb72-6e2f-4a50-82c5-2f1158a88de0";
const EXPECTED_RECEIPT_SHA256 = "ca3906a381e6d299bc46fe62aeefbc3bd9b4183a6ff59c4f3cde2ca8f94788c3";
const sha256 = (value: string | Buffer) => crypto.createHash("sha256").update(value).digest("hex");
const CANDIDATE_4_MODE = process.env.JJ_GLOW_EVIDENCE_CANDIDATE_ORDINAL === "4";
const EVIDENCE_TASK = CANDIDATE_4_MODE ? JJ_GLOW_CANDIDATE_4_TASK : JJ_GLOW_FINAL_EVIDENCE_TASK;
const EVIDENCE_SCRIPT_ID = CANDIDATE_4_MODE ? JJ_GLOW_CANDIDATE_4_SCRIPT_ID : JJ_GLOW_SCRIPT_ID;
const EVIDENCE_JOB_ID = CANDIDATE_4_MODE ? process.env.JJ_GLOW_EXPECTED_JOB_ID?.trim() : JJ_GLOW_FINAL_EVIDENCE_JOB_ID;
const EVIDENCE_CORRELATION_ID = CANDIDATE_4_MODE ? process.env.JJ_GLOW_LIFECYCLE_CORRELATION_ID?.trim() : EXPECTED_CORRELATION_ID;
const EVIDENCE_STATE_SHA256 = CANDIDATE_4_MODE ? process.env.JJ_GLOW_EXPECTED_STATE_SHA256?.trim() : EXPECTED_STATE_SHA256;
const EVIDENCE_DATABASE_BINDING_SHA256 = CANDIDATE_4_MODE
  ? process.env.JJ_GLOW_EXPECTED_DATABASE_BINDING_SHA256?.trim()
  : EXPECTED_DATABASE_BINDING_SHA256;

function assertRuntime() {
  if (process.env.NODE_ENV !== "production" || process.env.RACUN_DEPLOY_ENV !== "staging"
      || process.env.RENDER_SERVICE_ID !== JJ_GLOW_STAGING_WEB_SERVICE_ID
      || process.env.RACUN_DB_RUNTIME !== "postgres" || config.storageMode !== "r2"
      || config.r2Bucket !== "bikinfyp-staging" || !/^[0-9a-f]{40}$/.test(process.env.RENDER_GIT_COMMIT ?? "")) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_RUNTIME_MISMATCH");
  }
}

async function inspect(client: PoolClient, lock: boolean) {
  if (!EVIDENCE_JOB_ID || !EVIDENCE_CORRELATION_ID || !EVIDENCE_STATE_SHA256
      || !/^[0-9a-f]{64}$/.test(EVIDENCE_DATABASE_BINDING_SHA256 ?? "")) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_EXPECTED_LINEAGE_REQUIRED");
  }
  const suffix = lock ? " FOR UPDATE" : "";
  const job = (await client.query(`SELECT * FROM jobs WHERE id=$1${suffix}`, [EVIDENCE_JOB_ID])).rows[0];
  const product = (await client.query(`SELECT * FROM products WHERE id=$1${suffix}`, [JJ_GLOW_PRODUCT_ID])).rows[0];
  const script = (await client.query(`SELECT * FROM scripts WHERE id=$1${suffix}`, [EVIDENCE_SCRIPT_ID])).rows[0];
  if (!job || !product || !script || !job.persona_id) throw new Error("JJ_GLOW_FINAL_EVIDENCE_CROSS_ROW_MISSING");
  const persona = (await client.query(`SELECT * FROM personas WHERE id=$1${suffix}`, [job.persona_id])).rows[0];
  if (!persona) throw new Error("JJ_GLOW_FINAL_EVIDENCE_PERSONA_MISSING");
  const lifecycle = (await client.query(
    "SELECT actor,created_at,meta FROM audit_log WHERE entity='jobs' AND entity_id=$1 AND action='candidate.lifecycle.created'",
    [EVIDENCE_JOB_ID],
  )).rows;
  const counts = (await client.query(`SELECT
    (SELECT count(*)::int FROM scripts WHERE product_id=$1) script_count,
    (SELECT count(*)::int FROM jobs WHERE product_id=$1) job_count,
    (SELECT count(*)::int FROM provider_tasks WHERE job_id=$2) provider_tasks,
    (SELECT count(*)::int FROM outputs WHERE job_id=$2) outputs,
    (SELECT count(*)::int FROM fyp_snapshots WHERE job_id=$2 AND posted_url IS NOT NULL) fyp_posted,
    (SELECT count(*)::int FROM post_plans WHERE job_id=$2) post_plans,
    (SELECT count(*)::int FROM normal_representative_evidence_runs WHERE job_id=$2) evidence_rows,
    (SELECT count(*)::int FROM audit_log WHERE entity_id IN ($1,$2)
      AND action IN ('candidate.lifecycle.deleted','candidate.lifecycle.superseded')) lifecycle_mutations,
    (SELECT count(*)::int FROM credit_ledger WHERE job_id=$2 AND type='hold') hold_rows,
    (SELECT count(*)::int FROM credit_ledger WHERE job_id=$2 AND type IN ('capture','release')) terminal_rows`,
    [JJ_GLOW_PRODUCT_ID, EVIDENCE_JOB_ID])).rows[0];

  assertJjGlowLockedProductState(product, JJ_GLOW_EXPECTED_PRODUCT_STATE_SHA256);
  if (job.user_id !== JJ_GLOW_PRINCIPAL_ID || job.product_id !== JJ_GLOW_PRODUCT_ID || job.script_id !== EVIDENCE_SCRIPT_ID
      || job.org_id !== null || job.state !== "QUEUED" || job.format !== "hands_only"
      || job.provider_video !== null || job.provider_voice !== null || job.output_url !== null
      || job.quality_tier !== "high_quality" || Number(job.duration_s) !== 15 || job.requires_approval !== false
      || script.product_id !== JJ_GLOW_PRODUCT_ID || script.job_id !== EVIDENCE_JOB_ID
      || !script.approved_by_user_at || persona.user_id !== JJ_GLOW_PRINCIPAL_ID || persona.creator_category !== "lokal") {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_CROSS_ROW_MISMATCH");
  }
  const validation = JSON.parse(script.validation_result);
  if (validation.passed !== true || validation.script_source !== "manual") throw new Error("JJ_GLOW_FINAL_EVIDENCE_SCRIPT_NOT_APPROVED_MANUAL");
  if (lifecycle.length !== 1 || lifecycle[0].actor !== JJ_GLOW_PRINCIPAL_ID) throw new Error("JJ_GLOW_FINAL_EVIDENCE_LIFECYCLE_CARDINALITY");
  const manualAuditRows = (await client.query(
    "SELECT actor,created_at,meta FROM audit_log WHERE entity='scripts' AND entity_id=$1 AND action='script.manual_staged' ORDER BY created_at,id",
    [EVIDENCE_SCRIPT_ID],
  )).rows;
  if (manualAuditRows.length !== 1 || manualAuditRows[0].actor !== JJ_GLOW_PRINCIPAL_ID) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_MANUAL_AUDIT_CARDINALITY");
  }
  const approvedScriptSha256 = jjGlowApprovedScriptSha256(script, manualAuditRows[0]);
  const lifecycleMeta = JSON.parse(lifecycle[0].meta);
  const lifecycleState = {schema:lifecycleMeta.schema,correlation_id:EVIDENCE_CORRELATION_ID,
    job_id:job.id,product_id:product.id,script_id:script.id,create_actor:JJ_GLOW_PRINCIPAL_ID,
    create_timestamp:lifecycleMeta.create_timestamp,transaction_id:lifecycleMeta.transaction_commit_receipt?.transaction_id,
    state:job.state,provider_task_count:Number(counts.provider_tasks),hold_count:Number(counts.hold_rows),
    approved_reference_manifest_sha256:sha256(job.approved_reference_manifest),
    job_product_snapshot_sha256:sha256(job.job_product_snapshot),database_binding_sha256:EVIDENCE_DATABASE_BINDING_SHA256};
  if (lifecycleMeta.task !== EVIDENCE_TASK || lifecycleMeta.correlation_id !== EVIDENCE_CORRELATION_ID
      || lifecycleMeta.post_commit_state_sha256 !== EVIDENCE_STATE_SHA256 || lifecycleMeta.append_only !== true
      || jjGlowLifecycleStateSha256(lifecycleState) !== EVIDENCE_STATE_SHA256) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_LIFECYCLE_MISMATCH");
  }
  const expectedCandidateCount = CANDIDATE_4_MODE ? 2 : 1;
  if (Number(counts.script_count) !== expectedCandidateCount || Number(counts.job_count) !== expectedCandidateCount || Number(counts.provider_tasks) !== 0
      || Number(counts.outputs) !== 0 || Number(counts.fyp_posted) !== 0 || Number(counts.post_plans) !== 0
      || Number(counts.evidence_rows) !== 0 || Number(counts.lifecycle_mutations) !== 0
      || Number(counts.hold_rows) !== 1 || Number(counts.terminal_rows) !== 0) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_PRIOR_EFFECT_OR_CARDINALITY");
  }

  const binding = await postgresRuntimeBinding(client);
  if (binding.sha256 !== EVIDENCE_DATABASE_BINDING_SHA256) throw new Error("JJ_GLOW_FINAL_EVIDENCE_DATABASE_BINDING_MISMATCH");
  const manifest = parseJobReferenceManifest(job.approved_reference_manifest);
  const snapshot = parseJobProductSnapshot(job.job_product_snapshot, { requirePrice:true });
  const expectedSnapshotRaw = createJobProductSnapshotRaw(product);
  const productImages = JSON.parse(product.images) as unknown[];
  const productRights = JSON.parse(product.raw_meta).staging_reference_rights;
  if (manifest.references.length !== 1 || manifest.references[0].sha256 !== JJ_GLOW_FINAL_EVIDENCE_REFERENCE_SHA256
      || !manifest.stagingReferenceRights || manifest.stagingReferenceRights.binding.receipt_sha256 !== EXPECTED_RECEIPT_SHA256
      || productImages.length !== 1 || productImages[0] !== manifest.references[0].rel
      || productRights.reference_key !== manifest.stagingReferenceRights.binding.reference_key
      || productRights.reference_sha256 !== manifest.stagingReferenceRights.binding.reference_sha256
      || productRights.receipt_key !== manifest.stagingReferenceRights.binding.receipt_key
      || productRights.receipt_sha256 !== manifest.stagingReferenceRights.binding.receipt_sha256
      || snapshot.trustedBrand.value !== "JJ GLOW" || expectedSnapshotRaw !== job.job_product_snapshot) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_FROZEN_METADATA_MISMATCH");
  }
  const ref = manifest.references[0];
  const rights = manifest.stagingReferenceRights.binding;
  const [sourceObject, snapshotObject, receiptObject] = await Promise.all([
    mediaStorage().get(ref.rel), mediaStorage().get(ref.snapshotRel), mediaStorage().get(rights.receipt_key),
  ]);
  if (!sourceObject || !snapshotObject || !receiptObject
      || sha256(sourceObject.body) !== ref.sha256 || sha256(snapshotObject.body) !== ref.sha256
      || sha256(receiptObject.body) !== rights.receipt_sha256) throw new Error("JJ_GLOW_FINAL_EVIDENCE_DB_R2_DIGEST_MISMATCH");
  await verifyStagingReferenceRightsBinding({ binding:rights, referenceRel:ref.rel, now:new Date().toISOString() });

  const frozen = {
    taskId:EVIDENCE_TASK, jobId:job.id, productId:product.id, subjectId:persona.id,
    referenceSha256:ref.sha256, referenceManifestSha256:sha256(job.approved_reference_manifest),
    productSnapshotSha256:sha256(job.job_product_snapshot), deploySha:process.env.RENDER_GIT_COMMIT!,
    approvedScriptSha256,
    model:NORMAL_EVIDENCE_MODEL, category:snapshot.category, format:"hands_only",
    durationS:NORMAL_EVIDENCE_DURATION_S, resolution:NORMAL_EVIDENCE_RESOLUTION,
  };
  return { frozen, userId:job.user_id, brand:snapshot.trustedBrand.value!, referenceKey:ref.rel,
    snapshotKey:ref.snapshotRel, receiptKey:rights.receipt_key, counts, databaseBindingSha256:binding.sha256 };
}

async function main() {
  assertRuntime();
  const mode = process.argv[2] ?? "preflight";
  if (!['preflight','activate'].includes(mode)) throw new Error("JJ_GLOW_FINAL_EVIDENCE_MODE_INVALID");
  if (mode === "activate" && process.env.JJ_GLOW_FINAL_EVIDENCE_ACTIVATE_CONFIRM !== EVIDENCE_TASK) {
    throw new Error("JJ_GLOW_FINAL_EVIDENCE_ACTIVATION_NOT_CONFIRMED");
  }
  const pool = getPool(config.databaseUrl), client = await pool.connect();
  try {
    await client.query(mode === "activate" ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const proof = await inspect(client, mode === "activate");
    const idempotencyKey = expectedNormalEvidenceIdempotencyKey(proof.frozen);
    if (mode === "activate") {
      const now = new Date().toISOString();
      const lease = normalEvidenceLeaseWindow(now);
      await client.query(`INSERT INTO normal_representative_evidence_runs
        (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
         reference_brand,authorization_source,product_snapshot_sha256,approved_script_sha256,deploy_sha,model,category,format,duration_s,
         resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,created_at,updated_at,
         lease_kind,lease_last_progress_at,lease_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'hands_only',15,$16,$17,$18,0,'PREPOST_READY',$19,$19,$20,$21,$22)`,
      [EVIDENCE_TASK,idempotencyKey,proof.frozen.jobId,proof.userId,proof.frozen.productId,
        proof.frozen.subjectId,proof.frozen.referenceSha256,proof.frozen.referenceManifestSha256,proof.brand,
        NORMAL_EVIDENCE_AUTHORIZATION_SOURCE,proof.frozen.productSnapshotSha256,proof.frozen.approvedScriptSha256,
        proof.frozen.deploySha,NORMAL_EVIDENCE_MODEL,proof.frozen.category,NORMAL_EVIDENCE_RESOLUTION,
        NORMAL_EVIDENCE_ESTIMATE_USD,NORMAL_EVIDENCE_MAX_USD,now,lease.kind,lease.lastProgressAt,lease.expiresAt]);
      await client.query("COMMIT");
    } else await client.query("ROLLBACK");
    console.log(JSON.stringify({event:mode === "activate" ? "JJ_GLOW_FINAL_EVIDENCE_ACTIVATED_NO_POST" : "JJ_GLOW_METADATA_FREEZE_PASS",
      ...proof.frozen,idempotencyKey,databaseBindingSha256:proof.databaseBindingSha256,
      referenceKey:proof.referenceKey,snapshotKey:proof.snapshotKey,receiptKey:proof.receiptKey,
      sourceR2Sha256:proof.frozen.referenceSha256,snapshotR2Sha256:proof.frozen.referenceSha256,
      receiptR2Sha256:EXPECTED_RECEIPT_SHA256,scriptCount:Number(proof.counts.script_count),candidateCount:Number(proof.counts.job_count),
      providerTasks:0,providerPosts:0,outputs:0,fypPosted:0,postPlans:0,holdCount:1,terminalLedgerCount:0,
      maxProviderPosts:1,maxSpendUsd:NORMAL_EVIDENCE_MAX_USD,autoRetry:false,publication:false,
      activeEvidenceLease:mode === "activate",metadataMutation:mode === "activate" ? "LEDGER_AND_ACTIVE_EVIDENCE_LEASE" : false}));
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error("JJ_GLOW_FINAL_EVIDENCE_FAIL", error instanceof Error ? error.message : String(error)); process.exit(1); });
