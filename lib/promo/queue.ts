/**
 * Video Promosi (non-ecommerce) prototype — dedicated BullMQ queue.
 *
 * ARCHITECTURE NOTE (found during prototype testing): the web service runs
 * plain Node with no ffmpeg/ffprobe binaries — only the worker service (its
 * own Dockerfile.worker) has them. `processPromoJob` calls ffmpeg (frame
 * extraction, stitching) and MUST run in that worker container, not
 * in-process on the web service. This queue is separate from
 * config.redisQueueName (the e-commerce queue) to avoid entangling this
 * prototype with the production retry/refund semantics in scripts/worker.ts.
 */
import { Queue } from "bullmq";
import { config } from "../config";

export const PROMO_QUEUE_NAME = "racun-promo-jobs";

let queue: Queue<{ jobId: string }> | undefined;
export function getPromoQueue(): Queue<{ jobId: string }> {
  if (!queue) {
    if (!config.redisUrl) throw new Error("REDIS_URL wajib untuk queue Video Promosi.");
    queue = new Queue<{ jobId: string }>(PROMO_QUEUE_NAME, { connection: { url: config.redisUrl, maxRetriesPerRequest: null } });
  }
  return queue;
}

export async function enqueuePromoJob(jobId: string): Promise<void> {
  await getPromoQueue().add("promo-render", { jobId }, {
    jobId,
    // Found via a live staging incident: the worker instance can be
    // restarted by the platform mid-job (unrelated to this code), which
    // orphans the in-flight attempt. BullMQ's stalled-job detection can
    // only recover it if another attempt is allowed — attempts:1 meant an
    // orphaned job just sat there forever with no error and no retry.
    attempts: 2,
    backoff: { type: "fixed", delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 7 * 86_400, count: 500 },
  });
}
