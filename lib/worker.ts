// Worker antrian in-process (MVP): global singleton, FIFO, konkurensi 1.
// Produksi: ganti dengan BullMQ/Redis (lihat README).

import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { getDb, now, type JobRow, type ScriptRow, type ProductRow, type PersonaRow } from "./db";
import { getJob, transition, failJob, addCost, setJobProviders } from "./jobs";
import { planShots } from "./media/shot-planner";
import { findReusableClips } from "./media/resume-clips";
import { compositeVideo } from "./media/compositor";
import { runQc } from "./media/qc";
import { resolvePromo, formatPromoOverlayText } from "./promo";
import { generateVideoWithFailover, synthesizeVoiceWithFailover } from "./providers/registry";
import { assertVisualSpec } from "./providers/types";
import { isMockProviderName, type QualityTier } from "./providers/types";
import { buildPhotoPanVideo } from "./media/photo-video";
import { synthesizeElevenLabsVoiceover } from "./media/vo-tts";
import { synthesizeGeminiVoiceover } from "./media/gemini-tts";
import { stripDeliveryTags } from "./script-engine/delivery-tags";
import { voiceoverStartSecForSegments } from "./script-engine/story-os-ads";
import { hargaTerbilang } from "./script-engine/terbilang";
import { buildCaptionCards } from "./media/captions";
import { renderCaptionPngs } from "./media/render-captions";
import type { CompositeMode } from "./media/compositor";
import { getCreatorCategory } from "./personas";
import { outputExtras, cartLabelForUrl } from "./script-engine";
import { captureCredits } from "./credits";
import { formatHargaOverlay, type SegmentDraft } from "./script-engine/templates";
import { AIGC_WATERMARK_TEXT } from "./config/compliance";
import { mediaStorage } from "./storage";
import { MAKS_REFERENSI_PER_GENERASI } from "./product-images";
import { personSafeReferencePhotos } from "./media/person-safe-refs";
import { normalizeHookLevel } from "./config/hooks";
import { pesanTanpaReferensi } from "./product-truth";
import { catatKanariReferensi, GagalTanpaReferensi } from "./kanari-bukti";
import { loadOrCreateJobReferenceManifest, materializeJobReferenceManifest } from "./job-reference-manifest";
import { claimsFromRaw, loadOrCreateJobProductSnapshot, trustedBrandFromRawMeta } from "./job-product-snapshot";

const CONCURRENCY = 1;

class JobNoLongerActive extends Error {}

function advance(jobId: string, state: Parameters<typeof transition>[1], meta?: Record<string, unknown>) {
  if (!transition(jobId, state, meta)) throw new JobNoLongerActive("Job sudah berakhir saat worker masih berjalan.");
}

const g = globalThis as unknown as {
  __racunQueue?: { queue: string[]; running: number };
};

function store() {
  if (!g.__racunQueue) g.__racunQueue = { queue: [], running: 0 };
  return g.__racunQueue;
}

/**
 * Compatibility rollback path for SQLite-only local development.  In redis
 * mode the web process delegates to lib/job-queue and never starts pump().
 */
export async function enqueueInlineJob(jobId: string): Promise<void> {
  // Saklar untuk unit test: antrian dimatikan agar tes tidak menjalankan FFmpeg.
  if (process.env.RACUN_WORKER_DISABLED === "1") return;
  const s = store();
  if (!s.queue.includes(jobId)) s.queue.push(jobId);
  void pump();
}

export function queueLength(): number {
  return store().queue.length;
}

async function pump(): Promise<void> {
  const s = store();
  while (s.running < CONCURRENCY && s.queue.length > 0) {
    const jobId = s.queue.shift()!;
    s.running++;
    void processJob(jobId)
      .catch((err) => console.error(`[worker] job ${jobId} error tak tertangani:`, err))
      .finally(() => {
        s.running--;
        void pump();
      });
  }
}

