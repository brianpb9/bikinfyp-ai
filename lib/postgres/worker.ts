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
import { findReusableClips } from "../media/resume-clips";
import { compositeVideo, type CompositeMode } from "../media/compositor";
import { runQc } from "../media/qc";
import { buildCaptionCards } from "../media/captions";
import { resolvePromo, formatPromoOverlayText } from "../promo";
import { renderCaptionPngs } from "../media/render-captions";
import { runFf } from "../media/ffmpeg";
import { generateVideoWithFailover, synthesizeVoiceWithFailover } from "../providers/registry";
import { isMockProviderName, type QualityTier } from "../providers/types";
import { buildPhotoPanVideo } from "../media/photo-video";
import { synthesizeElevenLabsVoiceover } from "../media/vo-tts";
import { synthesizeGeminiVoiceover } from "../media/gemini-tts";
import { hargaTerbilang } from "../script-engine/terbilang";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";
import { mediaStorage } from "../storage";
import { MAX_IMAGES } from "../product-images";
import { personSafeReferencePhotos } from "../media/person-safe-refs";
import { loadJobShots, materializeJobShots, persistJobShots } from "./job-shots";
import { PgCreditPaymentRepository } from "./credit-payment";
import { PgJobsRepository } from "./jobs";
import { getPool } from "./pool";

const uuid = () => crypto.randomUUID();
const at = () => new Date().toISOString();
function assertUrl() { if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) throw new Error("DATABASE_URL PostgreSQL wajib untuk worker pg."); return config.databaseUrl; }
function deterministicFixtureAllowed() { return process.env.RACUN_WORKER_DETERMINISTIC === "1" && process.env.NODE_ENV !== "production"; }

type WorkerRow = {
  id: string; user_id: string; org_id: string | null; product_id: string; persona_id: string | null; script_id: string;
  format: string; quality_tier: string; duration_s: number; state: string;
  script_segments: string; caption: string; hashtags: string; script_register: string; script_hook_family: string;
  script_hook_level: string | null;
  avatar_custom_desc: string | null;
  requires_approval: boolean;
  approved_at: string | null;
  product_name: string; product_category: string; product_visual_desc: string | null; brand_brief: string | null; product_images: string; product_price_idr: number;
  promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
  product_source_url: string | null;
  creator_category: string | null;
};

