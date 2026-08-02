/**
 * Video Promosi (non-ecommerce) prototype worker. Runs inside the Docker
 * worker service (scripts/worker.ts, second BullMQ Worker on
 * lib/promo/queue.ts's queue) — that container has ffmpeg/ffprobe; the web
 * service does not. Deliberately not sharing the e-commerce jobs queue/state
 * machine: this is prototype-only, unbilled, isolated.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { mediaStorage } from "../storage";
import { probeDurationSec, probeHasAudioStream, probeHasVideoStream } from "../media/ffmpeg";
import { generateVideoWithFailover } from "../providers/registry";
import { extractReferenceFrame, buildHookVisualSpec } from "./hook-generator";
import { stitchClips } from "./stitch";
import { PgPromoJobsRepository } from "../postgres/promo-jobs";

const HOOK_DURATION_SEC = 6;
const MAX_DURATION_SEC = 60;

export async function processPromoJob(jobId: string): Promise<void> {
  const repo = new PgPromoJobsRepository(config.databaseUrl);
  const workDir = path.join(config.storageDir, "promo_jobs", jobId);
  try {
    const job = await repo.getById(jobId);
    if (!job) throw new Error("Promo job tidak ditemukan.");
    if (job.state !== "QUEUED") return; // already processed/processing — avoid double-run on redelivery

    fs.mkdirSync(workDir, { recursive: true });

    const uploadedClipLocal = await mediaStorage().materialize(job.uploaded_clip_url);
    if (!uploadedClipLocal) throw new Error("Klip upload tidak ditemukan di storage.");

    // Validation lives here (not the web upload route): ffprobe is only
    // available in this Docker worker container.
    if (!(await probeHasVideoStream(uploadedClipLocal))) throw new Error("File bukan video yang valid.");
    if (!(await probeHasAudioStream(uploadedClipLocal))) throw new Error("Video belum ada suaranya — prototype ini butuh klip yang ada audio (talking-head).");
    const durationSec = await probeDurationSec(uploadedClipLocal);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("Durasi video tidak terbaca.");
    if (durationSec > MAX_DURATION_SEC) throw new Error(`Video maksimal ${MAX_DURATION_SEC} detik untuk prototype ini.`);

    await repo.setState(jobId, "GENERATING_HOOK");
    const refFrame = await extractReferenceFrame(uploadedClipLocal, workDir);
    const spec = buildHookVisualSpec({ jobId, imageRefPath: refFrame, durationSec: HOOK_DURATION_SEC });
    const video = await generateVideoWithFailover(spec, workDir);
    const hookClip = video.assets[0];
    if (!hookClip) throw new Error("Provider video tidak menghasilkan klip hook.");
    await repo.addCost(jobId, video.costIdr);
    const hookRel = `promo_jobs/${jobId}/hook.mp4`;
    await mediaStorage().put(hookRel, fs.readFileSync(hookClip.filePath), "video/mp4");
    await repo.setGeneratedShot(jobId, hookRel);

    await repo.setState(jobId, "STITCHING");
    const stitched = await stitchClips({
      jobId,
      workDir,
      clipPaths: [uploadedClipLocal, hookClip.filePath],
      aiClipDurationsSec: [HOOK_DURATION_SEC],
    });
    const outputRel = `promo_jobs/${jobId}/output.mp4`;
    await mediaStorage().put(outputRel, fs.readFileSync(stitched.outPath), "video/mp4");
    if (config.storageMode !== "filesystem") fs.rmSync(workDir, { recursive: true, force: true });

    await repo.markReady(jobId, outputRel);
    console.log(`[promo-worker] job ${jobId}: READY (${outputRel})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[promo-worker] job ${jobId}: FAILED — ${message}`);
    await repo.markFailed(jobId, message);
    throw err; // let BullMQ record the failure event too
  } finally {
    await repo.close();
  }
}
