import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
assert.ok(databaseUrl, "DATABASE_URL disposable wajib");
assert.ok(redisUrl, "REDIS_URL lokal wajib");
assert.equal(process.env.RACUN_DB_RUNTIME, "postgres", "verifier harus menguji runtime PostgreSQL");
assert.equal(process.env.RACUN_WORKER_DETERMINISTIC, "1", "fixture harus selalu eksplisit");

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const pool = new Pool({ connectionString: databaseUrl });
const userId = id(); const productId = id(); const scriptId = id(); const jobId = id();
await pool.query("INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)", [userId, `pg-worker-${jobId}@local.test`, now()]);
await pool.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk PostgreSQL',5000,'beauty','[]',$3)", [productId, userId, now()]);
await pool.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at) VALUES ($1,$2,'H1','senang','bestie','[]','Caption worker','#worker','{}','silent_caption',$3,$3)", [scriptId, productId, now()]);
await pool.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only','silent_caption',15,'QUEUED',$5,$5)", [jobId, userId, productId, scriptId, now()]);
await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-5000,'hold',$3,$4)", [id(), userId, jobId, now()]);

const { enqueueRedisJob, closeRedisJobQueue } = await import("../lib/job-queue");
const child = spawn("npx", ["tsx", "scripts/worker.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, RACUN_DB_RUNTIME: "postgres", RACUN_QUEUE_MODE: "redis", PROVIDER_VIDEO: "mock", RACUN_WORKER_DETERMINISTIC: "1", RACUN_NO_DOTENV: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += String(chunk); });
child.stderr.on("data", (chunk) => { logs += String(chunk); });
async function stop(childProcess: ReturnType<typeof spawn>) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  childProcess.kill("SIGTERM");
  await new Promise((resolve) => childProcess.once("exit", resolve));
}
try {
  await enqueueRedisJob(jobId);
  const deadline = Date.now() + 30_000;
  let state = "";
  while (Date.now() < deadline) {
    state = String((await pool.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0]?.state ?? "");
    if (state === "READY") break;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  assert.equal(state, "READY", `worker PostgreSQL tidak menghasilkan READY: ${logs}`);
  const output = (await pool.query("SELECT video_url,caption FROM outputs WHERE job_id=$1", [jobId])).rows[0];
  assert.ok(output?.video_url, "output PostgreSQL harus tercatat");
  assert.equal(output.caption, "Caption worker");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type='capture'", [jobId])).rows[0].n, 1, "hold harus di-capture tepat sekali");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type='release'", [jobId])).rows[0].n, 0, "job berhasil tidak boleh refund");
  assert.ok(fs.existsSync(`${process.env.STORAGE_DIR}/${output.video_url}`), "asset fixture worker harus benar-benar tersimpan lokal");
  await stop(child);

  // Attack the retry path separately: an error after the job is claimed must
  // still reach BullMQ's final FAILED -> REFUNDED release exactly once.
  const failingJobId = id();
  await pool.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only','silent_caption',15,'QUEUED',$5,$5)", [failingJobId, userId, productId, scriptId, now()]);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-5000,'hold',$3,$4)", [id(), userId, failingJobId, now()]);
  const failingChild = spawn("npx", ["tsx", "scripts/worker.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl, RACUN_DB_RUNTIME: "postgres", RACUN_QUEUE_MODE: "redis", PROVIDER_VIDEO: "mock", RACUN_WORKER_DETERMINISTIC: "1", RACUN_WORKER_FIXTURE_FAIL: "1", RACUN_NO_DOTENV: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let failedLogs = "";
  failingChild.stdout.on("data", (chunk) => { failedLogs += String(chunk); });
  failingChild.stderr.on("data", (chunk) => { failedLogs += String(chunk); });
  try {
    await enqueueRedisJob(failingJobId);
    const failureDeadline = Date.now() + 30_000;
    let failureState = "";
    while (Date.now() < failureDeadline) {
      failureState = String((await pool.query("SELECT state FROM jobs WHERE id=$1", [failingJobId])).rows[0]?.state ?? "");
      if (failureState === "REFUNDED") break;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    assert.equal(failureState, "REFUNDED", `error retry PostgreSQL tidak sampai refund final: ${failedLogs}`);
    const release = (await pool.query("SELECT COUNT(*)::int AS n,COALESCE(SUM(delta),0)::int AS amount FROM credit_ledger WHERE job_id=$1 AND type='release'", [failingJobId])).rows[0];
    assert.deepEqual(release, { n: 1, amount: 5000 }, "release final harus sekali dan persis nilai hold");
    console.log(JSON.stringify({ queue: process.env.REDIS_QUEUE_NAME, jobId, terminal: state, output: output.video_url, failedJobId: failingJobId, failedTerminal: failureState, release, status: "PASS" }));
  } finally { await stop(failingChild); }
} finally {
  await stop(child);
  await closeRedisJobQueue();
  await pool.end();
}
