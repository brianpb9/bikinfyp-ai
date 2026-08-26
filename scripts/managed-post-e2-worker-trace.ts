#!/usr/bin/env node
/** One-shot, exact-SHA managed staging trace. No payment or provider calls. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "bullmq";
import { Pool } from "pg";
import { cookieName, issueToken } from "../lib/auth";
import { config } from "../lib/config";
import { parseJobProductSnapshot } from "../lib/job-product-snapshot";
import { parseJobReferenceManifest } from "../lib/job-reference-manifest";
import { getRedisJobQueue, closeRedisJobQueue } from "../lib/job-queue";
import { KEBIJAKAN_KLASIFIKASI } from "../lib/media/klasifikasi-gambar";
import { processPostgresJob } from "../lib/postgres/worker";
import { MANAGED_STAGING_TRACE_HEADER, managedStagingTraceHeader } from "../lib/staging-admission-trace";
import { mediaStorage } from "../lib/storage";
import { managedStagingDeterministicWorkerGate } from "../lib/staging-deterministic-worker";

const TASK = "P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826";
const expectedSha = process.env.EXPECTED_APP_SHA?.trim() ?? "";
process.env.RACUN_WORKER_DETERMINISTIC = "1";
process.env.RACUN_STAGING_DETERMINISTIC_SHA = expectedSha;

assert.match(expectedSha, /^[0-9a-f]{40}$/, "EXPECTED_APP_SHA wajib full SHA");
assert.equal(process.env.RENDER_GIT_COMMIT, expectedSha, "one-off image wajib exact expected SHA");
assert.equal(process.env.RACUN_DEPLOY_ENV, "staging", "runner hanya untuk staging");
assert.equal(process.env.RACUN_DB_RUNTIME, "postgres", "runner wajib PostgreSQL");
assert.equal(process.env.RACUN_QUEUE_MODE, "redis", "runner wajib Redis queue");
assert.equal(process.env.STORAGE_MODE, "r2", "runner wajib exact R2 staging");
assert.deepEqual(managedStagingDeterministicWorkerGate(), {
  allowed: true,
  reason: "exact_managed_staging_worker_sha",
});
assert.ok(config.databaseUrl && config.redisUrl, "managed database/queue connection wajib tersedia");

const id = () => crypto.randomUUID();
const at = () => new Date().toISOString();
const suffix = id();
const userId = `post-e2-user-${suffix}`;
const productId = `post-e2-product-${suffix}`;
const scriptId = `post-e2-script-${suffix}`;
let jobId = `post-e2-unadmitted-${suffix}`;
const productKey = `products/${userId}/controlled-e2-product.svg`;
const sidecarKey = `${productKey}.meta.json`;
const storageKeys = [productKey, sidecarKey];
const pool = new Pool({ connectionString: config.databaseUrl });
const queue = getRedisJobQueue();
let consumer: Worker<{ jobId: string }> | undefined;
let consumedJobId: string | null = null;

const actionableCounts = async () => {
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "prioritized", "paused", "failed");
  return { ...counts, actionable: Object.values(counts).reduce((sum, n) => sum + Number(n), 0) };
};

const receipt: Record<string, unknown> = {
  schema: "managed-post-e2-worker-trace/v1",
  task: TASK,
  started_at: at(),
  exact_sha: expectedSha,
  runtime_identity: {
    service_id: process.env.RENDER_SERVICE_ID,
    deploy_env: process.env.RACUN_DEPLOY_ENV,
    db_runtime: process.env.RACUN_DB_RUNTIME,
    storage_mode: process.env.STORAGE_MODE,
    queue_name: config.redisQueueName,
    deterministic_gate: "exact_managed_staging_worker_sha",
  },
  external_provider_calls: 0,
  payment_invoice_refund_settlement_calls: 0,
  real_money_idr: 0,
  cleanup: { database: false, r2: false, queue: false },
  result: "FAIL",
};

try {
  const before = await actionableCounts();
  assert.equal(before.actionable, 0, `queue harus nol sebelum trace: ${JSON.stringify(before)}`);
  receipt.queue_before = before;

  const sourceBytes = fs.readFileSync(path.join(process.cwd(), "public/staging-fixtures/e2-product.svg"));
  const sourceSha = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  await mediaStorage().put(productKey, sourceBytes, "image/svg+xml");
  await mediaStorage().put(sidecarKey, Buffer.from(JSON.stringify({
    sha256: sourceSha,
    jenis: "product_photo",
    layakReferensi: true,
    rasioAreaTeks: 0,
    jumlahKata: 0,
    alasan: "Committed synthetic staging trace asset",
    versiBukti: KEBIJAKAN_KLASIFIKASI.versiBukti,
  })), "application/json");

  const now = at();
  const segments = [
    { role: "hook", start: 0, end: 3, text: "skincare murah vs mahal, bedanya apa sih?", visual_direction: "Close-up tangan memegang produk" },
    { role: "demo", start: 3, end: 10, text: "nah, NOVA Serum cuma 13 ribu, nggak kalah", visual_direction: "Tangan mendemokan produk" },
    { role: "cta", start: 10, end: 15, text: "Cek keranjang ya deh", visual_direction: "Tunjuk keranjang lalu kembali ke produk" },
  ];
  const admissionSnapshot = {
    contentType: "affiliate", format: null, durationSec: 15, templateId: null,
    wordBudget: null, cartLabel: "keranjang", requirePriceMention: false,
    hookLevel: "agak_berani", productCategory: "beauty",
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id,email,name,tier,locale,created_at) VALUES ($1,$2,$3,'free','id-ID',$4)", [userId, `${userId}@staging.invalid`, "Post-E2 trace identity", now]);
    await client.query("INSERT INTO products (id,user_id,source_url,name,price_idr,category,product_visual_desc,images,raw_meta,claims,created_at) VALUES ($1,$2,NULL,$3,13000,'beauty',$4,$5,$6,'[]',$7)", [productId, userId, "NOVA Serum", "Botol serum krem NOVA 30ml dengan tutup abu-abu.", JSON.stringify([productKey]), JSON.stringify({ brand: "NOVA", trace: TASK }), now]);
    await client.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at) VALUES ($1,$2,'H9','senang','bestie',$3,$4,'#stagingtrace',$5,'high_quality',$6,$6)", [scriptId, productId, JSON.stringify(segments), "Trace admission canonical tanpa provider.", JSON.stringify({ admisi: admissionSnapshot, validation: { passed: true, errors: [] } }), now]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  consumer = new Worker<{ jobId: string }>(config.redisQueueName, async (job) => {
    consumedJobId = job.data.jobId;
    await processPostgresJob(job.data.jobId, { retryViaQueue: true });
  }, { connection: { url: config.redisUrl, maxRetriesPerRequest: null }, concurrency: 1 });
  await consumer.waitUntilReady();

  const token = await issueToken(userId, "");
  const admissionBodyRaw = JSON.stringify({ script_id: scriptId, format: "hands_only", duration_s: 15, quality_tier: "high_quality" });
  const traceHeader = managedStagingTraceHeader(process.env.AUTH_SECRET ?? "", expectedSha, {
    userId,
    scriptId,
    format: "hands_only",
    qualityTier: "high_quality",
    durationS: 15,
  });
  const admissionHeaders = {
    "content-type": "application/json",
    cookie: `${cookieName()}=${encodeURIComponent(token)}`,
    [MANAGED_STAGING_TRACE_HEADER]: traceHeader,
  };
  const admission = await fetch("https://racun-ai-staging-web.onrender.com/api/jobs", {
    method: "POST",
    headers: admissionHeaders,
    body: admissionBodyRaw,
  });
  const admissionBody = await admission.json() as Record<string, unknown>;
  assert.equal(admission.status, 201, `canonical admission HTTP ${admission.status}: ${JSON.stringify(admissionBody)}`);
  assert.equal(admissionBody.state, "QUEUED");
  assert.equal(admissionBody.quality_tier, "high_quality");
  assert.equal(admissionBody.hold_idr, 0, "managed trace admission wajib Rp0");
  assert.equal(typeof admissionBody.job_id, "string");
  jobId = String(admissionBody.job_id);
  const replay = await fetch("https://racun-ai-staging-web.onrender.com/api/jobs", {
    method: "POST",
    headers: admissionHeaders,
    body: admissionBodyRaw,
  });
  await replay.arrayBuffer();
  assert.equal(replay.status, 400, "kapabilitas trace yang sama wajib ditolak pada replay");

  const deadline = Date.now() + 60_000;
  let state = "";
  while (Date.now() < deadline) {
    state = String((await pool.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0]?.state ?? "");
    if (["READY", "FAILED", "REFUNDED"].includes(state)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(state, "READY", `trace tidak mencapai READY; state=${state}`);
  await consumer.close();
  consumer = undefined;

  const job = (await pool.query("SELECT state,provider_video,provider_voice,cost_actual_idr,qc_result,output_url,approved_reference_manifest,job_product_snapshot FROM jobs WHERE id=$1", [jobId])).rows[0];
  const output = (await pool.query("SELECT video_url,caption,hashtags,compliance_checklist FROM outputs WHERE job_id=$1", [jobId])).rows[0];
  const ledger = (await pool.query("SELECT type,delta FROM credit_ledger WHERE job_id=$1 ORDER BY created_at,id", [jobId])).rows;
  const providerTasks = Number((await pool.query("SELECT count(*)::int AS n FROM provider_tasks WHERE job_id=$1", [jobId])).rows[0].n);
  const payments = Number((await pool.query("SELECT count(*)::int AS n FROM payments WHERE user_id=$1", [userId])).rows[0].n);
  assert.equal(job.provider_video, "deterministic-postgres-test");
  assert.equal(Number(job.cost_actual_idr), 0);
  assert.equal(providerTasks, 0);
  assert.equal(payments, 0);
  assert.deepEqual(ledger, []);
  assert.equal(consumedJobId, jobId, "worker wajib mengonsumsi job ID hasil canonical admission");
  assert.ok(output?.video_url && await mediaStorage().stat(output.video_url));
  storageKeys.push(output.video_url);
  const manifest = parseJobReferenceManifest(job.approved_reference_manifest);
  const productSnapshot = parseJobProductSnapshot(job.job_product_snapshot);
  storageKeys.push(...manifest.references.map((ref) => ref.snapshotRel));
  const sidecarVerified = manifest.references.length === 1 && manifest.references[0].sha256 === sourceSha;
  const admissionManifestExact = manifest.references[0].rel === productKey;
  const admissionSnapshotExact = productSnapshot.productName === "NOVA Serum"
    && productSnapshot.category === "beauty" && productSnapshot.priceIdr === 13000
    && productSnapshot.trustedBrand.value === "NOVA";
  assert.equal(sidecarVerified, true, "canonical manifest wajib membawa hash sidecar exact");
  assert.equal(admissionManifestExact, true, "canonical manifest wajib menunjuk product key exact");
  assert.equal(admissionSnapshotExact, true, "canonical product snapshot wajib exact");
  receipt.trace = {
    dedicated_identity: true,
    dedicated_product: true,
    source_sha256: sourceSha,
    canonical_admission_http: admission.status,
    canonical_admission_job_id_matches_worker: consumedJobId === jobId,
    canonical_admission_hold_idr: admissionBody.hold_idr,
    canonical_admission_replay_http: replay.status,
    canonical_admission_capability_one_use: replay.status === 400,
    sidecar_verified: sidecarVerified,
    admission_manifest_exact: admissionManifestExact,
    admission_snapshot_exact: admissionSnapshotExact,
    queue_consumed_by_one_off_worker: true,
    terminal: job.state,
    provider_video: job.provider_video,
    provider_voice: job.provider_voice,
    cost_actual_idr: Number(job.cost_actual_idr),
    qc: JSON.parse(job.qc_result),
    deliverable_key: output.video_url,
    deliverable_present_in_r2: true,
    provider_task_rows: providerTasks,
    payment_rows: payments,
    ledger_rows: ledger,
  };
  receipt.before_cleanup = { queue: await actionableCounts(), db_rows: { user: 1, product: 1, script: 1, job: 1, output: 1 } };
  receipt.result = "PASS";
} finally {
  if (consumer) await consumer.close().catch(() => undefined);
  const queued = await queue.getJob(jobId).catch(() => null);
  if (queued) await queued.remove().catch(() => undefined);
  (receipt.cleanup as Record<string, unknown>).queue = !(await queue.getJob(jobId));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of ["provider_tasks", "job_prompts", "job_shots", "fyp_snapshots", "post_plans", "outputs"]) {
      await client.query(`DELETE FROM ${table} WHERE job_id=$1`, [jobId]);
    }
    await client.query("DELETE FROM credit_ledger WHERE job_id=$1 OR user_id=$2", [jobId, userId]);
    await client.query("DELETE FROM payments WHERE user_id=$1", [userId]);
    await client.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id = ANY($2::text[])", [userId, [userId, productId, scriptId, jobId]]);
    await client.query("DELETE FROM jobs WHERE id=$1", [jobId]);
    await client.query("DELETE FROM scripts WHERE id=$1", [scriptId]);
    await client.query("DELETE FROM products WHERE id=$1", [productId]);
    await client.query("DELETE FROM users WHERE id=$1", [userId]);
    await client.query("COMMIT");
    (receipt.cleanup as Record<string, unknown>).database = true;
  } catch (error) {
    await client.query("ROLLBACK");
    (receipt.cleanup as Record<string, unknown>).database_error = String(error).slice(0, 300);
  } finally {
    client.release();
  }
  const storageResults = await Promise.all(storageKeys.map(async (key) => {
    await mediaStorage().delete(key);
    return !(await mediaStorage().stat(key));
  }));
  (receipt.cleanup as Record<string, unknown>).r2 = storageResults.every(Boolean);
  receipt.queue_after = await actionableCounts();
  const count = async (sql: string, params: unknown[]) => Number((await pool.query(sql, params)).rows[0].n);
  const dbRows = {
    users: await count("SELECT count(*)::int AS n FROM users WHERE id=$1", [userId]),
    products: await count("SELECT count(*)::int AS n FROM products WHERE id=$1 OR user_id=$2", [productId, userId]),
    scripts: await count("SELECT count(*)::int AS n FROM scripts WHERE id=$1 OR product_id=$2", [scriptId, productId]),
    jobs: await count("SELECT count(*)::int AS n FROM jobs WHERE id=$1 OR user_id=$2", [jobId, userId]),
    outputs: await count("SELECT count(*)::int AS n FROM outputs WHERE job_id=$1", [jobId]),
    audit_log: await count("SELECT count(*)::int AS n FROM audit_log WHERE actor=$1 OR entity_id = ANY($2::text[])", [userId, [userId, productId, scriptId, jobId]]),
    fyp_snapshots: await count("SELECT count(*)::int AS n FROM fyp_snapshots WHERE job_id=$1 OR script_id=$2", [jobId, scriptId]),
    provider_tasks: await count("SELECT count(*)::int AS n FROM provider_tasks WHERE job_id=$1", [jobId]),
    payments: await count("SELECT count(*)::int AS n FROM payments WHERE user_id=$1", [userId]),
    credit_ledger: await count("SELECT count(*)::int AS n FROM credit_ledger WHERE job_id=$1 OR user_id=$2", [jobId, userId]),
    job_prompts: await count("SELECT count(*)::int AS n FROM job_prompts WHERE job_id=$1", [jobId]),
    job_shots: await count("SELECT count(*)::int AS n FROM job_shots WHERE job_id=$1", [jobId]),
    post_plans: await count("SELECT count(*)::int AS n FROM post_plans WHERE job_id=$1", [jobId]),
  };
  receipt.after_cleanup = {
    db_rows: dbRows,
    r2_objects_present: (await Promise.all(storageKeys.map((key) => mediaStorage().stat(key)))).filter(Boolean).length,
    queue_job_present: Boolean(await queue.getJob(jobId)),
  };
  const cleanup = receipt.cleanup as Record<string, unknown>;
  const afterCleanup = receipt.after_cleanup as Record<string, unknown>;
  const cleanupPassed = cleanup.database === true && cleanup.r2 === true && cleanup.queue === true
    && Object.values(dbRows).every((value) => value === 0)
    && afterCleanup.r2_objects_present === 0 && afterCleanup.queue_job_present === false
    && (receipt.queue_after as { actionable: number }).actionable === 0;
  if (!cleanupPassed) {
    receipt.result = "FAIL";
    process.exitCode = 1;
  }
  receipt.finished_at = at();
  await closeRedisJobQueue();
  await pool.end();
  console.log(JSON.stringify(receipt));
}
