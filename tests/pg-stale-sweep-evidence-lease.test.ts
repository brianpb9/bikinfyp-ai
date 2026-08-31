/** Real PostgreSQL integration for evidence-lease versus stale-sweep races.
 * Every row is synthetic and lives only in the disposable local database
 * created by scripts/test-postgres-stale-sweep-evidence-lease.sh. */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ACTIVE_EVIDENCE_LEASE, normalEvidenceLeaseWindow } from "../lib/normal-evidence-lease";

const URL_UJI = process.env.UJI_PG_URL ?? "";
const skip = !URL_UJI;
if (!skip) {
  process.env.DATABASE_URL = URL_UJI;
  process.env.RACUN_DB_RUNTIME = "postgres";
  process.env.RACUN_NO_DOTENV = "1";
}

const EVALUATED_AT = "2026-08-31T12:48:27.525Z";
const OLD = "2026-08-31T08:04:15.376Z";
const ACTIVE_PROGRESS = "2026-08-31T10:00:08.702Z";
const TASK = "NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829";
const id = () => crypto.randomUUID();
let pool: Pool;

before(async () => { if (!skip) pool = new Pool({ connectionString: URL_UJI, max: 12 }); });
after(async () => {
  if (skip) return;
  await pool.end();
  const { closePool } = await import("../lib/postgres/pool");
  await closePool?.();
});

type Fixture = { userId: string; productId: string; scriptId: string; jobId: string };
async function fixture(state = "QUEUED", at = OLD): Promise<Fixture> {
  const userId=id(),productId=id(),scriptId=id(),jobId=id();
  await pool.query("INSERT INTO users (id,email,created_at) VALUES ($1,$2,$3)", [userId, `lease-${userId}@example.test`, at]);
  await pool.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Noncanonical Lease Fixture',12000,'beauty','[]',$3)", [productId,userId,at]);
  await pool.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','joy','casual','[]','fixture','[]','{}',$3)", [scriptId,productId,at]);
  await pool.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'talking_head','high_quality',15,$5,$6,$6)", [jobId,userId,productId,scriptId,state,at]);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)", [id(),userId,jobId,at]);
  return {userId,productId,scriptId,jobId};
}

async function evidence(f: Fixture, input: {
  state?: string; providerPostCount?: number; taskId?: string | null;
  progressAt?: string; expiresAt?: string;
}) {
  const progressAt=input.progressAt ?? ACTIVE_PROGRESS;
  const expiresAt=input.expiresAt ?? normalEvidenceLeaseWindow(progressAt).expiresAt;
  const post=input.providerPostCount ?? 0,state=input.state ?? "PREPOST_READY";
  await pool.query(
    `INSERT INTO normal_representative_evidence_runs
      (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
       reference_brand,authorization_source,product_snapshot_sha256,deploy_sha,model,category,format,duration_s,
       resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,payload_sha256,provider_task_id,
       task_bound_at,created_at,updated_at,lease_kind,lease_last_progress_at,lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Fixture','approved_reference_manifest:v2',$9,$10,
       'dreamina-seedance-2-0-mini-260615','beauty','talking_head',15,'720p',1.134,1.25,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19)`,
    [TASK,crypto.createHash("sha256").update(f.jobId).digest("hex"),f.jobId,f.userId,f.productId,id(),
      "a".repeat(64),"b".repeat(64),"c".repeat(64),"d".repeat(40),post,state,
      post ? "e".repeat(64) : null,input.taskId ?? null,input.taskId ? progressAt : null,
      progressAt,ACTIVE_EVIDENCE_LEASE,progressAt,expiresAt]
  );
}

async function cleanup(f: Fixture) {
  // The disposable fixture database enforces append-only production triggers.
  // Use a transaction-local replication role solely to recycle the one
  // schema-authorized ordinary evidence task id between isolated test cases.
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role=replica");
    await client.query("DELETE FROM normal_representative_evidence_runs WHERE job_id=$1", [f.jobId]);
    await client.query("DELETE FROM credit_ledger WHERE job_id=$1", [f.jobId]);
    await client.query("DELETE FROM audit_log WHERE entity_id=$1", [f.jobId]);
    await client.query("DELETE FROM jobs WHERE id=$1", [f.jobId]);
    await client.query("DELETE FROM scripts WHERE id=$1", [f.scriptId]);
    await client.query("DELETE FROM products WHERE id=$1", [f.productId]);
    await client.query("DELETE FROM users WHERE id=$1", [f.userId]);
    await client.query("COMMIT");
  } catch(error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { client.release(); }
}

