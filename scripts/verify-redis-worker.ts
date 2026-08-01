import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const url = process.env.REDIS_URL;
assert.ok(url, "REDIS_URL wajib");
const parsed = new URL(url);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname), "hanya Redis loopback lokal");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "racun-redis-worker-"));
process.env.DB_PATH = path.join(tmp, "worker.db");
process.env.STORAGE_DIR = path.join(tmp, "storage");

const { getDb, now, uuid } = await import("../lib/db");
const { enqueueRedisJob, closeRedisJobQueue } = await import("../lib/job-queue");
const db = getDb();
const userId = uuid();
const jobId = uuid();
const productId = uuid();
const scriptId = uuid();
db.prepare("INSERT INTO users (id,email,tier,locale,created_at) VALUES (?,?,?,?,?)").run(userId, `worker-${jobId}@local.test`, "free", "id-ID", now());
db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?,?,?,?,?,?)").run(productId, userId, "Produk queue proof", 5000, "beauty", "[]", now());
db.prepare(`INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(scriptId, productId, "H1", "senang", "bestie", "[]", "", "[]", "{}", "silent_caption", now(), now());
db.prepare(`INSERT INTO jobs (id,user_id,product_id,persona_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at)
  VALUES (?,?,?,?,?,'hands_only','silent_caption',15,'QUEUED',?,?)`).run(jobId, userId, productId, null, scriptId, now(), now());
db.prepare("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,payment_id,created_at) VALUES (?,?,?,?,?,?,?)").run(uuid(), userId, -5000, "hold", jobId, null, now());

// No script exists: processJob fails deterministically. The separate worker
// must retry twice, then run the established FAILED -> REFUNDED release once.
const child = spawn("npx", ["tsx", "scripts/worker.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, REDIS_URL: url, RACUN_QUEUE_MODE: "redis", WORKER_CONCURRENCY: "1", RACUN_NO_DOTENV: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (chunk) => { logs += String(chunk); });
child.stderr.on("data", (chunk) => { logs += String(chunk); });
try {
  await enqueueRedisJob(jobId);
  const deadline = Date.now() + 20_000;
  let state = "";
  while (Date.now() < deadline) {
    state = (db.prepare("SELECT state FROM jobs WHERE id=?").get(jobId) as { state: string }).state;
    if (state === "REFUNDED") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(state, "REFUNDED", `worker tidak me-refund setelah retry final: ${logs}`);
  const release = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(delta),0) AS amount FROM credit_ledger WHERE job_id=? AND type='release'").get(jobId) as { n: number; amount: number };
  assert.deepEqual(release, { n: 1, amount: 5000 }, "refund final harus sekali dan persis hold");
  console.log(JSON.stringify({ queue: process.env.REDIS_QUEUE_NAME, jobId, terminal: state, release, status: "PASS" }));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await closeRedisJobQueue();
  fs.rmSync(tmp, { recursive: true, force: true });
}
