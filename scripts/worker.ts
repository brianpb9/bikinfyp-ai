/** Dedicated background worker. Run with `npm run worker` (never from web). */
import { Worker } from "bullmq";
import { config } from "../lib/config";
import { getJob, failJob, sweepStaleJobs } from "../lib/jobs";
import { assertQueueConfiguration, queueMode } from "../lib/job-queue";
import { processJob } from "../lib/worker";
import { processPostgresJob, sweepPostgresStaleJobs } from "../lib/postgres/worker";
import { postgresRuntimeEnabled } from "../lib/postgres/smoke-runtime";
import { redactWorkerError } from "../lib/worker-log";

assertQueueConfiguration();
if (queueMode() !== "redis") throw new Error("Worker terpisah membutuhkan RACUN_QUEUE_MODE=redis.");
if (!config.redisUrl) throw new Error("REDIS_URL wajib untuk worker Redis.");

const worker = new Worker<{ jobId: string }>(
  config.redisQueueName,
  async (job) => postgresRuntimeEnabled() ? processPostgresJob(job.data.jobId, { retryViaQueue: true }) : processJob(job.data.jobId, { retryViaQueue: true }),
  { connection: { url: config.redisUrl, maxRetriesPerRequest: null }, concurrency: Math.max(1, config.workerConcurrency) }
);

worker.on("failed", (job, error) => {
  if (!job) return;
  const attempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
  console.error(JSON.stringify({
    event: "worker_job_failed",
    job_id: job.data.jobId,
    attempts_made: job.attemptsMade,
    attempts_allowed: attempts,
    message: redactWorkerError(error.message),
  }));
  // BullMQ increments attemptsMade before emitting failed; only the final
  // failure enters the established FAILED -> release -> REFUNDED workflow.
  if (job.attemptsMade >= attempts) {
    if (postgresRuntimeEnabled()) {
      void (async () => { const { PgJobsRepository } = await import("../lib/postgres/jobs"); const jobs = new PgJobsRepository(config.databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin }); try { await jobs.failJob(job.data.jobId, `Worker gagal setelah ${attempts} percobaan: ${error.message}`); } finally { await jobs.close(); } })();
    } else { const current = getJob(job.data.jobId); if (current) failJob(current, `Worker gagal setelah ${attempts} percobaan: ${error.message}`); }
  }
});

const sweepTimer = setInterval(() => {
  if (postgresRuntimeEnabled()) {
    void sweepPostgresStaleJobs().catch((error) => console.error("[worker] gagal menyapu timeout PostgreSQL:", error));
  } else {
    sweepStaleJobs();
  }
}, 60_000);
sweepTimer.unref();

async function shutdown(signal: string) {
  console.log(`[worker] ${signal}: menutup worker dengan aman`);
  clearInterval(sweepTimer);
  await worker.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
console.log(`[worker] Redis queue ${config.redisQueueName}; concurrency=${Math.max(1, config.workerConcurrency)}`);