async function sweeper() {
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  return new PgJobsRepository(URL_UJI, {
    now: () => EVALUATED_AT,
    stateTimeoutsMin: { QUEUED: 30, GENERATING_VISUAL: 90 },
  });
}

test("stale abandoned job is refunded with a stable decision receipt", {skip,concurrency:false}, async () => {
  const f=await fixture(),repo=await sweeper();
  try {
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),1);
    const job=(await pool.query("SELECT state FROM jobs WHERE id=$1",[f.jobId])).rows[0];
    const terminal=(await pool.query("SELECT type,delta FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')",[f.jobId])).rows;
    const transitions=(await pool.query("SELECT meta FROM audit_log WHERE entity_id=$1 AND action='job.transition' ORDER BY created_at,id",[f.jobId])).rows;
    assert.equal(job.state,"REFUNDED");assert.deepEqual(terminal.map(x=>[x.type,Number(x.delta)]),[["release",12000]]);
    const meta=transitions.map(({meta})=>JSON.parse(meta)).find((entry)=>entry.reason_code==="STALE_SWEEP_TIMEOUT");
    assert.ok(meta,"stable stale-sweep decision receipt missing");assert.equal(meta.threshold_seconds,1800);
    assert.equal(meta.last_progress_at,OLD);assert.equal(meta.evaluated_at,EVALUATED_AT);assert.equal(meta.state,"QUEUED");assert.equal(meta.predicate_match,true);
    const release=JSON.parse((await pool.query("SELECT meta FROM audit_log WHERE entity_id=$1 AND action='credit.release'",[f.jobId])).rows[0].meta);
    assert.equal(release.refund_reason_code,"STALE_SWEEP_TIMEOUT");
  } finally { await repo.close(); await cleanup(f); }
});

test("active pre-provider evidence lease is not refunded", {skip,concurrency:false}, async () => {
  const f=await fixture(),repo=await sweeper();
  try {
    await evidence(f,{expiresAt:"2026-08-31T16:00:08.702Z"});
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),0);
    assert.equal((await pool.query("SELECT state FROM jobs WHERE id=$1",[f.jobId])).rows[0].state,"QUEUED");
    assert.equal((await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='release'",[f.jobId])).rows[0].n,0);
  } finally { await repo.close(); await cleanup(f); }
});

test("expired PREPOST_READY lease cannot claim a provider POST", {skip,concurrency:false}, async () => {
  const f=await fixture();
  const progressAt=new Date(Date.now()-2*60*60*1000).toISOString();
  const expiresAt=new Date(Date.now()-60*60*1000).toISOString();
  try {
    await evidence(f,{progressAt,expiresAt});
    const { pgNormalEvidenceStore } = await import("../lib/postgres/normal-evidence");
    const claim=await pgNormalEvidenceStore.claimPost(f.jobId,"e".repeat(64));
    assert.deepEqual(claim,{action:"STOP_NO_RETRY"});
    const row=(await pool.query(
      "SELECT state,provider_post_count,payload_sha256,lease_kind,lease_expires_at FROM normal_representative_evidence_runs WHERE job_id=$1",
      [f.jobId]
    )).rows[0];
    assert.equal(row.state,"PREPOST_READY");assert.equal(Number(row.provider_post_count),0);
    assert.equal(row.payload_sha256,null);assert.equal(row.lease_kind,"ACTIVE_EVIDENCE_LEASE");
    assert.equal(new Date(row.lease_expires_at).toISOString(),expiresAt);
  } finally { await cleanup(f); }
});

