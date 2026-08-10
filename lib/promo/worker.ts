/**
 * Video Promosi (non-ecommerce) prototype worker. Runs inside the Docker
 * worker service (scripts/worker.ts, second BullMQ Worker on
 * lib/promo/queue.ts's queue) — that container has ffmpeg/ffprobe; the web
 * service does not. Deliberately not sharing the e-commerce jobs queue/state
 * machine: this is prototype-only, unbilled, isolated.
 *
 * Stage 3: N uploaded clips (not just 1). Output order is [AI hook, then
 * uploaded clips in upload order] — "hook" means opening/attention-grabbing
 * segment, so it plays first, not appended at the end.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { mediaStorage } from "../storage";
import { runFfmpeg, probeDurationSec, probeHasAudioStream, probeHasVideoStream } from "../media/ffmpeg";
import { generateVideoWithFailover } from "../providers/registry";
import { extractReferenceFrame, buildHookVisualSpec } from "./hook-generator";
import { synthesizeHookVoiceover } from "./voiceover";
import { stitchClips, type StitchClip } from "./stitch";
import { PgPromoJobsRepository } from "../postgres/promo-jobs";
import { PgCreditPaymentRepository } from "../postgres/credit-payment";
import { computeViralityChecklist } from "../virality-checklist";
import { HOOK_LIBRARY, getHookById } from "./hook-library";
import { resolveAvatarDescription } from "./avatar";

const MAX_DURATION_SEC = 60;
// BytePlus shots run best in roughly this range (SRS: umumnya <=12 dtk/klip);
// VO's real spoken length drives the hook's video duration so they land in
// sync without padding/trimming — clamped so a very short/long placeholder
// script can't push the video-gen call outside the provider's sane range.
// Floor is 4, not 2-3 (r-r2v-fix 2026-08-11): r2v mode (most hook-library
// entries) rejects duration<4 as InvalidParameter — see minDur in
// lib/providers/stubs/byteplus.ts.
const HOOK_DURATION_MIN_SEC = 4;
const HOOK_DURATION_MAX_SEC = 10;

export async function processPromoJob(jobId: string): Promise<void> {
  const repo = new PgPromoJobsRepository(config.databaseUrl);
  const workDir = path.join(config.storageDir, "promo_jobs", jobId);
  let userId: string | null = null;
  try {
    const job = await repo.getById(jobId);
    if (!job) throw new Error("Promo job tidak ditemukan.");
    userId = job.user_id;
    // Only bail on a TERMINAL state. A prior "already processed" check
    // (`!== "QUEUED"`) blocked BullMQ's own retry from ever doing anything —
    // a job orphaned mid-run by a worker restart (state stuck at
    // GENERATING_HOOK/STITCHING, no live process left to finish or fail it)
    // would sit there forever, because the redelivered attempt saw a non-
    // QUEUED state and returned immediately. No resumable checkpoints exist
    // yet, so a retry redoes the whole pipeline from scratch (wastes one
    // duplicate BytePlus/ElevenLabs call on the rare orphan case — acceptable
    // for an unbilled prototype, not for the same reasoning as production).
    if (job.state === "READY" || job.state === "FAILED") return;

    fs.mkdirSync(workDir, { recursive: true });

    // Materialize + validate every uploaded clip. ffprobe only lives in this
    // Docker worker container — not the web upload route.
    const uploadedClips: string[] = [];
    for (const [i, url] of job.uploadedClipUrls.entries()) {
      const local = await mediaStorage().materialize(url);
      if (!local) throw new Error(`Klip upload #${i + 1} tidak ditemukan di storage.`);
      if (!(await probeHasVideoStream(local))) throw new Error(`Klip upload #${i + 1} bukan video yang valid.`);
      if (!(await probeHasAudioStream(local))) throw new Error(`Klip upload #${i + 1} belum ada suaranya — prototype ini butuh klip yang ada audio (talking-head).`);
      const durationSec = await probeDurationSec(local);
      if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error(`Durasi klip upload #${i + 1} tidak terbaca.`);
      if (durationSec > MAX_DURATION_SEC) throw new Error(`Klip upload #${i + 1} maksimal ${MAX_DURATION_SEC} detik untuk prototype ini.`);
      uploadedClips.push(local);
    }

    await repo.setState(jobId, "GENERATING_HOOK");
    // VO first: its real spoken length drives the hook video's duration so
    // the two stay in sync without padding/trimming logic.
    const vo = await synthesizeHookVoiceover(workDir);
    await repo.addCost(jobId, vo.costIdr);
    const hookDurationSec = Math.min(HOOK_DURATION_MAX_SEC, Math.max(HOOK_DURATION_MIN_SEC, vo.durationSec));
    // Reference frame from the FIRST uploaded clip — keeps the hook visually
    // continuous (background/setting) with whatever the video opens into.
    const refFrame = await extractReferenceFrame(uploadedClips[0], workDir);
    // Toggle "hook normal <-> crazy" (Brian 2026-08-10): job carries the
    // hook_id picked on the config screen; fall back to a safe default for
    // jobs from before this field existed (or a bad/removed id).
    const hookEntry = getHookById(job.hook_id ?? "") ?? HOOK_LIBRARY.find((h) => h.intensity === 3) ?? HOOK_LIBRARY[0];
    const avatarDescription = hookEntry.hasPerson
      ? resolveAvatarDescription({
          kind: job.avatar_kind === "custom" ? "custom" : "preset",
          presetId: job.avatar_preset_id ?? undefined,
          customDescription: job.avatar_custom_description ?? undefined,
        })
      : null;
    const spec = buildHookVisualSpec({ jobId, imageRefPath: refFrame, durationSec: hookDurationSec, hookEntry, avatarDescription });
    const video = await generateVideoWithFailover(spec, workDir);
    const hookClip = video.assets[0];
    if (!hookClip) throw new Error("Provider video tidak menghasilkan klip hook.");
    await repo.addCost(jobId, video.costIdr);
    // Ide "rakit-sendiri" digenerate maju (ledakan keluar) lalu diputar
    // mundur di sini supaya jadi efek "produk merakit diri sendiri".
    let hookClipPath = hookClip.filePath;
    if (hookEntry.reverse) {
      const reversedPath = path.join(workDir, "hook_reversed.mp4");
      await runFfmpeg(["-y", "-v", "error", "-i", hookClipPath, "-vf", "reverse", "-an", reversedPath]);
      hookClipPath = reversedPath;
    }
    const hookRel = `promo_jobs/${jobId}/hook.mp4`;
    await mediaStorage().put(hookRel, fs.readFileSync(hookClipPath), "video/mp4");
    await repo.setGeneratedShot(jobId, hookRel);

    await repo.setState(jobId, "STITCHING");
    const clips: StitchClip[] = [
      { videoPath: hookClipPath, audio: { kind: "file", path: vo.filePath, durationSec: hookDurationSec } },
      ...uploadedClips.map((videoPath): StitchClip => ({ videoPath, audio: { kind: "embedded" } })),
    ];
    const stitched = await stitchClips({ jobId, workDir, clips });
    // Rule-based virality checklist (v1, heuristic — see lib/virality-checklist.ts):
    // computed here because ffprobe only lives in this worker container, not
    // the web tier that eventually serves it. Stage 5.1 (2026-08-03): every VO
    // script now closes with a real CTA line (lib/promo/hook-patterns.ts), so
    // hasCta is honestly true — this checklist flagged the earlier gap.
    const outputDurationSec = await probeDurationSec(stitched.outPath);
    const virality = computeViralityChecklist({ durationSec: outputDurationSec, hasCta: true, hasAudioOrCaption: true });
    await repo.setViralityChecklist(jobId, virality);
    const outputRel = `promo_jobs/${jobId}/output.mp4`;
    await mediaStorage().put(outputRel, fs.readFileSync(stitched.outPath), "video/mp4");
    if (config.storageMode !== "filesystem") fs.rmSync(workDir, { recursive: true, force: true });

    await repo.markReady(jobId, outputRel);
    console.log(`[promo-worker] job ${jobId}: READY (${outputRel}, ${uploadedClips.length} klip upload + 1 hook)`);
    const captureRepo = new PgCreditPaymentRepository(config.databaseUrl);
    try { await captureRepo.captureCredits(userId, jobId); } finally { await captureRepo.close(); }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[promo-worker] job ${jobId}: FAILED — ${message}`);
    await repo.markFailed(jobId, message);
    if (userId) {
      const releaseRepo = new PgCreditPaymentRepository(config.databaseUrl);
      try { await releaseRepo.releaseCredits(userId, jobId); } finally { await releaseRepo.close(); }
    }
    throw err; // let BullMQ record the failure event too
  } finally {
    await repo.close();
  }
}
