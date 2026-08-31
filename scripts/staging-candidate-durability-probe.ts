/**
 * Two-process staging durability proof. `create` calls the exact production
 * smokeCreateJob repository/transaction path but never enqueues. After that
 * process exits, `readback-cleanup` opens a new pool, proves the rows, and
 * removes only the UUID-scoped fixture.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";
import { smokeCreateJob } from "../lib/postgres/smoke-runtime";
import { mediaStorage } from "../lib/storage";
import { postgresRuntimeBinding } from "../lib/postgres/runtime-binding.cjs";
import { closeAllPools } from "../lib/postgres/pool";

const mode = process.argv[2];
const selfCheck = mode === "self-check";
const suffix = selfCheck ? "000000000000" : process.env.DURABILITY_PROBE_SUFFIX;
assert.match(suffix ?? "", /^[a-f0-9-]{12,64}$/, "DURABILITY_PROBE_SUFFIX invalid");
if (!selfCheck) {
  assert.equal(process.env.RACUN_DEPLOY_ENV, "staging", "staging only");
  assert.equal(process.env.DURABILITY_PROBE_AUTHORIZED, "1", "explicit probe authority required");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL required");
}
const ids = {
  user: `durability-user-${suffix}`, product: `durability-product-${suffix}`,
  script: `durability-script-${suffix}`, reference: `uploads/durability-${suffix}/reference.webp`,
};
const canonicalProduct = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const countCanonical = async () => (await pool.query<{ scripts:number;jobs:number }>(
  `SELECT (SELECT count(*)::int FROM scripts WHERE product_id=$1) scripts,
          (SELECT count(*)::int FROM jobs WHERE product_id=$1) jobs`, [canonicalProduct],
)).rows[0];

async function cleanupFixture(): Promise<{ jobs: number; storage: number }> {
  const rows = (await pool.query<{ id:string;approved_reference_manifest:string|null }>(
    `SELECT id,approved_reference_manifest FROM jobs
      WHERE user_id=$1 AND product_id=$2 AND script_id=$3`, [ids.user,ids.product,ids.script],
  )).rows;
  const keys = new Set<string>([ids.reference, `${ids.reference}.meta.json`]);
  for (const row of rows) {
    if (!row.approved_reference_manifest) continue;
    const manifest = JSON.parse(row.approved_reference_manifest) as {references?:Array<{snapshotRel:string}>};
    for (const ref of manifest.references ?? []) {
      keys.add(ref.snapshotRel); keys.add(`${ref.snapshotRel}.meta.json`);
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobIds = rows.map((row) => row.id);
    await client.query(
      "DELETE FROM audit_log WHERE actor=$1 OR entity_id=ANY($2::text[])",
      [ids.user,[ids.user,ids.product,ids.script,...jobIds]],
    );
    await client.query("DELETE FROM jobs WHERE user_id=$1 AND product_id=$2 AND script_id=$3",[ids.user,ids.product,ids.script]);
    await client.query("DELETE FROM scripts WHERE id=$1 AND product_id=$2",[ids.script,ids.product]);
    await client.query("DELETE FROM products WHERE id=$1 AND user_id=$2",[ids.product,ids.user]);
    await client.query("DELETE FROM users WHERE id=$1",[ids.user]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await Promise.all([...keys].map((key)=>mediaStorage().delete(key)));
  return { jobs: rows.length, storage: keys.size };
}

async function create() {
  const before = await countCanonical();
  const binding = await postgresRuntimeBinding(pool);
  const now = new Date().toISOString();
  const bytes = Buffer.from(`DURABILITY-PROBE-${suffix}`);
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  try {
    await mediaStorage().put(ids.reference, bytes, "image/webp");
    await mediaStorage().put(`${ids.reference}.meta.json`, Buffer.from(JSON.stringify({
      sha256:digest,jenis:"product_photo",layakReferensi:true,rasioAreaTeks:0,jumlahKata:0,
      alasan:"non-canonical durability fixture",versiBukti:1,labelOcrStatus:"READABLE",labelOcrVersion:1,
    })), "application/json");
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("INSERT INTO users (id,email,name,tier,locale,created_at) VALUES ($1,$2,'Durability fixture','free','id-ID',$3)", [ids.user, `${ids.user}@staging.invalid`, now]);
      await setup.query(`INSERT INTO products (id,user_id,name,price_idr,category,product_visual_desc,images,raw_meta,claims,created_at,
        product_type_token,product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,product_type_version,product_type_state,
        category_review_state,category_review_reason,category_review_version)
        VALUES ($1,$2,'NONCANONICAL DURABILITY FIXTURE',0,'beauty','synthetic fixture',$3,'{}','[]',$4::text,
        'serum wajah','serum wajah',$2,$4::timestamptz,1,'CONFIRMED','CLEAR',NULL,1)`, [ids.product,ids.user,JSON.stringify([ids.reference]),now]);
      await setup.query(`INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
        VALUES ($1,$2,'H1','netral','bestie','[]','fixture','[]','{}','high_quality',$3,$3)`, [ids.script,ids.product,now]);
      await setup.query("COMMIT");
    } catch (error) { await setup.query("ROLLBACK"); throw error; }
    finally { setup.release(); }
    const created = await smokeCreateJob(ids.user, {
      productId:ids.product,personaId:null,scriptId:ids.script,format:"hands_only",qualityTier:"high_quality",
      durationS:15,priceIdr:0,omitZeroLedger:true,expectedProductStateSha256:null,
      expectedDatabaseBindingSha256:binding.sha256,
    });
    assert.equal(created.duplicate, false);
    assert.deepEqual(await countCanonical(), before, "canonical candidate count changed");
    console.log(JSON.stringify({event:"DURABILITY_CREATE_PASS",suffix,job_id:created.jobId,binding_sha256:binding.sha256,
      persistence:"smokeCreateJob",provider_calls:0,queue_writes:0,canonical_before:before,canonical_after:before}));
  } catch (error) {
    try { await cleanupFixture(); }
    catch (cleanupError) { throw new AggregateError([error,cleanupError],"durability create and suffix cleanup failed"); }
    assert.deepEqual(await countCanonical(), before, "canonical candidate count changed after failed-create cleanup");
    throw error;
  }
}

async function readbackCleanup() {
  const jobId = process.env.DURABILITY_PROBE_JOB_ID;
  assert.match(jobId ?? "", /^[0-9a-f-]{36}$/, "DURABILITY_PROBE_JOB_ID invalid");
  const before = await countCanonical();
  const binding = await postgresRuntimeBinding(pool);
  const readback = (await pool.query(`SELECT j.id,j.script_id,j.product_id,j.user_id,j.state,s.job_id script_job,
    (SELECT count(*)::int FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id AND a.action='job.created') audit_rows,
    (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id) ledger_rows
    FROM jobs j JOIN scripts s ON s.id=j.script_id WHERE j.id=$1`, [jobId])).rows[0];
  assert.ok(readback, "job missing on post-exit new connection");
  assert.equal(readback.user_id, ids.user); assert.equal(readback.product_id, ids.product);
  assert.equal(readback.script_id, ids.script); assert.equal(readback.script_job, jobId);
  assert.equal(readback.audit_rows, 1); assert.equal(readback.ledger_rows, 0);
  const cleaned = await cleanupFixture();
  assert.equal(cleaned.jobs, 1, "scoped cleanup expected exactly the readback job");
  assert.deepEqual(await countCanonical(), before, "canonical candidate count changed");
  console.log(JSON.stringify({event:"DURABILITY_READBACK_CLEANUP_PASS",suffix,job_id:jobId,binding_sha256:binding.sha256,
    new_process:true,new_pool:true,job:1,script_pointer:1,audit_rows:1,ledger_rows:0,cleanup:"PASS",
    provider_calls:0,queue_writes:0,canonical_before:before,canonical_after:before}));
}

async function main() {
  try {
    if (selfCheck) console.log("DURABILITY_PROBE_RUNTIME_SELF_CHECK_PASS");
    else if (mode === "create") await create();
    else if (mode === "readback-cleanup") await readbackCleanup();
    else throw new Error("mode must be create or readback-cleanup");
  } finally { await pool.end(); await closeAllPools(); }
}

main().catch((error) => {
  console.error("DURABILITY_PROBE_FAIL", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