test("expired pre-provider lease follows STOP_NO_RETRY plus refund contract", {skip,concurrency:false}, async () => {
  const f=await fixture(),repo=await sweeper();
  try {
    await evidence(f,{progressAt:"2026-08-31T05:00:00.000Z",expiresAt:"2026-08-31T11:00:00.000Z"});
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),1);
    const row=(await pool.query("SELECT state,stop_reason,lease_kind FROM normal_representative_evidence_runs WHERE job_id=$1",[f.jobId])).rows[0];
    assert.deepEqual(row,{state:"STOP_NO_RETRY",stop_reason:"ACTIVE_EVIDENCE_LEASE_EXPIRED",lease_kind:null});
    assert.equal((await pool.query("SELECT state FROM jobs WHERE id=$1",[f.jobId])).rows[0].state,"REFUNDED");
  } finally { await repo.close(); await cleanup(f); }
});

test("expired provider in-flight evidence is never generically refunded", {skip,concurrency:false}, async () => {
  const f=await fixture("GENERATING_VISUAL"),repo=await sweeper();
  try {
    await evidence(f,{state:"TASK_BOUND",providerPostCount:1,taskId:`fixture-${id()}`,progressAt:"2026-08-31T05:00:00.000Z",expiresAt:"2026-08-31T11:00:00.000Z"});
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),0);
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),0);
    assert.equal((await pool.query("SELECT state FROM jobs WHERE id=$1",[f.jobId])).rows[0].state,"GENERATING_VISUAL");
    assert.equal((await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='release'",[f.jobId])).rows[0].n,0);
  } finally { await repo.close(); await cleanup(f); }
});

test("already refunded job is idempotent across repeated sweeps", {skip,concurrency:false}, async () => {
  const f=await fixture(),repo=await sweeper();
  try {
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),1);
    assert.equal(await repo.sweepStaleJobs(Date.parse(EVALUATED_AT)),0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='release'",[f.jobId])).rows[0].n,1);
  } finally { await repo.close(); await cleanup(f); }
});

test("concurrent activation and sweep are exactly-once safe under job-then-evidence locks", {skip,concurrency:false}, async () => {
  const f=await fixture(),repo=await sweeper();
  const activation:PoolClient=await pool.connect();
  try {
    await activation.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const locked=(await activation.query("SELECT state FROM jobs WHERE id=$1 FOR UPDATE",[f.jobId])).rows[0];
    assert.equal(locked.state,"QUEUED");
    const sweepPromise=repo.sweepStaleJobs(Date.parse(EVALUATED_AT));
    await new Promise(resolve=>setTimeout(resolve,50));
    const lease=normalEvidenceLeaseWindow(ACTIVE_PROGRESS);
    await activation.query(
      `INSERT INTO normal_representative_evidence_runs
        (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
         reference_brand,authorization_source,product_snapshot_sha256,deploy_sha,model,category,format,duration_s,
         resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,created_at,updated_at,
         lease_kind,lease_last_progress_at,lease_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Fixture','approved_reference_manifest:v2',$9,$10,
         'dreamina-seedance-2-0-mini-260615','beauty','talking_head',15,'720p',1.134,1.25,0,'PREPOST_READY',$11,$11,$12,$13,$14)`,
      [TASK,crypto.createHash("sha256").update(f.jobId).digest("hex"),f.jobId,f.userId,f.productId,id(),
        "a".repeat(64),"b".repeat(64),"c".repeat(64),"d".repeat(40),ACTIVE_PROGRESS,lease.kind,lease.lastProgressAt,lease.expiresAt]
    );
    await activation.query("COMMIT");
    assert.equal(await sweepPromise,0);
    assert.equal((await pool.query("SELECT state FROM jobs WHERE id=$1",[f.jobId])).rows[0].state,"QUEUED");
    assert.equal((await pool.query("SELECT count(*)::int n FROM normal_representative_evidence_runs WHERE job_id=$1",[f.jobId])).rows[0].n,1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM credit_ledger WHERE job_id=$1 AND type='release'",[f.jobId])).rows[0].n,0);
  } catch(error) { await activation.query("ROLLBACK").catch(()=>undefined); throw error; }
  finally { activation.release(); await repo.close(); await cleanup(f); }
});
