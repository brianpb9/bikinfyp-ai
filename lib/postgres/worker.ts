/** PostgreSQL-native background worker for the reversible cutover.
 *
 * The normal path uses the same provider, compositing, QC and storage modules
 * as the SQLite rollback worker. `RACUN_WORKER_DETERMINISTIC=1` is a local
 * integration fixture only; it produces a real H.264/AAC asset without any
 * provider credentials and is rejected in production.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { config } from "../config";
import { outputExtras, cartLabelForUrl } from "../script-engine";
import { formatHargaOverlay, type SegmentDraft } from "../script-engine/templates";
import { getCreatorCategory } from "../personas";
import { planShots } from "../media/shot-planner";
import { compositeVideo, type CompositeMode } from "../media/compositor";
import { runQc } from "../media/qc";
import { buildCaptionCards } from "../media/captions";
import { renderCaptionPngs } from "../media/render-captions";
import { runFf } from "../media/ffmpeg";
import { generateVideoWithFailover, synthesizeVoiceWithFailover } from "../providers/registry";
import { isMockProviderName, type QualityTier } from "../providers/types";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";
import { mediaStorage } from "../storage";
import { PgCreditPaymentRepository } from "./credit-payment";
import { PgJobsRepository } from "./jobs";

const uuid = () => crypto.randomUUID();
const at = () => new Date().toISOString();
function assertUrl() { if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) throw new Error("DATABASE_URL PostgreSQL wajib untuk worker pg."); return config.databaseUrl; }
function deterministicFixtureAllowed() { return process.env.RACUN_WORKER_DETERMINISTIC === "1" && process.env.NODE_ENV !== "production"; }

type WorkerRow = {
  id: string; user_id: string; product_id: string; persona_id: string | null; script_id: string;
  format: string; quality_tier: string; duration_s: number; state: string;
  script_segments: string; caption: string; hashtags: string; script_register: string; script_hook_family: string;
  product_name: string; product_category: string; product_visual_desc: string | null; product_images: string; product_price_idr: number;
  product_source_url: string | null;
  creator_category: string | null;
};

export async function processPostgresJob(jobId: string, options: { retryViaQueue?: boolean } = {}): Promise<void> {
  const databaseUrl = assertUrl();
  const jobs = new PgJobsRepository(databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const found = await pool.query<WorkerRow>(`SELECT j.*, s.segments AS script_segments, s.caption, s.hashtags, s.register AS script_register, s.hook_family AS script_hook_family,
      p.name AS product_name, p.category AS product_category, p.product_visual_desc, p.images AS product_images, p.price_idr AS product_price_idr, p.source_url AS product_source_url,
      pe.creator_category
      FROM jobs j JOIN scripts s ON s.id=j.script_id JOIN products p ON p.id=j.product_id
      LEFT JOIN personas pe ON pe.id=j.persona_id WHERE j.id=$1`, [jobId]);
    const row = found.rows[0];
    if (!row || ["READY", "FAILED", "REFUNDED"].includes(row.state)) return;
    // A retry must never be acknowledged as a successful no-op merely because
    // its earlier attempt already claimed the job. Until resumable provider
    // checkpoints are introduced, rethrowing makes BullMQ exhaust its bounded
    // attempts and execute the single established refund path.
    if (row.state !== "QUEUED") throw new Error(`Job PostgreSQL belum resumable dari state ${row.state}; retry harus gagal agar refund final berjalan.`);
    if (!(await jobs.transition(jobId, "GENERATING_VISUAL", { worker: "postgres" }))) return;

    if (deterministicFixtureAllowed()) {
      await runDeterministicFixture(row, jobs, pool);
    } else {
      await runProviderPipeline(row, jobs, pool);
    }
    const credits = new PgCreditPaymentRepository(databaseUrl);
    try { await credits.captureCredits(row.user_id, jobId); } finally { await credits.close(); }
  } catch (error) {
    if (options.retryViaQueue) throw error;
    await jobs.failJob(jobId, error instanceof Error ? error.message : String(error));
  } finally { await jobs.close(); await pool.end(); }
}

async function runDeterministicFixture(row: WorkerRow, jobs: PgJobsRepository, pool: Pool) {
  if (process.env.RACUN_WORKER_FIXTURE_FAIL === "1") throw new Error("Forced deterministic PostgreSQL worker failure.");
  const relVideo = `jobs/${row.id}/output.mp4`;
  const local = path.join(config.storageDir, relVideo);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  await runFf(config.ffmpegPath, ["-y", "-f", "lavfi", "-i", `color=c=0x1f2937:s=720x1280:r=30:d=${row.duration_s}`, "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=44100:duration=${row.duration_s}`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", local]);
  await jobs.setProviders(row.id, "deterministic-postgres-test", "none-silent-caption");
  for (const state of ["GENERATING_VOICE", "COMPOSITING", "QC_CHECK", "LABELING"] as const) if (!(await jobs.transition(row.id, state, { worker: "postgres-fixture" }))) return;
  await persistReadyOutput(row, jobs, pool, relVideo, local, { passed: true, checks: [{ code: "QC-08", status: "pass" }], fixture: true });
}

async function runProviderPipeline(row: WorkerRow, jobs: PgJobsRepository, pool: Pool) {
  // A deployment cannot silently use the mock provider. Local developers can
  // still use the established SQLite rollback path for mock experimentation.
  if (config.providerVideo === "mock") throw new Error("Worker PostgreSQL membutuhkan PROVIDER_VIDEO nyata; fixture hanya diizinkan untuk test lokal eksplisit.");
  const segments = JSON.parse(row.script_segments) as SegmentDraft[];
  const images = JSON.parse(row.product_images) as string[];
  if (images.length === 0) throw new Error("Produk tidak punya foto — upload minimal 1 foto.");
  const imageRef = await mediaStorage().materialize(images[0]);
  if (!imageRef) throw new Error("Foto produk tidak ditemukan di storage.");
  const workDir = path.join(config.storageDir, "jobs", row.id);
  fs.mkdirSync(workDir, { recursive: true });
  const category = getCreatorCategory(row.creator_category ?? "hijaber")!;
  const tier = (row.quality_tier ?? "silent_caption") as QualityTier;
  const withAudio = tier !== "silent_caption";
  const spec = planShots({ jobId: row.id, durationSec: row.duration_s, segments, category, productName: row.product_name,
    productCategory: row.product_category, productVisualDesc: row.product_visual_desc, imageRefPath: imageRef, qualityTier: tier,
    format: row.format === "hands_only" ? "hands_only" : undefined });
  const video = await generateVideoWithFailover(spec, workDir);
  await jobs.setProviders(row.id, video.providerName);
  await jobs.addCost(row.id, video.costIdr);

  if (!(await jobs.transition(row.id, "GENERATING_VOICE", { worker: "postgres" }))) return;
  const vo: { path: string; startSec: number }[] = [];
  const usedMockVideo = isMockProviderName(video.providerName);
  if (!withAudio) await jobs.setProviders(row.id, undefined, "none-silent-caption");
  else if (!usedMockVideo) await jobs.setProviders(row.id, undefined, "embedded-model");
  else {
    let voiceProvider = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const result = await synthesizeVoiceWithFailover({ jobId: row.id, text: segment.text, segmentIndex: i, slotSec: segment.end - segment.start, language: "id-ID", register: row.script_register }, workDir);
      if (!voiceProvider) voiceProvider = result.providerName;
      vo.push({ path: result.asset.filePath, startSec: segment.start });
      await jobs.addCost(row.id, result.costIdr);
    }
    await jobs.setProviders(row.id, undefined, `${voiceProvider} (simulasi embedded)`);
  }
  const mode: CompositeMode = !withAudio ? "caption" : usedMockVideo ? "vo" : "embedded";
  const captions = !withAudio ? await renderCaptionPngs(buildCaptionCards({ segments, productName: row.product_name }), workDir) : undefined;
  const musicPath = !withAudio ? path.join(process.cwd(), "assets", "music", "bg-loop.m4a") : undefined;
  const demo = segments.find((segment) => segment.role === "demo");
  const cta = segments.find((segment) => segment.role === "cta");
  if (!demo || !cta) throw new Error("Segmen demo/CTA wajib untuk compositing.");
  // "Kuning" cuma istilah TikTok Shop (lihat cartLabelForUrl di script-engine/index.ts,
  // keputusan Brian 2026-08-03) — badge/QC di sini harus ikut, bukan hardcoded.
  const cartLabel = cartLabelForUrl(row.product_source_url);
  const ctaBadgeText = cartLabel === "keranjang kuning" ? "Klik Keranjang Kuning »" : "Klik Keranjang »";
  const ctaQcText = cartLabel === "keranjang kuning" ? "Klik Keranjang Kuning" : "Klik Keranjang";
  let outputPath = "";
  let renderParams = { watermark: true as const, watermarkText: AIGC_WATERMARK_TEXT };
  let qc: Awaited<ReturnType<typeof runQc>> | null = null;
  for (let retry = 0; retry < 2; retry++) {
    if (!(await jobs.transition(row.id, "COMPOSITING", { worker: "postgres", retry }))) return;
    const composite = await compositeVideo({ jobId: row.id, workDir, clipPaths: video.assets.map((asset) => asset.filePath), mode,
      vo: mode === "vo" ? vo : undefined, captions, musicPath, durationSec: row.duration_s,
      priceText: `Cuma ${formatHargaOverlay(row.product_price_idr)}`, ctaText: ctaBadgeText,
      demoRange: [demo.start, demo.end], ctaRange: [cta.start, cta.end], providerVideo: video.providerName });
    outputPath = composite.outPath; renderParams = composite.renderParams;
    if (!(await jobs.transition(row.id, "QC_CHECK", { worker: "postgres" }))) return;
    qc = await runQc({ filePath: outputPath, targetDurationSec: row.duration_s,
      finalTexts: [...segments.map((segment) => segment.text), formatHargaOverlay(row.product_price_idr), `Cek ${cartLabel}`, AIGC_WATERMARK_TEXT],
      hookFamily: row.script_hook_family, register: row.script_register, productName: row.product_name, priceIdr: row.product_price_idr,
      renderParams, shotPaths: video.assets.map((asset) => asset.filePath), refImagePath: imageRef, format: row.format,
      overlayTextExpectations: [
        { text: AIGC_WATERMARK_TEXT, startSec: 0, endSec: row.duration_s },
        ...(mode === "caption"
          ? (captions ?? []).filter((card) => card.segmentRole !== "cta").map((card) => ({ text: card.text, startSec: card.startSec, endSec: card.endSec }))
          : [{ text: `Cuma ${formatHargaOverlay(row.product_price_idr)}`, startSec: demo.start, endSec: demo.end }]),
        { text: ctaQcText, startSec: cta.start, endSec: cta.end },
      ],
    });
    await pool.query("UPDATE jobs SET qc_result=$1,qc_retry_count=$2 WHERE id=$3", [JSON.stringify(qc), retry, row.id]);
    if (qc.passed) break;
    if (retry === 1) throw new Error(`QC gagal setelah retry: ${qc.checks.filter((check) => check.status === "fail").map((check) => check.code).join(", ")}`);
  }
  if (!qc?.passed) throw new Error("QC tidak menghasilkan output lulus.");
  if (!(await jobs.transition(row.id, "LABELING", { watermark: renderParams.watermarkText }))) return;
  const relVideo = path.relative(config.storageDir, outputPath).split(path.sep).join("/");
  await persistReadyOutput(row, jobs, pool, relVideo, outputPath, qc);
}

async function persistReadyOutput(row: WorkerRow, jobs: PgJobsRepository, pool: Pool, relVideo: string, local: string, qc: unknown) {
  await mediaStorage().put(relVideo, fs.readFileSync(local), "video/mp4");
  if (config.storageMode !== "filesystem") fs.rmSync(local, { force: true });
  const extras = outputExtras(row.product_category);
  if (!(await jobs.upsertOutput({ jobId: row.id, userId: row.user_id, videoUrl: relVideo, caption: row.caption, hashtags: row.hashtags,
    suggestedPostTime: extras.suggested_post_time, complianceChecklist: JSON.stringify(extras.compliance_checklist) }))) throw new Error("Kepemilikan output job tidak valid.");
  await pool.query("UPDATE jobs SET qc_result=$1,output_url=$2,completed_at=$3 WHERE id=$4", [JSON.stringify(qc), relVideo, at(), row.id]);
  if (!(await jobs.transition(row.id, "READY", { worker: "postgres" }))) throw new Error("Job tidak lagi aktif saat finalisasi output.");
}

/** The Redis worker owns timeout recovery while PostgreSQL is the runtime. */
export async function sweepPostgresStaleJobs(): Promise<number> {
  const jobs = new PgJobsRepository(assertUrl(), { stateTimeoutsMin: config.stateTimeoutsMin });
  try { return await jobs.sweepStaleJobs(); } finally { await jobs.close(); }
}
