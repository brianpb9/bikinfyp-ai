/** Dedicated background worker. Run with `npm run worker` (never from web). */
import { Worker } from "bullmq";
import { config } from "../lib/config";
import { getJob, failJob, sweepStaleJobs } from "../lib/jobs";
import { assertQueueConfiguration, queueMode } from "../lib/job-queue";
import { processJob } from "../lib/worker";
import { processPostgresJob, sweepPostgresStaleJobs } from "../lib/postgres/worker";
import { setTaskMemo } from "../lib/providers/task-memo";
import { pgTaskMemo } from "../lib/postgres/task-memo";
import { installNormalEvidenceStoreForRuntime } from "../lib/providers/normal-evidence";
import { pgNormalEvidenceStore } from "../lib/postgres/normal-evidence";
import { postgresRuntimeEnabled } from "../lib/postgres/smoke-runtime";
import { redactWorkerError } from "../lib/worker-log";
import { monitoringSettings, runOperationalMonitor } from "../lib/operational-monitor";
import { PROMO_QUEUE_NAME } from "../lib/promo/queue";
import { processPromoJob } from "../lib/promo/worker";
import { assertRuntimeAuthSecretSafe } from "../lib/runtime/assert-runtime-auth-secret";
import { finalWorkerFailureReason } from "../lib/errors";

// Dedicated workers do not execute Next instrumentation. Enforce the same
// production runtime-secret boundary before memo wiring, queue validation, or
// either BullMQ worker can be created.
assertRuntimeAuthSecretSafe();

// Provider sengaja buta database (lib/providers/task-memo.ts). Worker-lah yang
// memasang implementasi nyatanya, dan HARUS sebelum job pertama diambil —
// kalau tidak, percobaan pertama berjalan dengan memo no-op dan justru jendela
// paling rawan (submit lalu proses mati) tetap terbuka.
setTaskMemo(pgTaskMemo);
installNormalEvidenceStoreForRuntime(postgresRuntimeEnabled(), pgNormalEvidenceStore);

assertQueueConfiguration();
if (queueMode() !== "redis") throw new Error("Worker terpisah membutuhkan RACUN_QUEUE_MODE=redis.");
if (!config.redisUrl) throw new Error("REDIS_URL wajib untuk worker Redis.");

const worker = new Worker<{ jobId: string }>(
  config.redisQueueName,
  async (job) => postgresRuntimeEnabled() ? processPostgresJob(job.data.jobId, { retryViaQueue: true }) : processJob(job.data.jobId, { retryViaQueue: true }),
  { connection: { url: config.redisUrl, maxRetriesPerRequest: null }, concurrency: Math.max(1, config.workerConcurrency) }
);

// Video Promosi (non-ecommerce) prototype — separate queue, separate state
// machine, no credit ledger/refund entanglement with the queue above. Runs
// in this same Docker container because that's where ffmpeg/ffprobe live.
const promoWorker = postgresRuntimeEnabled()
  ? new Worker<{ jobId: string }>(
      PROMO_QUEUE_NAME,
      async (job) => processPromoJob(job.data.jobId),
      {
        connection: { url: config.redisUrl, maxRetriesPerRequest: null },
        concurrency: 1,
        // Found via live staging incidents: this instance gets restarted by
        // the platform mid-job unusually often. BullMQ's own stalled-job
        // ceiling (maxStalledCount, default 1) is a SEPARATE limit from the
        // per-job `attempts` set at enqueue (lib/promo/queue.ts) — bumping
        // attempts alone still let "job stalled more than allowable limit"
        // permanently fail a job after its second stall, regardless of
        // remaining attempts. Both ceilings need headroom for this instance.
        maxStalledCount: 5,
      }
    )
  : null;
promoWorker?.on("failed", (job, error) => {
  if (!job) return;
  const message = redactWorkerError(error.message);
  console.error(JSON.stringify({ event: "promo_worker_job_failed", job_id: job.data.jobId, message }));
  // BullMQ only emits "failed" once a job is DEFINITIVELY done retrying
  // (attempts exhausted OR its separate maxStalledCount ceiling exceeded —
  // see lib/promo/queue.ts and this file's Worker options). Found via a
  // live incident: processPromoJob's own catch block already calls
  // markFailed for an in-process throw, but a job that BullMQ gives up on
  // via the stalled path (worker process died mid-run, nothing left to run
  // that catch block) never got its promo_jobs row updated — it stayed
  // stuck reporting STITCHING/GENERATING_HOOK forever, worse than an honest
  // FAILED. This is the backstop for exactly that path.
  void (async () => {
    const { PgPromoJobsRepository } = await import("../lib/postgres/promo-jobs");
    const repo = new PgPromoJobsRepository(config.databaseUrl);
    let userId: string | null = null;
    let bolehRefund = false;
    try {
      const row = await repo.getById(job.data.jobId);
      userId = row?.user_id ?? null;
      // Nilai baliknya menentukan boleh-tidaknya refund di bawah: markFailed
      // menolak menimpa job yang sudah READY, dan job READY berarti videonya
      // sudah diserahkan.
      bolehRefund = await repo.markFailed(job.data.jobId, `Worker gagal (stalled/attempts habis): ${message}`);
    } finally { await repo.close(); }
    // Same backstop reasoning as markFailed above: processPromoJob's own
    // catch block (which releases the credit hold) never ran for a job
    // BullMQ gave up on via the stalled path — release it here instead so
    // the user isn't charged for a video that was never produced.
    if (userId && bolehRefund) {
      const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
      const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
      try { await creditsRepo.releaseCredits(userId, job.data.jobId); } finally { await creditsRepo.close(); }
    }
  })();
});

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
    const finalReason = finalWorkerFailureReason(error, attempts);
    if (postgresRuntimeEnabled()) {
      void (async () => { const { PgJobsRepository } = await import("../lib/postgres/jobs"); const jobs = new PgJobsRepository(config.databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin }); try { await jobs.failJob(job.data.jobId, finalReason); } finally { await jobs.close(); } })();
    } else { const current = getJob(job.data.jobId); if (current) failJob(current, finalReason); }
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

let monitorInFlight = false;
async function runMonitorOnce(event: string) {
  if (monitorInFlight) return;
  monitorInFlight = true;
  try {
    const result = await runOperationalMonitor();
    if (result.checked || result.sent || event === "operational_monitor_startup") console.log(JSON.stringify({ event, ...result }));
  } catch (error) {
    console.error("[monitor] pemeriksaan operasional gagal:", redactWorkerError(error instanceof Error ? error.message : String(error)));
  } finally { monitorInFlight = false; }
}
const monitorTimer = setInterval(() => {
  void runMonitorOnce("operational_monitor");
}, monitoringSettings().intervalMs);
monitorTimer.unref();
if (config.operationalMonitoringEnabled) {
  void runMonitorOnce("operational_monitor_startup");
}

async function shutdown(signal: string) {
  console.log(`[worker] ${signal}: menutup worker dengan aman`);
  clearInterval(sweepTimer);
  clearInterval(monitorTimer);
  await worker.close();
  await promoWorker?.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
console.log(`[worker] Redis queue ${config.redisQueueName}; concurrency=${Math.max(1, config.workerConcurrency)}`);
if (promoWorker) console.log(`[worker] Promo queue ${PROMO_QUEUE_NAME}; concurrency=1`);
