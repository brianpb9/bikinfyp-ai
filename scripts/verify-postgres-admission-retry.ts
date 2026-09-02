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

const count = 20;
const userId = `admission-user-${crypto.randomUUID()}`;
const productId = `admission-product-${crypto.randomUUID()}`;
const scriptIds = Array.from({ length: count }, () => `admission-script-${crypto.randomUUID()}`);
const priceIdr = 5_000;
const now = new Date().toISOString();
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [userId, `${userId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission',1000,'test','[]',$3)",
    [productId, userId, now]
  );
  for (const scriptId of scriptIds) {
    await pool.query(
      "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
      [scriptId, productId, now]
    );
  }
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,$3,'topup',$4)",
    // One extra hold funds the explicit terminal re-admission assertion below.
    [`topup-${crypto.randomUUID()}`, userId, (count + 1) * priceIdr, now]
  );

  const settled = await Promise.allSettled(scriptIds.map((scriptId) => smokeCreateJob(userId, {
    productId, scriptId, format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr, jenisVideo: "premium",
  })));
  const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  assert.equal(rejected.length, 0, `admission paralel menolak ${rejected.length}: ${rejected.map((entry) => String(entry.reason)).join(" | ")}`);
  const accepted = settled.map((entry) => (entry as PromiseFulfilledResult<{ jobId: string; duplicate: boolean }>).value);
  assert.equal(new Set(accepted.map((entry) => entry.jobId)).size, count, "setiap script harus mendapat job unik");
  assert.equal(accepted.filter((entry) => entry.duplicate).length, 0, "20 script berbeda tidak boleh dianggap duplikat");

  const jobs = await pool.query<{ script_id: string; n: string }>(
    "SELECT script_id,COUNT(*)::text n FROM jobs WHERE user_id=$1 GROUP BY script_id ORDER BY script_id", [userId]
  );
  assert.equal(jobs.rowCount, count, "harus ada tepat 20 job");
  assert.ok(jobs.rows.every((row) => Number(row.n) === 1), "setiap script harus memiliki tepat satu job");
  const holds = await pool.query<{ job_id: string; n: string; delta: string }>(
    "SELECT job_id,COUNT(*)::text n,SUM(delta)::text delta FROM credit_ledger WHERE user_id=$1 AND type='hold' GROUP BY job_id ORDER BY job_id", [userId]
  );
  assert.equal(holds.rowCount, count, "harus ada tepat 20 hold");
  assert.ok(holds.rows.every((row) => Number(row.n) === 1 && Number(row.delta) === -priceIdr), "setiap job harus memiliki satu hold sebesar harga");
  const first = accepted[0];
  const duplicate = await smokeCreateJob(userId, { productId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr, jenisVideo: "premium" });
  assert.equal(duplicate.duplicate, true, "job aktif untuk script yang sama harus idempoten");
  assert.equal(duplicate.jobId, first.jobId, "duplikat aktif harus menunjuk job awal");
  const activeDuplicateHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [first.jobId]);
  assert.equal(activeDuplicateHolds.rowCount, 1, "duplikat aktif tidak boleh membuat hold kedua");

  // This matches the historic rule: a terminal job does not block a deliberate
  // re-admission of the same approved script, and the script pointer advances.
  await pool.query("UPDATE jobs SET state='FAILED' WHERE id=$1", [first.jobId]);
  const reAdmitted = await smokeCreateJob(userId, { productId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr, jenisVideo: "premium" });
  assert.equal(reAdmitted.duplicate, false, "job terminal harus mengizinkan re-admission");
  assert.notEqual(reAdmitted.jobId, first.jobId, "re-admission harus membuat job baru");
  const pointer = await pool.query<{ job_id: string }>("SELECT job_id FROM scripts WHERE id=$1", [scriptIds[0]]);
  assert.equal(pointer.rows[0]?.job_id, reAdmitted.jobId, "pointer script harus berpindah ke job re-admission");
  const finalHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [reAdmitted.jobId]);
  assert.equal(finalHolds.rowCount, 1, "re-admission terminal harus membuat satu hold baru");
  const balance = await pool.query<{ balance: string }>("SELECT balance::text FROM v_credit_balance WHERE user_id=$1", [userId]);
  assert.equal(Number(balance.rows[0]?.balance), 0, "saldo harus habis persis tanpa hold ganda/terlewat");

  process.stdout.write(JSON.stringify({ admissions: count, jobs: jobs.rowCount, holds: holds.rowCount, active_duplicate: true, terminal_readmission: true, balance: Number(balance.rows[0]?.balance) }) + "\n");
} finally {
  await pool.end();
}