export async function processJob(jobId: string, options: { retryViaQueue?: boolean } = {}): Promise<void> {
  const db = getDb();
  const job = getJob(jobId);
  if (!job || job.state !== "QUEUED") return;

  try {
    const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(job.script_id) as ScriptRow;
    let product = db.prepare("SELECT * FROM products WHERE id = ?").get(job.product_id) as ProductRow;
    const persona = job.persona_id
      ? (db.prepare("SELECT * FROM personas WHERE id = ?").get(job.persona_id) as PersonaRow | undefined)
      : undefined;
    // Avatar kustom/premium menimpa DESKRIPTOR FISIK saja — voiceName,
    // voiceStyle, dan negativePrompt tetap dari preset, karena teks deskripsi
    // tidak memberi tahu apa pun soal suara. Sejajar dengan worker Postgres
    // (lib/postgres/worker.ts); jalur SQLite sebelumnya mengabaikannya, jadi
    // avatar premium diam-diam tidak berpengaruh di dev.
    const presetKategori = getCreatorCategory(persona?.creator_category ?? "hijaber")!;
    const descKustom = (job as { avatar_custom_desc?: string | null }).avatar_custom_desc?.trim();
    const category = descKustom
      ? { ...presetKategori, promptSeed: descKustom, handsPrompt: descKustom }
      : presetKategori;
    const productSnapshot = await loadOrCreateJobProductSnapshot({
      existingRaw: job.job_product_snapshot ?? null,
      candidate: () => ({
        productName: product.name,
        category: product.category,
        trustedBrand: { source: "products.raw_meta.brand", value: trustedBrandFromRawMeta(product.raw_meta) },
        productVisualDesc: product.product_visual_desc ?? null,
        brandBrief: product.brand_brief ?? null,
        claims: claimsFromRaw(product.claims),
      }),
      persistIfAbsentAndSafe: async (candidateRaw) => db.transaction(() => {
        const row = db.prepare(
          "SELECT job_product_snapshot,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=?"
        ).get(job.id) as { job_product_snapshot: string | null; provider_video: string | null; provider_voice: string | null; output_url: string | null; cost_actual_idr: number } | undefined;
        if (!row) throw new Error("Job tidak ditemukan saat mematok snapshot metadata produk.");
        if (row.job_product_snapshot) return row.job_product_snapshot;
        const traces = db.prepare(
          `SELECT
            EXISTS(SELECT 1 FROM outputs WHERE job_id=?) OR
            EXISTS(SELECT 1 FROM provider_tasks WHERE job_id=?) OR
            EXISTS(SELECT 1 FROM job_shots WHERE job_id=?) AS unsafe`
        ).get(job.id, job.id, job.id) as { unsafe: number };
        if (row.provider_video || row.provider_voice || row.output_url || row.cost_actual_idr > 0 || traces.unsafe) return null;
        db.prepare("UPDATE jobs SET job_product_snapshot=? WHERE id=?").run(candidateRaw, job.id);
        return candidateRaw;
      })(),
    });
    product = {
      ...product,
      name: productSnapshot.productName,
      category: productSnapshot.category,
      product_visual_desc: productSnapshot.productVisualDesc,
      brand_brief: productSnapshot.brandBrief,
      claims: JSON.stringify(productSnapshot.claims),
      raw_meta: JSON.stringify(productSnapshot.trustedBrand.value ? { brand: productSnapshot.trustedBrand.value } : {}),
    };

    const segments = JSON.parse(script.segments) as SegmentDraft[];
    const images = JSON.parse(product.images) as string[];

    const workDir = path.join(config.storageDir, "jobs", job.id);
    fs.mkdirSync(workDir, { recursive: true });
    // REFERENSI DIPILIH DARI BUKTI, BUKAN DARI URUTAN UNGGAH.
    //
    // Sampai 21 Agu baris ini `materialize(images[0])`: foto PERTAMA menang
    // karena posisinya, apa pun isinya. Produk yang foto pertamanya banner
    // promo mengirim BANNER ke model video sebagai acuan "beginilah rupa
    // produknya", dan model menyalin teks banner ke kemasan. Baru ketahuan
    // sesudah dibayar.
    //
    // GAGAL-TERTUTUP SEBELUM LANGKAH BERBAYAR. Resolver tidak pernah melempar;
    // yang melempar di sini adalah pemanggilnya, dan ia melempar SEBELUM satu
    // byte pun diambil — jadi nol materialize, nol provider, nol capture.
    const hasilManifest = await loadOrCreateJobReferenceManifest({
      existingRaw: job.approved_reference_manifest ?? null,
      jobId: job.id,
      candidateRels: images,
      onResolved: (referensi) => {
        catatKanariReferensi(referensi, { jobId, produkId: product.id, runtime: "worker-sqlite" });
        if (!referensi.utama) throw new GagalTanpaReferensi(pesanTanpaReferensi(referensi), referensi);
      },
      persistIfAbsentAndSafe: async (candidateRaw) => db.transaction(() => {
        const row = db.prepare(
          "SELECT approved_reference_manifest,provider_video,provider_voice,output_url,cost_actual_idr FROM jobs WHERE id=?"
        ).get(job.id) as { approved_reference_manifest: string | null; provider_video: string | null; provider_voice: string | null; output_url: string | null; cost_actual_idr: number } | undefined;
        if (!row) throw new Error("Job tidak ditemukan saat mematok manifest referensi.");
        if (row.approved_reference_manifest) return row.approved_reference_manifest;
        const traces = db.prepare(
          `SELECT
            EXISTS(SELECT 1 FROM outputs WHERE job_id=?) OR
            EXISTS(SELECT 1 FROM provider_tasks WHERE job_id=?) OR
            EXISTS(SELECT 1 FROM job_shots WHERE job_id=?) AS unsafe`
        ).get(job.id, job.id, job.id) as { unsafe: number };
        if (row.provider_video || row.provider_voice || row.output_url || row.cost_actual_idr > 0 || traces.unsafe) return null;
        db.prepare("UPDATE jobs SET approved_reference_manifest=? WHERE id=?").run(candidateRaw, job.id);
        return candidateRaw;
      })(),
    });
    const snapshots = await materializeJobReferenceManifest(hasilManifest.manifest, workDir);
    const pastikanManifestSebelumEfek = async () => {
      await materializeJobReferenceManifest(hasilManifest.manifest, workDir);
    };
    const refUtama = snapshots[0];

    const tier = (job.quality_tier ?? "silent_caption") as QualityTier;
    const withAudio = tier !== "silent_caption";
    // Foto tambahan = referensi identitas (hanya berlaku di model r2v/tier
    // bersuara). Sesudah masuk manifest, satu pun tidak boleh hilang diam-diam:
    // missing/hash-changed menggagalkan attempt sebelum provider.
    let primaryRef = refUtama;
    const extraRefs: string[] = [];
    if (withAudio) {
      // Referensi tambahan juga HANYA dari daftar tersetujui. Foto ke-2 dst
      // dikirim ke model sebagai referensi identitas — sama berbahayanya kalau
      // salah. Batasnya dipertahankan sama persis dengan sebelumnya
      // (slice(1, MAX_IMAGES) => paling banyak tujuh tambahan), supaya langkah
      // ini tidak diam-diam mengubah payload provider.
      // Batas GENERASI, bukan batas unggah. MAKS_REFERENSI_PER_GENERASI=7
      // menghitung primary + tambahan; slice(1, MAX_IMAGES=8) sebelumnya
      // menghasilkan primary + tujuh = DELAPAN referensi, melewati kontraknya
      // sendiri.
      extraRefs.push(...snapshots.slice(1, MAKS_REFERENSI_PER_GENERASI));
      // BytePlus r2v MENOLAK referensi berisi orang sungguhan — foto berwajah
      // di-crop otomatis ke kain/produk (foto e-commerce fashion selalu pakai
      // model; terbukti crop lolos moderasi, lab fashion-r2b 2026-08-07).
      const sanitized = await personSafeReferencePhotos([refUtama, ...extraRefs], workDir);
      primaryRef = sanitized.safe[0];
      extraRefs.length = 0;
      extraRefs.push(...sanitized.safe.slice(1));
      if (sanitized.cropped > 0 || sanitized.dropped > 0 || sanitized.resized > 0) {
        console.log(`[job ${job.id.slice(0, 8)}] foto referensi aman-orang: ${sanitized.safe.length} dipakai, ${sanitized.cropped} di-crop, ${sanitized.resized} di-upscale (<320px), ${sanitized.dropped} dibuang`);
      }
    }

    // --- GENERATING_VISUAL ---
    advance(job.id, "GENERATING_VISUAL");
    const format = job.format === "talking_head" || job.format === "vo_broll" ? job.format : "hands_only";
    const spec = planShots({
      jobId: job.id,
      durationSec: job.duration_s,
      segments,
      category,
      productName: product.name,
      productCategory: product.category,
      productVisualDesc: product.product_visual_desc,
      brandBrief: product.brand_brief,
      imageRefPath: primaryRef,
      extraImageRefPaths: extraRefs,
      qualityTier: tier,
      format,
      // Level hook dari skrip (S3): hanya "gila" yang mengubah prompt shot 1.
      hookLevel: normalizeHookLevel(script.hook_level),
    });
    // vo_broll (VO+Foto): no AI video-gen call — visual is the user's own
    // product photo panned/zoomed, so there's no provider to fail over between.
    // r13 (review QA 2026-08-07): pakai ulang klip dari upaya sebelumnya bila
    // masih valid di disk — hemat biaya provider saat retry setelah kegagalan
    // transien di step SETELAH video (lihat lib/media/resume-clips.ts).
    // Kontrak penyedia diperiksa SEBELUM langkah berbayar mana pun — alasan
    // lengkapnya di lib/postgres/worker.ts.
    assertVisualSpec(spec);
    const reused = format === "vo_broll" ? null : await findReusableClips(workDir, spec);
    if (reused) console.log(`[job ${job.id.slice(0, 8)}] resume: ${reused.assets.length} klip dari upaya sebelumnya dipakai ulang, provider TIDAK dipanggil lagi`);
    let video;
    if (reused) video = reused;
    else if (format === "vo_broll") video = await buildPhotoPanVideo(spec, workDir);
    else {
      await pastikanManifestSebelumEfek();
      video = await generateVideoWithFailover(spec, workDir);
    }
    setJobProviders(job.id, video.providerName);
    addCost(job.id, video.costIdr);

    // r16 (Brian 2026-08-08: "tidak ada lagi foto real produk... di video
    // manapun" — product-proof insert DIHAPUS TOTAL). Video selalu 100%
    // AI-generated, tanpa sisipan foto statis.
    const clipPaths = video.assets.map((a) => a.filePath);

    // --- GENERATING_VOICE ---
    // silent_caption: tidak ada VO sama sekali (caption + musik).
    // vo_broll: tidak ada audio embedded (tidak ada panggilan model video sama
    // sekali) -> TTS nyata (ElevenLabs) satu-satunya opsi.
    // tier bersuara via provider NYATA (hands_only/talking_head): no-op — audio embedded ikut dari model.
    // tier bersuara via MOCK: VO `say` sebagai SIMULASI embedded (dev/test gratis).
    advance(job.id, "GENERATING_VOICE");
    const vo: { path: string; startSec: number }[] = [];
    let geminiVoPath: string | undefined;
    const usedMockVideo = isMockProviderName(video.providerName);
    // r7 (Brian 2026-08-07): "presenter/lipsync jual Super HQ 80rb-an, sisanya
    // video+VO mulut nggak lipsync" — satu-satunya kombinasi berlip-sync
    // sungguhan adalah Wajah AI di tier Super HQ (audio embedded asli
    // dipertahankan); semua kombinasi lain pakai gaya voice-over (Gemini TTS).
    const isPresenterLipsync = format === "talking_head" && tier === "super_hq";
    if (!withAudio) {
      setJobProviders(job.id, undefined, "none-silent-caption");
      console.log(`[job ${job.id.slice(0, 8)}] silent_caption: tanpa VO (caption + musik)`);
    } else if (format === "vo_broll") {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        await pastikanManifestSebelumEfek();
        const res = await synthesizeElevenLabsVoiceover(stripDeliveryTags(seg.text), path.join(workDir, `vo_real_${i}.mp3`));
        vo.push({ path: res.filePath, startSec: seg.start });
        addCost(job.id, res.costIdr);
      }
      setJobProviders(job.id, undefined, "elevenlabs-tts");
      console.log(`[job ${job.id.slice(0, 8)}] vo_broll: VO nyata (ElevenLabs) di atas foto produk`);
    } else if (!usedMockVideo && isPresenterLipsync) {
      // r7 (Brian 2026-08-07): "presenter/lipsync ya kita jual Super HQ 80rb-an,
      // sisanya video+VO (mulut nggak lipsync)". Super HQ Wajah AI = satu-satunya
      // kombinasi yang MEMPERTAHANKAN audio embedded asli (lip-sync sungguhan
      // dari model, prompt talking-to-camera) — TIDAK diganti Gemini TTS.
      setJobProviders(job.id, undefined, "embedded-model-lipsync");
      console.log(`[job ${job.id.slice(0, 8)}] Presenter/Lipsync (Super HQ): audio embedded asli dipertahankan dari ${video.providerName}`);
    } else if (!usedMockVideo) {
      // SUARA RESMI = Gemini TTS (Brian 2026-08-07): audio embedded dari model
      // video DIGANTI VO TTS ber-voice terkunci per avatar (gerak bibir klip
      // tetap dipakai — dialog prompt = teks yang sama dengan TTS).
      const voText = hargaTerbilang(segments.map((seg) => seg.tts_text ?? seg.text).join(" ... "));
      await pastikanManifestSebelumEfek();
      const tts = await synthesizeGeminiVoiceover(voText, category.voiceName, category.voiceStyle, path.join(workDir, "vo_gemini.wav"));
      geminiVoPath = tts.filePath;
      addCost(job.id, tts.costIdr);
      setJobProviders(job.id, undefined, "gemini-tts");
      console.log(`[job ${job.id.slice(0, 8)}] VO Gemini TTS voice=${category.voiceName} menggantikan audio embedded ${video.providerName}`);
    } else {
      let voiceProvider = "";
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        await pastikanManifestSebelumEfek();
        const res = await synthesizeVoiceWithFailover(
          {
            jobId: job.id,
            text: stripDeliveryTags(seg.text),
            segmentIndex: i,
            slotSec: seg.end - seg.start,
            language: "id-ID",
            register: script.register,
          },
          workDir
        );
        if (!voiceProvider) voiceProvider = res.providerName;
        vo.push({ path: res.asset.filePath, startSec: seg.start });
        addCost(job.id, res.costIdr);
      }
      setJobProviders(job.id, undefined, voiceProvider + " (simulasi embedded)");
    }

    // Mode compositing mengikuti tier + provider yang benar-benar dipakai
    const compositeMode: CompositeMode = !withAudio ? "caption" : format === "vo_broll" ? "vo" : usedMockVideo ? "vo" : "embedded";
    const captionCards = !withAudio ? await renderCaptionPngs(buildCaptionCards({ segments, productName: product.name }), workDir) : undefined;
    // Musik hanya untuk tier senyap — lihat catatan di lib/media/compositor.ts.
    const musicPath = path.join(process.cwd(), "assets", "music", "bg-bed.m4a");

    // --- COMPOSITING (dengan retry QC -> COMPOSITING maks 1x) ---
    const demoSeg = segments.find((s) => s.role === "demo")!;
    const ctaSeg = segments.find((s) => s.role === "cta")!;
    // "Kuning" cuma istilah TikTok Shop (keputusan Brian 2026-08-03).
    const cartLabel = cartLabelForUrl(product.source_url);
    const ctaBadgeText = cartLabel === "keranjang kuning" ? "Klik Keranjang Kuning »" : "Klik Keranjang »";
    const ctaQcText = cartLabel === "keranjang kuning" ? "Klik Keranjang Kuning" : "Klik Keranjang";
    // Add-on promo: overlay harga jadi harga-coret + persen + deadline. Dicek
    // ULANG saat render (bukan saat approve) — promo yang keburu kedaluwarsa
    // di-drop dari overlay tanpa memblokir job (keputusan 2026-08-06); teks
    // skrip yang menyebut promo sudah melewati gerbang HITL user.
    const promo = resolvePromo({
      priceIdr: product.price_idr,
      promoPriceBeforeIdr: product.promo_price_before_idr,
      promoEndsAt: product.promo_ends_at,
      promoStockLeft: product.promo_stock_left,
    });
    const priceOverlayText = promo ? formatPromoOverlayText(promo) : `Cuma ${formatHargaOverlay(product.price_idr)}`;
    const finalTexts = [
      ...segments.map((s) => s.text),
      formatHargaOverlay(product.price_idr),
      `Cek ${cartLabel}`,
      AIGC_WATERMARK_TEXT,
    ];

    let outPath = "";
    let renderParams = { watermark: true as const, watermarkText: AIGC_WATERMARK_TEXT };
    let qc = null as Awaited<ReturnType<typeof runQc>> | null;

    for (;;) {
      advance(job.id, "COMPOSITING");
      const comp = await compositeVideo({
        jobId: job.id,
        workDir,
        clipPaths,
        mode: compositeMode,
        voiceoverWavPath: compositeMode === "embedded" ? geminiVoPath : undefined,
        voiceoverStartSec: voiceoverStartSecForSegments(segments),
        vo: compositeMode === "vo" ? vo : undefined,
        captions: captionCards,
        musicPath,
        durationSec: job.duration_s,
        priceText: priceOverlayText,
        priceInCaptionMode: Boolean(promo) && compositeMode === "caption",
        ctaText: ctaBadgeText,
        demoRange: [demoSeg.start, demoSeg.end],
        ctaRange: [ctaSeg.start, ctaSeg.end],
        providerVideo: video.providerName,
      });
      outPath = comp.outPath;
      renderParams = comp.renderParams;

      // --- QC_CHECK ---
      advance(job.id, "QC_CHECK");
      qc = await runQc({
        filePath: outPath,
        targetDurationSec: job.duration_s,
        finalTexts,
        hookFamily: script.hook_family,
        register: script.register,
        productName: product.name,
        productCategory: product.category,
        priceIdr: product.price_idr,
        renderParams,
        shotPaths: video.assets.map((a) => a.filePath),
        refImagePath: primaryRef,
        format,
        isMockProvider: usedMockVideo,
        // QC-11: batas orang datang DARI SPEC yang dipakai merender, bukan
        // diturunkan ulang di QC — satu aturan, satu tempat.
        maxPeople: spec.maxPeople,
        // Jalur SQLite dev tidak punya tier presenter-lipsync.
        presenterLipsync: false,
        // critical = teks kepatuhan/konversi (watermark, harga/promo, CTA) —
        // WAJIB terbukti OCR; kartu caption skrip non-kritis (cukup mayoritas).
        // Mode embedded (bersuara): TANPA overlay teks sejak 2026-08-07
        // (harga/CTA diucapkan AI) — QC-06 N/A, watermark dijamin QC-08.
        overlayTextExpectations: compositeMode === "embedded" ? [] : [
          // Watermark visual DIHAPUS 2026-08-07 (label AIGC via metadata +
          // toggle platform) — tidak ada lagi ekspektasi teks watermark.
          ...(compositeMode === "caption"
            ? [
                ...(captionCards ?? []).filter((card) => card.segmentRole !== "cta").map((card) => ({ text: card.text, startSec: card.startSec, endSec: card.endSec })),
                ...(promo ? [{ text: priceOverlayText, startSec: demoSeg.start, endSec: demoSeg.end, critical: true }] : []),
              ]
            : [{ text: priceOverlayText, startSec: demoSeg.start, endSec: demoSeg.end, critical: true }]),
          { text: ctaQcText, startSec: ctaSeg.start, endSec: ctaSeg.end, critical: true },
        ],
      });
      db.prepare("UPDATE jobs SET qc_result = ? WHERE id = ?").run(JSON.stringify(qc), job.id);
      if (qc.passed) break;

      const current = getJob(job.id)!;
      if (current.qc_retry_count < 1) {
        db.prepare("UPDATE jobs SET qc_retry_count = qc_retry_count + 1 WHERE id = ?").run(job.id);
        console.warn(`[job ${job.id.slice(0, 8)}] QC gagal -> retry COMPOSITING (1x)`);
        continue; // QC_CHECK -> COMPOSITING, satu-satunya transisi mundur yang diizinkan
      }
      failJob(current, "QC gagal setelah retry: " + (qc.checks.filter((c) => c.status !== "pass").map((c) => `${c.code}:${c.status}`).join(", ") || "kebijakan menolak (check wajib hilang?)"));
      return;
    }

    // --- LABELING (watermark sudah dibakar saat compositing; verifikasi via QC-08) ---
    // Storage kanonik diverifikasi lagi sesudah seluruh provider dan sebelum
    // output/capture. Delete/overwrite yang terjadi di tengah render tidak
    // boleh menghasilkan deliverable dari provenance yang sudah hilang.
    await pastikanManifestSebelumEfek();
    advance(job.id, "LABELING", { watermark: renderParams.watermarkText });

    // --- READY ---
    const relVideo = path.relative(config.storageDir, outPath).split(path.sep).join("/");
    await mediaStorage().put(relVideo, fs.readFileSync(outPath), "video/mp4");
    const extras = outputExtras(product.category);
    db.prepare(
      "INSERT OR REPLACE INTO outputs (job_id, video_url, caption, hashtags, suggested_post_time, compliance_checklist) VALUES (?,?,?,?,?,?)"
    ).run(
      job.id, relVideo, script.caption, script.hashtags,
      extras.suggested_post_time, JSON.stringify(extras.compliance_checklist)
    );
    if (!transition(job.id, "READY")) return;
    db.prepare("UPDATE jobs SET output_url = ?, completed_at = ? WHERE id = ? AND state = 'READY'").run(
      relVideo, now(), job.id
    );
    captureCredits(job.user_id, job.id); // kredit hanya di-capture setelah QC lulus (BR-06.1)
  } catch (err) {
    const current = getJob(jobId) ?? job;
    if (err instanceof JobNoLongerActive) return;
    // BullMQ owns retry/backoff. It receives the original failure until its
    // final attempt, where scripts/worker.ts applies the existing refund flow.
    if (options.retryViaQueue) throw err;
    failJob(current, err instanceof Error ? err.message : String(err));
  }
}
