import assert from "node:assert/strict";
import { QueueEvents, Worker } from "bullmq";

const url = process.env.REDIS_URL;
assert.ok(url, "REDIS_URL wajib untuk verifikasi Redis queue.");
const parsed = new URL(url);
assert.ok(["redis:", "rediss:"].includes(parsed.protocol), "REDIS_URL harus redis:// atau rediss://.");
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname), "Verifier hanya menerima Redis loopback lokal.");

// Import after env validation: config reads env once at module load.
const { enqueueRedisJob, getRedisJobQueue, closeRedisJobQueue } = await import("../lib/job-queue");
const queueName = process.env.REDIS_QUEUE_NAME!;
const connection = { url, maxRetriesPerRequest: null };
const queue = getRedisJobQueue();
const events = new QueueEvents(queueName, { connection });
await events.waitUntilReady();

let attempts = 0;
const worker = new Worker<{ jobId: string }>(queueName, async () => {
  attempts++;
  if (attempts < 3) throw new Error("transient test failure");
  return { delivered: true };
}, { connection, concurrency: 1 });

try {
  const jobId = `queue-proof-${process.pid}`;
  await enqueueRedisJob(jobId);
  await enqueueRedisJob(jobId); // same BullMQ job id must not duplicate delivery
  const job = await queue.getJob(jobId);
  assert.ok(job, "job harus tersimpan durable di Redis");
  await job.waitUntilFinished(events, 15_000);
  assert.equal(attempts, 3, "retry harus dua kali dengan attempt ketiga sukses");
  const completed = await queue.getJob(jobId);
  assert.equal(completed?.attemptsMade, 3, "BullMQ harus mencatat tiga attempt");
  const counts = await queue.getJobCounts("completed", "waiting", "active", "delayed");
  assert.equal(counts.waiting + counts.active + counts.delayed, 0, "dedup tidak boleh meninggalkan job kedua");
  console.log(JSON.stringify({ redis: parsed.host, queue: queueName, attempts, jobId, status: "PASS" }));
} finally {
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await closeRedisJobQueue();
}