export async function processPostgresJob(jobId: string, options: { retryViaQueue?: boolean } = {}): Promise<void> {
  const databaseUrl = assertUrl();
  const jobs = new PgJobsRepository(databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin });
  const pool = getPool(databaseUrl);
  try {
    // j.* sudah bawa org_id (kolom asli tabel jobs, M1) — WorkerRow.org_id
    // dipakai supaya capture ledger di bawah masuk ke wallet yang benar
    // (pool org untuk job dari dashboard bulk-generate, user biasa untuk retail).
    const found = await pool.query<WorkerRow>(`SELECT j.*, s.segments AS script_segments, s.caption, s.hashtags, s.register AS script_register, s.hook_family AS script_hook_family, s.hook_level AS script_hook_level,
      p.name AS product_name, p.category AS product_category, p.product_visual_desc, p.brand_brief, p.images AS product_images, p.price_idr AS product_price_idr, p.source_url AS product_source_url,
      p.promo_price_before_idr, p.promo_ends_at, p.promo_stock_left,
      pe.creator_category
      FROM jobs j JOIN scripts s ON s.id=j.script_id JOIN products p ON p.id=j.product_id
      LEFT JOIN personas pe ON pe.id=j.persona_id WHERE j.id=$1`, [jobId]);
    const row = found.rows[0];
    if (!row || ["READY", "FAILED", "REFUNDED"].includes(row.state)) return;
    // r13 (review QA 2026-08-07): dulu SETIAP retry BullMQ untuk state != QUEUED
    // langsung gagal instan ("belum resumable") -> kegagalan transien SETELAH
    // video sukses (compositing/storage/dsb) selalu membakar biaya provider
    // tanpa percobaan ulang sungguhan. processPostgresJob HANYA pernah dipanggil
    // dari satu tempat (scripts/worker.ts, BullMQ Worker processor) — BullMQ
    // menjamin attempt berikutnya baru mulai SETELAH promise attempt sebelumnya
    // reject (tidak ada eksekusi konkuren utk job yang sama), jadi retry di sini
    // aman dilanjutkan. transition() sendiri permisif (active->active) sehingga
    // reset ke GENERATING_VISUAL harmless. Yang benar-benar menghemat biaya:
    // findReusableClips() di runProviderPipeline melewati provider bila klip
    // dari upaya sebelumnya masih ada & valid di disk (lihat resume-clips.ts).
    if (!(await jobs.transition(jobId, "GENERATING_VISUAL", { worker: "postgres" }))) return;

    if (deterministicFixtureAllowed()) {
      await runDeterministicFixture(row, jobs, pool);
    } else {
      await runProviderPipeline(row, jobs, pool);
    }
    const credits = new PgCreditPaymentRepository(databaseUrl);
    try { await credits.captureCredits(row.org_id ? { userId: row.user_id, orgId: row.org_id } : row.user_id, jobId); } finally { await credits.close(); }
  } catch (error) {
    if (options.retryViaQueue) throw error;
    await jobs.failJob(jobId, error instanceof Error ? error.message : String(error));
  } finally { await jobs.close(); /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }
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
  let primaryRef = imageRef;
  const extraRefs: string[] = [];
  if ((row.quality_tier ?? "silent_caption") !== "silent_caption") {
    for (const rel of images.slice(1, MAX_IMAGES)) {
      const p = await mediaStorage().materialize(rel).catch(() => null);
      if (p) extraRefs.push(p);
    }
    // BytePlus r2v MENOLAK referensi berisi orang sungguhan — foto berwajah
    // di-crop otomatis ke kain/produk (foto e-commerce fashion selalu pakai
    // model; terbukti lolos moderasi, lab fashion-r2b 2026-08-07). Bila tidak
    // ada satu pun foto aman, error berpesan-user → FAILED + refund jelas.
    const sanitized = await personSafeReferencePhotos([imageRef, ...extraRefs], workDir);
    primaryRef = sanitized.safe[0];
    extraRefs.length = 0;
    extraRefs.push(...sanitized.safe.slice(1));
    if (sanitized.cropped > 0 || sanitized.dropped > 0 || sanitized.resized > 0) {
      console.log(`[job ${row.id.slice(0, 8)}] foto referensi aman-orang: ${sanitized.safe.length} dipakai, ${sanitized.cropped} di-crop, ${sanitized.resized} di-upscale (<320px), ${sanitized.dropped} dibuang`);
    }
  }
  const presetCategory = getCreatorCategory(row.creator_category ?? "hijaber")!;
  // M8: avatar upload sendiri. Yang di-override HANYA deskriptor fisik yang
  // dipakai prompt shot — voiceName/voiceStyle/negativePrompt tetap dari
  // preset, karena foto tidak memberi tahu apa pun soal suara. Jujur ke user:
  // hasilnya "terinspirasi foto", bukan wajah persis (BytePlus menolak foto
  // wajah asli sebagai referensi, lihat lib/promo/avatar.ts).
  const customDesc = row.avatar_custom_desc?.trim();
  const category = customDesc
    ? { ...presetCategory, promptSeed: customDesc, handsPrompt: customDesc }
    : presetCategory;
  const tier = (row.quality_tier ?? "silent_caption") as QualityTier;
  const withAudio = tier !== "silent_caption";
  const format = row.format === "talking_head" || row.format === "vo_broll" || row.format === "tvc" ? row.format : "hands_only";
  const spec = planShots({ jobId: row.id, durationSec: row.duration_s, segments, category, productName: row.product_name,
    productCategory: row.product_category, productVisualDesc: row.product_visual_desc, brandBrief: row.brand_brief, imageRefPath: primaryRef,
    extraImageRefPaths: extraRefs, qualityTier: tier,
    format,
    hookLevel: row.script_hook_level === "berani" || row.script_hook_level === "gila" ? row.script_hook_level : "normal" });
  // vo_broll (VO+Foto): no AI video-gen call at all — the visual is the
  // user's own product photo panned/zoomed, so there's no provider to fail
  // over between and no cost beyond the VO synthesis below.
  // r13: retry lewat provider MAHAL kalau klip upaya sebelumnya masih valid
  // di disk (lihat resume-clips.ts) — menghemat ~Rp8-37rb per retry transien.
  // M11 (gerbang review scene): job dashboard brand berhenti setelah visual
  // jadi, menunggu brand menyetujui tiap scene. Klip yang sudah ada ditarik
  // balik dari storage durable DULU supaya tidak digenerate (dan dibayar)
  // ulang — disk lokal worker sudah lama hilang saat brand akhirnya membuka
  // dashboard. Scene yang diminta ganti digenerate satu per satu, bukan
  // seluruh job, supaya scene yang sudah disetujui tidak ikut berubah.
  if (row.requires_approval) {
    const restored = await materializeJobShots(pool, row.id, workDir);
    if (restored) console.log(`[job ${row.id.slice(0, 8)}] review: ${restored} klip ditarik dari storage`);
    for (const shot of (await loadJobShots(pool, row.id)).filter((s) => s.regen_requested)) {
      if (shot.idx >= spec.shots.length) continue;
      const tmpDir = path.join(workDir, `regen-${shot.idx}`);
      fs.mkdirSync(tmpDir, { recursive: true });
      const single = await generateVideoWithFailover({ ...spec, shots: [spec.shots[shot.idx]] }, tmpDir);
      await jobs.addCost(row.id, single.costIdr);
      fs.copyFileSync(single.assets[0].filePath, path.join(workDir, `shot${shot.idx}.mp4`));
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`[job ${row.id.slice(0, 8)}] scene ${shot.idx + 1} digenerate ulang atas permintaan brand`);
    }
  }

  const reused = format === "vo_broll" ? null : await findReusableClips(workDir, spec);
  if (reused) console.log(`[job ${row.id.slice(0, 8)}] resume: ${reused.assets.length} klip dari upaya sebelumnya dipakai ulang, provider TIDAK dipanggil lagi`);
  const video = reused ?? (format === "vo_broll" ? await buildPhotoPanVideo(spec, workDir) : await generateVideoWithFailover(spec, workDir));
  await jobs.setProviders(row.id, video.providerName);
  await jobs.addCost(row.id, video.costIdr);

  // M11: berhenti di sini untuk job brand yang belum disetujui. Suara,
  // compositing dan QC BELUM jalan — brand menilai gambar & pesan dulu.
  if (row.requires_approval && !row.approved_at) {
    await persistJobShots(pool, row.id, video.assets.map((asset, i) => ({
      idx: i, prompt: spec.shots[i]?.prompt ?? "", filePath: asset.filePath, durationSec: asset.durationSec,
    })));
    if (!(await jobs.transition(row.id, "AWAITING_APPROVAL", { worker: "postgres", scenes: video.assets.length }))) return;
    console.log(`[job ${row.id.slice(0, 8)}] menunggu persetujuan brand (${video.assets.length} scene)`);
    return;
  }

  // r16 (Brian 2026-08-08: "tidak ada lagi foto real produk... di video
  // manapun" — product-proof insert DIHAPUS TOTAL). Video selalu 100%
  // AI-generated, tanpa sisipan foto statis.
  const clipPaths = video.assets.map((asset) => asset.filePath);

  if (!(await jobs.transition(row.id, "GENERATING_VOICE", { worker: "postgres" }))) return;
  const vo: { path: string; startSec: number }[] = [];
  let geminiVoPath: string | undefined;
  const usedMockVideo = isMockProviderName(video.providerName);
  // r7 (Brian 2026-08-07): "presenter/lipsync jual Super HQ 80rb-an, sisanya
  // video+VO mulut nggak lipsync" — satu-satunya kombinasi berlip-sync
  // sungguhan adalah Wajah AI di tier Super HQ (audio embedded asli
  // dipertahankan); semua kombinasi lain pakai gaya voice-over (Gemini TTS).
  const isPresenterLipsync = format === "talking_head" && tier === "super_hq";
  if (!withAudio) await jobs.setProviders(row.id, undefined, "none-silent-caption");
  else if (format === "vo_broll") {
    // No embedded audio is possible here (no video model call happened) —
    // real TTS is the only option, unlike hands_only/talking_head's mock-only rule.
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const result = await synthesizeElevenLabsVoiceover(segment.text, path.join(workDir, `vo_real_${i}.mp3`));
      vo.push({ path: result.filePath, startSec: segment.start });
      await jobs.addCost(row.id, result.costIdr);
    }
    await jobs.setProviders(row.id, undefined, "elevenlabs-tts");
  } else if (!usedMockVideo && isPresenterLipsync) {
    // Presenter/Lipsync (Super HQ): audio embedded asli dipertahankan — TIDAK
    // diganti Gemini TTS, supaya lip-sync sungguhan dari model tetap utuh.
    await jobs.setProviders(row.id, undefined, "embedded-model-lipsync");
  } else if (!usedMockVideo) {
    // SUARA RESMI = Gemini TTS (Brian 2026-08-07): audio embedded model video
    // diganti VO TTS ber-voice terkunci per avatar.
    const voText = hargaTerbilang(segments.map((segment) => segment.text).join(" ... "));
    const tts = await synthesizeGeminiVoiceover(voText, category.voiceName, category.voiceStyle, path.join(workDir, "vo_gemini.wav"));
    geminiVoPath = tts.filePath;
    await jobs.addCost(row.id, tts.costIdr);
    await jobs.setProviders(row.id, undefined, "gemini-tts");
  } else {
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
  const mode: CompositeMode = !withAudio ? "caption" : format === "vo_broll" ? "vo" : usedMockVideo ? "vo" : "embedded";
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
  // Add-on promo (cek ulang saat render — kedaluwarsa = drop overlay, lihat lib/promo.ts).
  const promo = resolvePromo({ priceIdr: row.product_price_idr, promoPriceBeforeIdr: row.promo_price_before_idr,
    promoEndsAt: row.promo_ends_at, promoStockLeft: row.promo_stock_left });
  const priceOverlayText = promo ? formatPromoOverlayText(promo) : `Cuma ${formatHargaOverlay(row.product_price_idr)}`;
  let outputPath = "";
  let renderParams = { watermark: true as const, watermarkText: AIGC_WATERMARK_TEXT };
  let qc: Awaited<ReturnType<typeof runQc>> | null = null;
  for (let retry = 0; retry < 2; retry++) {
    if (!(await jobs.transition(row.id, "COMPOSITING", { worker: "postgres", retry }))) return;
    const composite = await compositeVideo({ jobId: row.id, workDir, clipPaths, mode,
      voiceoverWavPath: mode === "embedded" ? geminiVoPath : undefined,
      vo: mode === "vo" ? vo : undefined, captions, musicPath, durationSec: row.duration_s,
      priceText: priceOverlayText, priceInCaptionMode: Boolean(promo) && mode === "caption", ctaText: ctaBadgeText,
      demoRange: [demo.start, demo.end], ctaRange: [cta.start, cta.end], providerVideo: video.providerName });
    outputPath = composite.outPath; renderParams = composite.renderParams;
    if (!(await jobs.transition(row.id, "QC_CHECK", { worker: "postgres" }))) return;
    qc = await runQc({ filePath: outputPath, targetDurationSec: row.duration_s, isMockProvider: usedMockVideo,
      finalTexts: [...segments.map((segment) => segment.text), formatHargaOverlay(row.product_price_idr), `Cek ${cartLabel}`, AIGC_WATERMARK_TEXT],
      hookFamily: row.script_hook_family, register: row.script_register, productName: row.product_name, productCategory: row.product_category, priceIdr: row.product_price_idr,
      renderParams, shotPaths: video.assets.map((asset) => asset.filePath), refImagePath: primaryRef, format,
      // Mode embedded (semua tier bersuara) TIDAK punya overlay teks lagi
      // (2026-08-07: harga/CTA diucapkan AI, tulisan di layar dihapus) —
      // QC-06 jadi N/A. Watermark visual juga dihapus (label AIGC via
      // metadata + toggle platform, keputusan Brian 2026-08-07).
      overlayTextExpectations: mode === "embedded" ? [] : [
        ...(mode === "caption"
          ? [
              ...(captions ?? []).filter((card) => card.segmentRole !== "cta").map((card) => ({ text: card.text, startSec: card.startSec, endSec: card.endSec })),
              ...(promo ? [{ text: priceOverlayText, startSec: demo.start, endSec: demo.end, critical: true }] : []),
            ]
          : [{ text: priceOverlayText, startSec: demo.start, endSec: demo.end, critical: true }]),
        { text: ctaQcText, startSec: cta.start, endSec: cta.end, critical: true },
      ],
    });
    await pool.query("UPDATE jobs SET qc_result=$1,qc_retry_count=$2 WHERE id=$3", [JSON.stringify(qc), retry, row.id]);
    if (qc.passed) break;
    // Sebut juga check skip: kebijakan bisa menolak TANPA satu pun fail
    // (skip tak berizin / check wajib hilang) — pesan kosong = debugging buta
    // (insiden 21979c08: "QC gagal setelah retry: " tanpa penyebab).
    if (retry === 1) {
      const notPass = qc.checks.filter((check) => check.status !== "pass").map((check) => `${check.code}:${check.status}`);
      throw new Error(`QC gagal setelah retry: ${notPass.join(", ") || "kebijakan menolak (check wajib hilang?)"}`);
    }
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
