/**
 * Video Promosi (non-ecommerce) prototype worker. Runs in-process (no BullMQ/
 * Redis queue) — deliberately not sharing the production job queue used by
 * the revenue-critical e-commerce pipeline. Fire-and-forget from the API
 * route; client polls GET /api/promo/jobs/:id for state.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { mediaStorage } from "../storage";
import { generateVideoWithFailover } from "../providers/registry";
import { extractReferenceFrame, buildHookVisualSpec } from "./hook-generator";
import { stitchClips } from "./stitch";
import { PgPromoJobsRepository, type PromoJob } from "../postgres/promo-jobs";

const HOOK_DURATION_SEC = 6;

/** @param job Full row (avoids a redundant fetch — caller already has it from create()). */
export async function processPromoJob(job: PromoJob): Promise<void> {
  const repo = new PgPromoJobsRepository(config.databaseUrl);
  const workDir = path.join(config.storageDir, "promo_jobs", job.id);
  try {
    fs.mkdirSync(workDir, { recursive: true });

    const uploadedClipLocal = await mediaStorage().materialize(job.uploaded_clip_url);
    if (!uploadedClipLocal) throw new Error("Klip upload tidak ditemukan di storage.");

    await repo.setState(job.id, "GENERATING_HOOK");
    const refFrame = await extractReferenceFrame(uploadedClipLocal, workDir);
    const spec = buildHookVisualSpec({ jobId: job.id, imageRefPath: refFrame, durationSec: HOOK_DURATION_SEC });
    const video = await generateVideoWithFailover(spec, workDir);
    const hookClip = video.assets[0];
    if (!hookClip) throw new Error("Provider video tidak menghasilkan klip hook.");
    await repo.addCost(job.id, video.costIdr);
    const hookRel = `promo_jobs/${job.id}/hook.mp4`;
    await mediaStorage().put(hookRel, fs.readFileSync(hookClip.filePath), "video/mp4");
    await repo.setGeneratedShot(job.id, hookRel);

    await repo.setState(job.id, "STITCHING");
    const stitched = await stitchClips({
      jobId: job.id,
      workDir,
      clipPaths: [uploadedClipLocal, hookClip.filePath],
      aiClipDurationsSec: [HOOK_DURATION_SEC],
    });
    const outputRel = `promo_jobs/${job.id}/output.mp4`;
    await mediaStorage().put(outputRel, fs.readFileSync(stitched.outPath), "video/mp4");
    if (config.storageMode !== "filesystem") fs.rmSync(workDir, { recursive: true, force: true });

    await repo.markReady(job.id, outputRel);
    console.log(`[promo-worker] job ${job.id}: READY (${outputRel})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[promo-worker] job ${job.id}: FAILED — ${message}`);
    await repo.markFailed(job.id, message);
  } finally {
    await repo.close();
  }
}
