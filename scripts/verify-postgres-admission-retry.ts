/**
 * Independent regression proof for the PostgreSQL job-admission retry loop.
 *
 * This intentionally uses a disposable local database supplied by its shell
 * wrapper.  It admits 20 distinct scripts for one funded user concurrently;
 * no queue, HTTP server, or media provider is involved.  The assertions prove
 * that a successful response maps to exactly one job and exactly one hold.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL database disposable wajib tersedia.");
const { smokeCreateJob } = await import("../lib/postgres/smoke-runtime");
const { setMediaStorageForTests } = await import("../lib/storage");

const count = 20;
const userId = `admission-user-${crypto.randomUUID()}`;
const productId = `admission-product-${crypto.randomUUID()}`;
const scriptIds = Array.from({ length: count }, () => `admission-script-${crypto.randomUUID()}`);
const duplicateScriptId = `admission-duplicate-${crypto.randomUUID()}`;
const unfundedUserId = `admission-unfunded-user-${crypto.randomUUID()}`;
const unfundedProductId = `admission-unfunded-product-${crypto.randomUUID()}`;
const unfundedScriptId = `admission-unfunded-script-${crypto.randomUUID()}`;
const rollbackUserId = `admission-rollback-user-${crypto.randomUUID()}`;
const rollbackProductId = `admission-rollback-product-${crypto.randomUUID()}`;
const rollbackScriptId = `admission-rollback-script-${crypto.randomUUID()}`;
const retryUserId = `admission-retry-user-${crypto.randomUUID()}`;
const retryProductId = `admission-retry-product-${crypto.randomUUID()}`;
const retryScriptId = `admission-retry-script-${crypto.randomUUID()}`;
const priceIdr = 5_000;
const now = new Date().toISOString();
const pool = new Pool({ connectionString: databaseUrl });
const referenceRel = `uploads/${productId}/approved.webp`;
const referenceBytes = Buffer.from("POSTGRES-ADMISSION-RETRY-REFERENCE");
const referenceSha = crypto.createHash("sha256").update(referenceBytes).digest("hex");
const retryReferenceRel = `uploads/${retryProductId}/approved-retry.webp`;
const retryReferenceBytes = Buffer.from("POSTGRES-ADMISSION-RETRY-REFERENCE-CHANGED");
const retryReferenceSha = crypto.createHash("sha256").update(retryReferenceBytes).digest("hex");
const objects = new Map<string, Buffer>([
  [referenceRel, referenceBytes],
  [`${referenceRel}.meta.json`, Buffer.from(JSON.stringify({
    sha256: referenceSha, jenis: "product_photo", layakReferensi: true,
    rasioAreaTeks: 0, jumlahKata: 0, alasan: "fixture admission retry", versiBukti: 1,
  }))],
  [retryReferenceRel, retryReferenceBytes],
  [`${retryReferenceRel}.meta.json`, Buffer.from(JSON.stringify({
    sha256: retryReferenceSha, jenis: "product_photo", layakReferensi: true,
    rasioAreaTeks: 0, jumlahKata: 0, alasan: "fixture admission retry changed", versiBukti: 1,
  }))],
]);
const putCalls: string[] = [];
let failSnapshotPutAfterWrite = false;
let retrySnapshotPutAfterWrite = false;
setMediaStorageForTests({
  async put(key, body) {
    putCalls.push(key); objects.set(key, Buffer.from(body));
    if (key.includes("/approved-references/") && failSnapshotPutAfterWrite) {
      failSnapshotPutAfterWrite = false;
      throw new Error("injected PG storage failure after write");
    }
    if (key.includes("/approved-references/") && retrySnapshotPutAfterWrite) {
      retrySnapshotPutAfterWrite = false;
      throw Object.assign(new Error("injected PG serialization retry after write"), { code: "40001" });
    }
  },
  async delete(key) { objects.delete(key); },
  async get(key) { const body = objects.get(key); return body ? { body: Buffer.from(body), size: body.length } : null; },
  async stat(key) { const body = objects.get(key); return body ? { size: body.length } : null; },
  async materialize() { return null; },
});

try {
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [userId, `${userId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [unfundedUserId, `${unfundedUserId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [rollbackUserId, `${rollbackUserId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [retryUserId, `${retryUserId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission',1000,'test',$3,$4)",
    [productId, userId, JSON.stringify([referenceRel]), now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission tanpa saldo',1000,'test',$3,$4)",
    [unfundedProductId, unfundedUserId, JSON.stringify([referenceRel]), now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission rollback',1000,'test',$3,$4)",
    [rollbackProductId, rollbackUserId, JSON.stringify([referenceRel]), now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission transient retry',1000,'test',$3,$4)",
    [retryProductId, retryUserId, JSON.stringify([referenceRel]), now]
  );
  for (const scriptId of [...scriptIds, duplicateScriptId]) {
    await pool.query(
      "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
      [scriptId, productId, now]
    );
  }
  await pool.query(
    "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
    [unfundedScriptId, unfundedProductId, now]
  );
  await pool.query(
    "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
    [rollbackScriptId, rollbackProductId, now]
  );
  await pool.query(
    "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
    [retryScriptId, retryProductId, now]
  );

  const putsBeforeInsufficient = putCalls.length;
  await assert.rejects(
    () => smokeCreateJob(unfundedUserId, {
      productId: unfundedProductId, scriptId: unfundedScriptId,
      format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    }),
    /INSUFFICIENT_CREDITS/
  );
  assert.equal(putCalls.length, putsBeforeInsufficient, "PG insufficient menulis snapshot sebelum ditolak");
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM jobs WHERE user_id=$1", [unfundedUserId])).rows[0].n), 0);
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM credit_ledger WHERE user_id=$1 AND type='hold'", [unfundedUserId])).rows[0].n), 0);

  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,$3,'topup',$4)",
    [`rollback-credit-${crypto.randomUUID()}`, rollbackUserId, priceIdr, now]
  );
  const putsBeforeRollback = putCalls.length;
  failSnapshotPutAfterWrite = true;
  await assert.rejects(
    () => smokeCreateJob(rollbackUserId, {
      productId: rollbackProductId, scriptId: rollbackScriptId,
      format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    }),
    /injected PG storage failure after write/
  );
  const rollbackSnapshotKey = putCalls.slice(putsBeforeRollback).find((key) => key.includes("/approved-references/")) ?? "";
  assert.ok(rollbackSnapshotKey, "fixture tidak mencapai PUT antara dua balance check");
  assert.equal(objects.has(rollbackSnapshotKey), false,
    "PG rollback yang terbukti tidak commit meninggalkan prepared snapshot");
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM jobs WHERE user_id=$1", [rollbackUserId])).rows[0].n), 0);
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM credit_ledger WHERE user_id=$1 AND type='hold'", [rollbackUserId])).rows[0].n), 0);

  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,$3,'topup',$4)",
    [`retry-credit-${crypto.randomUUID()}`, retryUserId, priceIdr, now]
  );
  retrySnapshotPutAfterWrite = true;
  let retryHookCalls = 0;
  const retried = await smokeCreateJob(retryUserId, {
    productId: retryProductId, scriptId: retryScriptId,
    format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    onRetryForTests: async ({ code }) => {
      retryHookCalls++;
      assert.equal(code, "40001");
      await pool.query("UPDATE products SET images=$1 WHERE id=$2", [JSON.stringify([retryReferenceRel]), retryProductId]);
    },
  });
  assert.equal(retryHookCalls, 1, "fixture transient retry tidak menembus catch 40001");
  const retryManifestRaw = (await pool.query<{ approved_reference_manifest: string }>(
    "SELECT approved_reference_manifest FROM jobs WHERE id=$1", [retried.jobId]
  )).rows[0].approved_reference_manifest;
  const retryWinnerKeys = new Set((JSON.parse(retryManifestRaw) as { references: { snapshotRel: string }[] }).references.map((ref) => ref.snapshotRel));
  const retryRetainedKeys = new Set([...objects.keys()].filter((key) => key.startsWith(`jobs/${retried.jobId}/approved-references/`)));
  assert.deepEqual(retryRetainedKeys, retryWinnerKeys,
    "successful PG retry meninggalkan key attempt lama di dalam winner prefix");

  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,$3,'topup',$4)",
    // One hold funds the concurrent same-script winner and one funds the
    // explicit terminal re-admission assertion below.
    [`topup-${crypto.randomUUID()}`, userId, (count + 2) * priceIdr, now]
  );

  const settled = await Promise.allSettled(scriptIds.map((scriptId) => smokeCreateJob(userId, {
    productId, scriptId, format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
  })));
  const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  assert.equal(rejected.length, 0, `admission paralel menolak ${rejected.length}: ${rejected.map((entry) => String(entry.reason)).join(" | ")}`);
  const accepted = settled.map((entry) => (entry as PromiseFulfilledResult<{ jobId: string; duplicate: boolean }>).value);
  assert.equal(new Set(accepted.map((entry) => entry.jobId)).size, count, "setiap script harus mendapat job unik");
  assert.equal(accepted.filter((entry) => entry.duplicate).length, 0, "20 script berbeda tidak boleh dianggap duplikat");

  const jobs = await pool.query<{ script_id: string; n: string; manifests: string }>(
    "SELECT script_id,COUNT(*)::text n,COUNT(approved_reference_manifest)::text manifests FROM jobs WHERE user_id=$1 GROUP BY script_id ORDER BY script_id", [userId]
  );
  assert.equal(jobs.rowCount, count, "harus ada tepat 20 job");
  assert.ok(jobs.rows.every((row) => Number(row.n) === 1), "setiap script harus memiliki tepat satu job");
  assert.ok(jobs.rows.every((row) => Number(row.manifests) === 1), "setiap job harus visible bersama manifest admission");
  const holds = await pool.query<{ job_id: string; n: string; delta: string }>(
    "SELECT job_id,COUNT(*)::text n,SUM(delta)::text delta FROM credit_ledger WHERE user_id=$1 AND type='hold' GROUP BY job_id ORDER BY job_id", [userId]
  );
  assert.equal(holds.rowCount, count, "harus ada tepat 20 hold");
  assert.ok(holds.rows.every((row) => Number(row.n) === 1 && Number(row.delta) === -priceIdr), "setiap job harus memiliki satu hold sebesar harga");
  const first = accepted[0];
  const duplicate = await smokeCreateJob(userId, { productId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr });
  assert.equal(duplicate.duplicate, true, "job aktif untuk script yang sama harus idempoten");
  assert.equal(duplicate.jobId, first.jobId, "duplikat aktif harus menunjuk job awal");
  const activeDuplicateHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [first.jobId]);
  assert.equal(activeDuplicateHolds.rowCount, 1, "duplikat aktif tidak boleh membuat hold kedua");

  const duplicateSettled = await Promise.all(Array.from({ length: 8 }, () => smokeCreateJob(userId, {
    productId, scriptId: duplicateScriptId, format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
  })));
  assert.equal(new Set(duplicateSettled.map((entry) => entry.jobId)).size, 1,
    "admission PG same-script konkuren tidak menunjuk satu winner");
  assert.equal(duplicateSettled.filter((entry) => !entry.duplicate).length, 1,
    "admission PG same-script harus punya tepat satu creator");
  const duplicateWinnerId = duplicateSettled[0].jobId;
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM jobs WHERE script_id=$1", [duplicateScriptId])).rows[0].n), 1);
  assert.equal(Number((await pool.query<{ n: string }>("SELECT COUNT(*)::text n FROM credit_ledger WHERE job_id=$1 AND type='hold'", [duplicateWinnerId])).rows[0].n), 1);

  // This matches the historic rule: a terminal job does not block a deliberate
  // re-admission of the same approved script, and the script pointer advances.
  await pool.query("UPDATE jobs SET state='FAILED' WHERE id=$1", [first.jobId]);
  const reAdmitted = await smokeCreateJob(userId, { productId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr });
  assert.equal(reAdmitted.duplicate, false, "job terminal harus mengizinkan re-admission");
  assert.notEqual(reAdmitted.jobId, first.jobId, "re-admission harus membuat job baru");
  const pointer = await pool.query<{ job_id: string }>("SELECT job_id FROM scripts WHERE id=$1", [scriptIds[0]]);
  assert.equal(pointer.rows[0]?.job_id, reAdmitted.jobId, "pointer script harus berpindah ke job re-admission");
  const finalHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [reAdmitted.jobId]);
  assert.equal(finalHolds.rowCount, 1, "re-admission terminal harus membuat satu hold baru");
  const balance = await pool.query<{ balance: string }>("SELECT balance::text FROM v_credit_balance WHERE user_id=$1", [userId]);
  assert.equal(Number(balance.rows[0]?.balance), 0, "saldo harus habis persis tanpa hold ganda/terlewat");

  const admittedJobIds = new Set((await pool.query<{ id: string }>("SELECT id FROM jobs")).rows.map((row) => row.id));
  const retainedPrefixes = new Set([...objects.keys()]
    .filter((key) => key.includes("/approved-references/"))
    .map((key) => key.split("/")[1]));
  assert.deepEqual(retainedPrefixes, admittedJobIds,
    "storage PG menyisakan prefix loser/non-job atau kehilangan prefix winner");

  process.stdout.write(JSON.stringify({ admissions: count, jobs: jobs.rowCount, holds: holds.rowCount, insufficient_puts: 0, known_rollback_cleanup: true, transient_retry_pruned_to_manifest: true, concurrent_duplicate_calls: 8, concurrent_duplicate_winners: 1, retained_prefixes_match_jobs: true, active_duplicate: true, terminal_readmission: true, balance: Number(balance.rows[0]?.balance) }) + "\n");
} finally {
  setMediaStorageForTests(undefined);
  await pool.end();
}
