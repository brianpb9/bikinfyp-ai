#!/usr/bin/env node
/** One-shot, exact-SHA managed staging trace. No payment or provider calls. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "bullmq";
import { Pool } from "pg";
import { config } from "../lib/config";
import { createJobProductSnapshotRaw } from "../lib/job-product-snapshot";
import { prepareJobReferenceManifest } from "../lib/job-reference-manifest";
import { enqueueRedisJob, getRedisJobQueue, closeRedisJobQueue } from "../lib/job-queue";
import { KEBIJAKAN_KLASIFIKASI } from "../lib/media/klasifikasi-gambar";
import { processPostgresJob } from "../lib/postgres/worker";
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
const jobId = `post-e2-job-${suffix}`;
const productKey = `products/${userId}/controlled-e2-product.svg`;
const sidecarKey = `${productKey}.meta.json`;
const storageKeys = [productKey, sidecarKey];
const pool = new Pool({ connectionString: config.databaseUrl });
const queue = getRedisJobQueue();
let consumer: Worker<{ jobId: string }> | undefined;

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

  const prepared = await prepareJobReferenceManifest({ jobId, candidateRels: [productKey] });
  storageKeys.push(...prepared.manifest.references.map((ref) => ref.snapshotRel));
  const snapshotRaw = createJobProductSnapshotRaw({
    name: "NOVA Controlled Staging Serum 30ml",
    category: "beauty",
    price_idr: 13000,
    raw_meta: JSON.stringify({ brand: "NOVA", trace: TASK }),
    product_visual_desc: "Botol serum krem NOVA 30ml dengan tutup abu-abu.",
    brand_brief: null,
    claims: JSON.stringify([]),
  });

  const now = at();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id,email,name,tier,locale,created_at) VALUES ($1,$2,$3,'free','id-ID',$4)", [userId, `${userId}@staging.invalid`, "Post-E2 trace identity", now]);
    await client.query("INSERT INTO products (id,user_id,name,price_idr,category,product_visual_desc,images,raw_meta,claims,created_at) VALUES ($1,$2,$3,13000,'beauty',$4,$5,$6,'[]',$7)", [productId, userId, "NOVA Controlled Staging Serum 30ml", "Botol serum krem NOVA 30ml dengan tutup abu-abu.", JSON.stringify([productKey]), JSON.stringify({ brand: "NOVA", trace: TASK }), now]);
    await client.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at) VALUES ($1,$2,'H1','senang','bestie','[]',$3,'#stagingtrace',$4,'silent_caption',$5,$5)", [scriptId, productId, "Trace deterministik tanpa provider.", JSON.stringify({ admisi: { task: TASK, accepted: true } }), now]);
    await client.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,approved_reference_manifest,job_product_snapshot,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only','silent_caption',3,'QUEUED',$5,$6,$7,$7)", [jobId, userId, productId, scriptId, prepared.raw, snapshotRaw, now]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  consumer = new Worker<{ jobId: string }>(config.redisQueueName, async (job) => {
    assert.equal(job.data.jobId, jobId, "one-off consumer menolak job lain");
    await processPostgresJob(job.data.jobId, { retryViaQueue: true });
  }, { connection: { url: config.redisUrl, maxRetriesPerRequest: null }, concurrency: 1 });
  await consumer.waitUntilReady();
  await enqueueRedisJob(jobId);

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
  assert.ok(output?.video_url && await mediaStorage().stat(output.video_url));
  storageKeys.push(output.video_url);
  receipt.trace = {
    dedicated_identity: true,
    dedicated_product: true,
    source_sha256: sourceSha,
    sidecar_verified: prepared.resolution.utama?.sha256 === sourceSha,
    admission_manifest_exact: job.approved_reference_manifest === prepared.raw,
    admission_snapshot_exact: job.job_product_snapshot === snapshotRaw,
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
  receipt.after_cleanup = {
    db_rows: Number((await pool.query("SELECT count(*)::int AS n FROM users WHERE id=$1", [userId])).rows[0].n),
    r2_objects_present: (await Promise.all(storageKeys.map((key) => mediaStorage().stat(key)))).filter(Boolean).length,
    queue_job_present: Boolean(await queue.getJob(jobId)),
  };
  const cleanup = receipt.cleanup as Record<string, unknown>;
  const afterCleanup = receipt.after_cleanup as Record<string, unknown>;
  const cleanupPassed = cleanup.database === true && cleanup.r2 === true && cleanup.queue === true
    && afterCleanup.db_rows === 0 && afterCleanup.r2_objects_present === 0 && afterCleanup.queue_job_present === false
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
