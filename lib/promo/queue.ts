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
    // Found via live staging incidents: this instance gets restarted by the
    // platform mid-job unusually often (observed 2 restarts within ~15
    // minutes during testing), each one orphaning the in-flight attempt.
    // attempts:2 still weren't enough — a second restart burned the retry
    // before stitching could finish. Generous budget here, not because the
    // pipeline itself is flaky (proven correct locally across several clip
    // combinations) but because this specific instance's restart cadence is.
    attempts: 5,
    backoff: { type: "fixed", delay: 5_000 },
    removeOnComplete: { age: 86_400, count: 500 },
    removeOnFail: { age: 7 * 86_400, count: 500 },
  });
}
