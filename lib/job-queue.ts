/**
 * Redis-compatible job queue boundary.
 *
 * BullMQ is used because Render Key Value speaks Redis and BullMQ provides
 * atomic job-id deduplication, durable retries/backoff, and worker locks.
 * The web process only enqueues; `scripts/worker.ts` owns consumption.
 */
import { Queue } from "bullmq";
import { config } from "./config";
import { PRIORITAS, type AsalJob } from "./prioritas-antrean";

export type QueueMode = "inline" | "redis";

export class QueueConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueConfigurationError";
  }
}

export function queueMode(): QueueMode {
  if (config.queueMode === "inline" || config.queueMode === "redis") return config.queueMode;
  throw new QueueConfigurationError("RACUN_QUEUE_MODE harus bernilai inline atau redis.");
}

export function assertQueueConfiguration(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "RACUN_QUEUE_MODE" | "REDIS_URL">> = process.env
): void {
  const mode = env.RACUN_QUEUE_MODE ?? "inline";
  if (mode !== "inline" && mode !== "redis") throw new QueueConfigurationError("RACUN_QUEUE_MODE harus bernilai inline atau redis.");
  // Production web must never run a forever-loop worker or silently lose jobs.
  if (env.NODE_ENV === "production" && mode !== "redis") {
    throw new QueueConfigurationError("Production wajib RACUN_QUEUE_MODE=redis; worker inline ditolak.");
  }
  if (mode === "redis" && !env.REDIS_URL) {
    throw new QueueConfigurationError("REDIS_URL wajib saat RACUN_QUEUE_MODE=redis.");
  }
}

function redisConnection() {
  assertQueueConfiguration();
  if (!config.redisUrl) throw new QueueConfigurationError("REDIS_URL wajib saat RACUN_QUEUE_MODE=redis.");
  return { url: config.redisUrl, maxRetriesPerRequest: null };
}

let redisQueue: Queue<{ jobId: string }> | undefined;
export function getRedisJobQueue(): Queue<{ jobId: string }> {
  if (!redisQueue) redisQueue = new Queue<{ jobId: string }>(config.redisQueueName, { connection: redisConnection() });
  return redisQueue;
}

/** Enqueue is durable and idempotent while the BullMQ job id exists. */
export async function enqueueRedisJob(jobId: string, asal: AsalJob = "retail"): Promise<void> {
  await getRedisJobQueue().add("render", { jobId }, {
    jobId,
    // Brand didahulukan atas retail — lihat lib/prioritas-antrean.ts. Bawaan
    // "retail" dipilih sengaja: jalur yang lupa menyebut asalnya tidak boleh
    // diam-diam naik kelas.
    priority: PRIORITAS[asal],
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 7 * 86_400, count: 5_000 },
  });
}

/**
 * The route-facing entry point. Redis mode has no dependency on the media
 * worker module; inline imports it only when a developer explicitly chooses
 * the SQLite rollback path.
 */
export async function enqueueJob(jobId: string, asal: AsalJob = "retail"): Promise<void> {
  if (process.env.RACUN_WORKER_DISABLED === "1") return;
  if (queueMode() === "redis") return enqueueRedisJob(jobId, asal);
  const inline = await import("./worker");
  await inline.enqueueInlineJob(jobId);
}

/** Enqueue ulang job yang SUDAH pernah jalan (lanjut setelah brand menyetujui
 * scene, atau setelah minta generate ulang — M11).
 *
 * enqueueJob() TIDAK bisa dipakai di sini: BullMQ men-dedupe berdasarkan
 * job-id, dan record job lama masih ada sampai removeOnComplete kedaluwarsa
 * (24 jam). add() dengan id yang sama akan DIABAIKAN diam-diam — job tidak
 * pernah dilanjutkan dan brand menunggu selamanya tanpa error apa pun.
 * Karena itu id BullMQ-nya unik per percobaan; payload {jobId} tetap sama,
 * dan itulah yang dibaca worker (scripts/worker.ts: job.data.jobId). */
export async function enqueueJobResume(jobId: string, reason: string, asal: AsalJob = "brand"): Promise<void> {
  if (process.env.RACUN_WORKER_DISABLED === "1") return;
  if (queueMode() === "redis") {
    await getRedisJobQueue().add("render", { jobId }, {
      jobId: `${jobId}:${reason}:${Date.now()}`,
      // Bawaan "brand" di sini, BUKAN "retail": melanjutkan job adalah alur
      // persetujuan scene milik dashboard brand. Job yang sudah setengah jalan
      // dan sudah dibayar tidak pantas mengantre ulang dari belakang.
      priority: PRIORITAS[asal],
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 7 * 86_400, count: 5_000 },
    });
    return;
  }
  const inline = await import("./worker");
  await inline.enqueueInlineJob(jobId);
}

/** Test/lifecycle helper: closes the producer's Redis connection. */
export async function closeRedisJobQueue(): Promise<void> {
  if (redisQueue) await redisQueue.close();
  redisQueue = undefined;
}
