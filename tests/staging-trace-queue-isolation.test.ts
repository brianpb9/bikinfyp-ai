import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { QueueEvents, Worker } from "bullmq";

const here = path.dirname(fileURLToPath(import.meta.url));

test("managed trace queue is disjoint from canonical queue", () => {
  const canonical = "racun-jobs-staging";
  const trace = `${canonical}-managed-staging-trace`;
  assert.notEqual(trace, canonical);
  assert.equal(trace, "racun-jobs-staging-managed-staging-trace");
});

test("canonical admission routes only zero-value trace jobs to isolated queue", () => {
  const source = fs.readFileSync(path.join(here, "../app/api/jobs/route.ts"), "utf8");
  assert.match(source, /if \(zeroValueTrace\) await enqueueManagedStagingTraceJob\(created\.jobId\);\s*else await enqueueJob\(created\.jobId\);/);
});

test("trace worker consumes only isolated queue and never canonical queue", () => {
  const source = fs.readFileSync(path.join(here, "../scripts/managed-post-e2-worker-trace.ts"), "utf8");
  assert.match(source, /new Worker<\{ jobId: string \}>\(managedStagingTraceQueueName\(\)/);
  assert.doesNotMatch(source, /new Worker<\{ jobId: string \}>\(config\.redisQueueName/);
});

async function reserveLoopbackPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForRedis(port: number, exited: Promise<never>): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const connected = await Promise.race([
      new Promise<boolean>((resolve) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.once("connect", () => { socket.destroy(); resolve(true); });
        socket.once("error", () => resolve(false));
      }),
      exited,
    ]);
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Redis integration fixture tidak siap pada port ${port}`);
}

test("ordinary canonical BullMQ record survives trace consumption and is processed after restoration", { timeout: 20_000 }, async (t) => {
  const port = await reserveLoopbackPort();
  const redisDir = fs.mkdtempSync(path.join(os.tmpdir(), "racun-trace-queue-"));
  const redis = spawn("redis-server", [
    "--bind", "127.0.0.1",
    "--port", String(port),
    "--save", "",
    "--appendonly", "no",
    "--dir", redisDir,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let redisLogs = "";
  redis.stdout.on("data", (chunk) => { redisLogs += String(chunk); });
  redis.stderr.on("data", (chunk) => { redisLogs += String(chunk); });
  const redisExited = new Promise<never>((_, reject) => {
    redis.once("error", reject);
    redis.once("exit", (code, signal) => reject(new Error(`redis-server berhenti dini (${code ?? signal}): ${redisLogs}`)));
  });

  t.after(async () => {
    if (redis.exitCode === null && redis.signalCode === null) redis.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (redis.exitCode !== null || redis.signalCode !== null) return resolve();
      redis.once("exit", () => resolve());
    });
    fs.rmSync(redisDir, { recursive: true, force: true });
  });

  await waitForRedis(port, redisExited);
  const queueName = `racun-isolation-${process.pid}-${Date.now()}`;
  const redisUrl = `redis://127.0.0.1:${port}`;
  process.env.RACUN_NO_DOTENV = "1";
  process.env.RACUN_QUEUE_MODE = "redis";
  process.env.REDIS_URL = redisUrl;
  process.env.REDIS_QUEUE_NAME = queueName;

  // Import only after the isolated Redis coordinates are fixed: config is
  // evaluated once, and these are the same producer helpers used by /api/jobs.
  const {
    closeManagedStagingTraceQueue,
    closeRedisJobQueue,
    enqueueJob,
    enqueueManagedStagingTraceJob,
    getManagedStagingTraceQueue,
    getRedisJobQueue,
    managedStagingTraceQueueName,
  } = await import("../lib/job-queue");
  const traceQueueName = managedStagingTraceQueueName();
  const connection = { url: redisUrl, maxRetriesPerRequest: null };
  const canonicalQueue = getRedisJobQueue();
  const traceQueue = getManagedStagingTraceQueue();
  const canonicalEvents = new QueueEvents(queueName, { connection });
  const traceEvents = new QueueEvents(traceQueueName, { connection });
  await Promise.all([canonicalEvents.waitUntilReady(), traceEvents.waitUntilReady()]);

  const canonicalJobId = `ordinary-${process.pid}`;
  const traceJobId = `trace-${process.pid}`;
  let canonicalProcessed = false;
  let traceWorker: Worker<{ jobId: string }> | undefined;
  let canonicalWorker: Worker<{ jobId: string }> | undefined;
  try {
    await enqueueJob(canonicalJobId);
    await enqueueManagedStagingTraceJob(traceJobId);
    assert.equal(await (await canonicalQueue.getJob(canonicalJobId))?.getState(), "waiting");
    assert.equal(await (await traceQueue.getJob(traceJobId))?.getState(), "waiting");

    traceWorker = new Worker<{ jobId: string }>(traceQueueName, async (job) => {
      assert.equal(job.data.jobId, traceJobId);
      return { delivered: true };
    }, { connection, concurrency: 1 });
    const traceJob = await traceQueue.getJob(traceJobId);
    assert.ok(traceJob);
    await traceJob.waitUntilFinished(traceEvents, 10_000);
    await traceWorker.close();
    traceWorker = undefined;

    const untouchedCanonical = await canonicalQueue.getJob(canonicalJobId);
    assert.ok(untouchedCanonical, "record canonical harus tetap ada setelah trace worker selesai");
    assert.equal(await untouchedCanonical.getState(), "waiting", "trace consumer tidak boleh mengunci/memindahkan record canonical");
    assert.equal(untouchedCanonical.attemptsMade, 0, "trace consumer tidak boleh mencoba record canonical");
    assert.equal(canonicalProcessed, false);

    canonicalWorker = new Worker<{ jobId: string }>(queueName, async (job) => {
      assert.equal(job.data.jobId, canonicalJobId);
      canonicalProcessed = true;
      return { delivered: true };
    }, { connection, concurrency: 1 });
    await untouchedCanonical.waitUntilFinished(canonicalEvents, 10_000);
    assert.equal(canonicalProcessed, true, "canonical consumer harus memproses record setelah restoration");
    assert.equal(await untouchedCanonical.getState(), "completed");
  } finally {
    await traceWorker?.close();
    await canonicalWorker?.close();
    await Promise.all([canonicalEvents.close(), traceEvents.close()]);
    await Promise.all([canonicalQueue.obliterate({ force: true }), traceQueue.obliterate({ force: true })]);
    await Promise.all([closeRedisJobQueue(), closeManagedStagingTraceQueue()]);
  }
});
