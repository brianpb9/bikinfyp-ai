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
import type { VisualSpec } from "../providers/types";
import { planShots } from "../media/shot-planner";
import { ringkasParams, ringkasSpec } from "../arsip-prompt";
import { pgSimpanArsipPrompt } from "./smoke-runtime";
import { generateFirstFrame, perluFrameBuatan, harusMenahanProduk, pilihShotUntukFrame } from "../media/first-frame";
import { kunciCastRef } from "../media/cast-ref";
import { periksaPromptAkhir, ringkasTemuanPrompt } from "../media/gerbang-prompt";
import { bolehJadiReferensi } from "../media/qc-frame";
import { TVC_ROUTES, type TvcRoute } from "../templates";
import { findReusableClips } from "../media/resume-clips";
import { compositeVideo, type CompositeMode } from "../media/compositor";
import { runQc } from "../media/qc";
import { shotUntukDetik } from "../media/qc-vision";
import { buildPackshotAsli, packshotAsliUntukShot, dimensiDariKlip } from "../media/packshot-asli";
import { buildCaptionCards } from "../media/captions";
import { resolvePromo, formatPromoOverlayText } from "../promo";
import { renderCaptionPngs } from "../media/render-captions";
import { runFf } from "../media/ffmpeg";
import { generateVideoWithFailover, synthesizeVoiceWithFailover } from "../providers/registry";
import { assertVisualSpec } from "../providers/types";
import { isMockProviderName, type QualityTier } from "../providers/types";
import { buildPhotoPanVideo } from "../media/photo-video";
import { synthesizeElevenLabsVoiceover } from "../media/vo-tts";
import { synthesizeGeminiVoiceover } from "../media/gemini-tts";
import { stripDeliveryTags } from "../script-engine/delivery-tags";
import { hargaTerbilang } from "../script-engine/terbilang";
import { AIGC_WATERMARK_TEXT } from "../config/compliance";
import { mediaStorage } from "../storage";
import { MAX_IMAGES } from "../product-images";
import { personSafeReferencePhotos } from "../media/person-safe-refs";
import { loadJobShots, materializeJobShots, persistJobShots } from "./job-shots";
import { PgCreditPaymentRepository } from "./credit-payment";
import { PgJobsRepository } from "./jobs";
import { getPool } from "./pool";
import { normalizeHookLevel } from "../config/hooks";
import { pgTaskMemo } from "./task-memo";
import { appendEndcard, ENDCARD_DEFAULT_COLOR } from "../media/endcard";
import { loadBrandKit } from "./brand-kit";
import { appendClaimOverlays, sanitizeClaims } from "../media/claim-overlay";

const uuid = () => crypto.randomUUID();
const at = () => new Date().toISOString();
function assertUrl() { if (!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl)) throw new Error("DATABASE_URL PostgreSQL wajib untuk worker pg."); return config.databaseUrl; }
function deterministicFixtureAllowed() { return process.env.RACUN_WORKER_DETERMINISTIC === "1" && process.env.NODE_ENV !== "production"; }

type WorkerRow = {
  id: string; user_id: string; org_id: string | null; product_id: string; persona_id: string | null; script_id: string;
  format: string; quality_tier: string; duration_s: number; state: string;
  script_segments: string; caption: string; hashtags: string; script_register: string; script_hook_family: string;
  script_hook_level: string | null;
  /** Snapshot admisi (JSON) — membawa jejak ide sampai ke arsip prompt. */
  script_validation_result: string | null;
  avatar_custom_desc: string | null;
  requires_approval: boolean;
  approved_at: string | null;
  shot_count: number | null;
  no_model: boolean | null;
  tvc_route: string | null;
  record_style: string | null;
  template_id: string | null;
  product_claims: string | null;
  ratio: string | null;
  product_name: string; product_category: string; product_visual_desc: string | null; brand_brief: string | null; product_images: string; product_price_idr: number;
  promo_price_before_idr: number | null; promo_ends_at: string | null; promo_stock_left: number | null;
  product_source_url: string | null;
  /** JSON bebas dari intake. Sumber MEREK TEPERCAYA (raw_meta.brand). */
  product_raw_meta: string | null;
  creator_category: string | null;
};

/**
 * Jejak ide dari snapshot admisi yang tersimpan di scripts.validation_result.
 *
 * Bentuknya sengaja toleran: baris lama tidak punya field ini, dan snapshot
 * yang korup tidak boleh menggagalkan render yang sudah dibayar — arsip adalah
 * catatan, bukan produk.
 */
export function bacaJejakIde(validationResult: string | null): { ideId: string | null; ideSkor: number | null } {
  if (!validationResult) return { ideId: null, ideSkor: null };
  try {
    const parsed = JSON.parse(validationResult) as { admisi?: { ideId?: unknown; ideSkor?: unknown } };
    const admisi = parsed?.admisi ?? {};
    const skor = typeof admisi.ideSkor === "number" && Number.isFinite(admisi.ideSkor) ? admisi.ideSkor : null;
    const id = typeof admisi.ideId === "string" && admisi.ideId.trim() ? admisi.ideId.slice(0, 120) : null;
    return { ideId: id, ideSkor: skor };
  } catch {
    return { ideId: null, ideSkor: null };
  }
}

/**
 * Boleh memakai frame TURUNAN CAST-REF (bukan sekadar frame pertama buatan)?
 *
 * Keputusan Brian 17 Agu, dan dua batasnya berbeda sifat:
 *
 *   TIER — hanya super_hq dan Enterprise. Biayanya Rp650 + Rp12 per segmen;
 *   pada high_quality itu 62% margin (Rp1.986 dari Rp3.198), jauh di atas
 *   batas ~25% yang sudah tertulis di MAKS_FRAME_PER_TIER. Yang menjaga
 *   high_quality tetap QC-10 di video jadi — label merek harus terbaca, dan
 *   itu sudah berlaku hari ini (skip hanya sah untuk produk tanpa token merek).
 *
 *   FORMAT — hanya hands_only dulu. Frame turunan memberi identitas antar klip,
 *   dan format inilah yang benar-benar punya banyak klip; talking_head justru
 *   dikunci satu klip selama Seedance menolak referensi berwajah, jadi tidak
 *   ada identitas antar-klip untuk dijaga. vo_broll tidak memanggil model video
 *   sama sekali.
 */
export function bolehFrameTurunan(input: {
  format: string;
  tier: string;
  /** Job milik organisasi = jalur Enterprise. */
  orgId?: string | null;
}): boolean {
  if (input.format !== "hands_only") return false;
  return input.tier === "super_hq" || Boolean(input.orgId);
}

/** Ganti imageRefPath shot yang perannya menuntut komposisi berbeda dengan
 *  frame pertama buatan. Shot lain dibiarkan memakai foto produk asli. */
async function siapkanFramePertama(spec: VisualSpec, workDir: string, jobId: string): Promise<VisualSpec> {
  // Jatahnya dibatasi MARGIN, bukan kebutuhan: frame ~Rp600 sedangkan margin
  // tier bersuara cuma Rp3.198. Yang dapat jatah lebih dulu adalah shot yang
  // WAJIB menahan produk — tanpa frame buatan shot itu mustahil benar.
  const dipilih = new Set(pilihShotUntukFrame(spec.shots, spec.qualityTier));
  if (dipilih.size === 0) return spec;
  const butuh = spec.shots.filter((sh) => perluFrameBuatan(sh)).length;
  console.log(`[frame] job ${jobId}: ${dipilih.size} frame buatan (${butuh} shot membutuhkannya, sisanya di luar jatah tier ${spec.qualityTier})`);

  const shots = await Promise.all(spec.shots.map(async (sh) => {
    if (!dipilih.has(sh.index)) return sh;
    try {
      const { path: p, biayaIdr } = await generateFirstFrame({
        productPhotoPath: sh.imageRefPath,
        shotPrompt: sh.prompt,
        ratio: spec.ratio ?? "9:16",
        outPath: `${workDir}/frame-shot${sh.index}.png`,
        withholdProduct: harusMenahanProduk(sh),
      });
      console.log(`[frame] job ${jobId} shot ${sh.index}: frame buatan siap (Rp${biayaIdr})`);
      return { ...sh, imageRefPath: p };
    } catch (err) {
      console.error(`[frame] job ${jobId} shot ${sh.index}: gagal, pakai foto produk —`, err instanceof Error ? err.message : err);
      return sh;
    }
  }));
  return { ...spec, shots };
}

/**
 * Merek tepercaya untuk job ini, atau null.
 *
 * Dibaca dari products.raw_meta.brand — bukan ditebak dari nama produk.
 * Reviewer 18 Agu: dua heuristik berturut-turut salah ("terpanjang" memilih
 * deskriptor, "non-generik pertama" memilih "wajah"/"beli"/"the"), jadi
 * tebakan dihentikan sama sekali. Tanpa sumber ini, gerbang hero UNVERIFIED.
 */
export function merekTepercaya(row: { product_raw_meta?: string | null }): string | null {
  try {
    const meta = JSON.parse(row.product_raw_meta ?? "{}") as { brand?: unknown };
    const b = typeof meta.brand === "string" ? meta.brand.trim() : "";
    return b || null;
  } catch {
    return null;
  }
}

/** Verdict QC-F1 per shot, untuk diarsipkan bersama promptnya. */
export interface RingkasanQcF1 {
  shot: number;
  productState: "hero" | "partial";
  /** PASS / FAIL / UNVERIFIED — lihat lib/media/qc-frame.ts. */
  status: import("../media/qc-frame").StatusQcF1;
  ulang: number;
  detail: string;
}

/**
 * Frame awal SETIAP shot diturunkan dari CAST-REF + foto produk, lalu diperiksa
 * QC-F1 sebelum dipakai (STEP 2).
 *
 * Bedanya dengan siapkanFramePertama: di sana tiap frame lahir sendiri-sendiri
 * dari foto produk, jadi ruangan, pakaian, dan tangannya berganti antar klip.
 * Di sini semuanya turunan dari SATU paket avatar, jadi klipnya terasa satu
 * sesi rekaman — dan itu memang alasan CAST-REF ada.
 *
 * Kegagalan TIDAK menggagalkan job: frame yang gagal diturunkan kembali ke foto
 * produk, persis perilaku lama. Pengguna yang sudah membayar tidak boleh
 * kehilangan videonya karena satu panggilan gambar bermasalah — yang wajib
 * adalah verdictnya tercatat, bukan bahwa ia menghentikan semuanya.
 */
async function siapkanFrameTurunan(
  spec: VisualSpec,
  workDir: string,
  jobId: string,
  identitas: { kunci: string; deskripsi: string; productName: string; merekEksplisit?: string | null }
): Promise<{ spec: VisualSpec; qcF1: RingkasanQcF1[]; biayaIdr: number }> {
  const { paketCastRefTersimpan, turunkanFrameAwalTerperiksa } = await import("../media/cast-ref");
  const qcF1: RingkasanQcF1[] = [];
  let biaya = 0;

  let paket: Awaited<ReturnType<typeof paketCastRefTersimpan>>;
  try {
    paket = await paketCastRefTersimpan(identitas.kunci, identitas.deskripsi, config.storageDir);
    biaya += paket.biayaIdr;
    if (paket.biayaIdr > 0) console.log(`[castref] job ${jobId}: paket "${identitas.kunci}" dibuat (Rp${paket.biayaIdr})`);
  } catch (err) {
    console.error(`[castref] job ${jobId}: paket gagal dibuat, pakai jalur frame lama —`, err instanceof Error ? err.message : err);
    return { spec: await siapkanFramePertama(spec, workDir, jobId), qcF1, biayaIdr: biaya };
  }

  // BERURUTAN, bukan Promise.all. Tiap frame bisa memicu sampai tiga panggilan
  // gambar (dua gulung ulang), dan menjalankan semua shot sekaligus berarti
  // ledakan permintaan ke satu kunci Gemini yang sama — kunci yang, saat kena
  // 429, ikut mematikan TTS produksi (catatan spike 17 Agu).
  const shots: typeof spec.shots = [];
  for (const sh of spec.shots) {
    const productState = harusMenahanProduk(sh) ? "partial" : "hero";
    try {
      const hasil = await turunkanFrameAwalTerperiksa({
        castRefPath: paket.tigaPerempat,
        productPhotoPath: sh.imageRefPath,
        productName: identitas.productName,
        merekEksplisit: identitas.merekEksplisit,
        // Prompt shot menggambarkan GERAKAN; frame pertama butuh keadaan awal.
        startState: sh.startState ?? sh.prompt,
        outPath: `${workDir}/turunan-shot${sh.index}.png`,
        denganWajah: config.seedanceFaceRef,
        productState,
      });
      biaya += hasil.biayaIdr;
      qcF1.push({ shot: sh.index, productState, status: hasil.qc.status, ulang: hasil.ulang, detail: hasil.qc.detail });
      const pesan = `[QC-F1] job ${jobId} shot ${sh.index} (${productState}): ${hasil.qc.status} setelah ${hasil.ulang} ulang — ${hasil.qc.detail}`;
      if (hasil.qc.status === "PASS") console.log(pesan); else console.error(pesan);
      // HANYA PASS yang jadi referensi. FAIL berarti produknya sudah bergeser
      // di tahap gambar dan tahap video akan mengikutinya dengan setia;
      // UNVERIFIED berarti kita tidak pernah tahu. Keduanya kembali ke foto
      // produk asli, yang setidaknya benar.
      shots.push(bolehJadiReferensi(hasil.qc) ? { ...sh, imageRefPath: hasil.path } : sh);
    } catch (err) {
      console.error(`[QC-F1] job ${jobId} shot ${sh.index}: turunan gagal, pakai foto produk —`, err instanceof Error ? err.message : err);
      shots.push(sh);
    }
  }
  return { spec: { ...spec, shots }, qcF1, biayaIdr: biaya };
}

export async function processPostgresJob(jobId: string, options: { retryViaQueue?: boolean } = {}): Promise<void> {
  const databaseUrl = assertUrl();
  const jobs = new PgJobsRepository(databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin });
  const pool = getPool(databaseUrl);
  try {
    // j.* sudah bawa org_id (kolom asli tabel jobs, M1) — WorkerRow.org_id
    // dipakai supaya capture ledger di bawah masuk ke wallet yang benar
    // (pool org untuk job dari dashboard bulk-generate, user biasa untuk retail).
    const found = await pool.query<WorkerRow>(`SELECT j.*, s.segments AS script_segments, s.caption, s.hashtags, s.register AS script_register, s.hook_family AS script_hook_family, s.hook_level AS script_hook_level, s.validation_result AS script_validation_result,
      p.name AS product_name, p.category AS product_category, p.product_visual_desc, p.brand_brief, p.claims AS product_claims, p.images AS product_images, p.price_idr AS product_price_idr, p.source_url AS product_source_url, p.raw_meta AS product_raw_meta,
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
    hookLevel: normalizeHookLevel(row.script_hook_level),
    // NULL = perilaku lama (jumlah shot diturunkan, rasio 9:16).
    shotCountOverride: row.shot_count ?? undefined,
    ratio: row.ratio ?? undefined,
    noModel: row.no_model === true,
    // Daftar putih, bukan lolos apa adanya: nilai asing lebih baik jatuh ke
    // rute luxury (perilaku lama) daripada masuk ke perencana sebagai rute
    // yang tidak punya tabel beat.
    // Diteruskan apa adanya kalau terdaftar. Dulu di-hardcode dua rute, jadi
    // rute yang ditambahkan belakangan sampai ke database tapi tidak pernah
    // sampai ke perencana shot.
    tvcRoute: TVC_ROUTES.includes(row.tvc_route as never) ? (row.tvc_route as TvcRoute) : undefined,
    ugcTemplate: row.template_id,
    recordStyle: row.record_style });

  // KONTRAK PENYEDIA DIPERIKSA DI SINI, bukan nanti di registry.
  //
  // registry memanggil assertVisualSpec tepat sebelum request video — dan itu
  // SESUDAH frame turunan/CAST-REF, yang memanggil model gambar berbayar.
  // Reviewer ronde 5: kontrak negative prompt sempat tidak cocok, dan setiap
  // job melempar di titik itu — sesudah gambar dibayar, sebelum video jadi.
  //
  // Spec-nya tidak berubah lagi setelah planShots (hanya shots-nya dipilih
  // per klip), jadi memeriksanya sekarang memindahkan kegagalan ke titik
  // paling murah: nol panggilan berbayar. registry tetap memeriksa ulang —
  // dua kali murah, dan ia menjaga pemanggil lain.
  assertVisualSpec(spec);

  // Model yang akan dipakai penyedia — sama sumbernya dengan createTask(),
  // supaya mode referensi yang diarsipkan adalah mode yang benar-benar dikirim.
  const modelTier = (config.tiers[spec.qualityTier] ?? config.tiers.silent_caption).byteplusModel;

  // Pemicu penyaring dicatat SEBELUM dikirim, tidak memblokir.
  //
  // Penolakan 18 Agu (koridor berpakaian lengkap ditolak NSFW) tidak bisa
  // dibedah karena tidak ada catatan kata apa yang ada di promptnya. Baris ini
  // membuat penolakan berikutnya bisa langsung dikorelasikan. TIDAK memblokir:
  // penyaringnya menghukum kosakata, dan sebagian kosakata itu memang milik
  // produknya — menahan render karena kata "mandi" akan mematikan kategori
  // sabun.
  // GERBANG, bukan catatan (reviewer A5, temuan P0).
  //
  // Versi sebelumnya hanya console.warn lalu tetap mengirim promptnya. Itu
  // berarti aturan yang kita tegakkan pada naskah dilanggar oleh prompt yang
  // benar-benar berangkat ke penyedia — dan penolakan NSFW 18 Agu terjadi pada
  // adegan koridor berpakaian lengkap justru karena kosakata prompt.
  //
  // Diperiksa prompt AKHIR tiap shot DAN negative prompt, karena keduanya
  // dikirim. Sekarang aman: frasa larangan wajah kita sendiri sudah ditulis
  // sebagai batas positif, jadi gerbang ini seharusnya tidak pernah menyala —
  // dan kalau menyala, artinya ada yang menulis negasi baru, yang memang harus
  // dihentikan sebelum uang keluar.
  // ARSIP PROMPT — sebelum satu pun panggilan penyedia.
  //
  // Job yang GAGAL justru yang paling sering perlu dibedah, jadi arsipnya
  // ditulis di sini, bukan setelah render sukses. Kegagalan menulis diabaikan:
  // ini catatan, bukan bagian produk, dan pengguna yang sudah membayar tidak
  // boleh kehilangan videonya karena pencatatan kita bermasalah.
  try {
    // Skor & identitas ide dibaca dari snapshot admisi yang ikut tersimpan di
    // scripts.validation_result (audit E15, 19 Agu). Sebelumnya dua kolom ini
    // disediakan migrasi 0032 lalu SELALU NULL, karena angkanya berhenti di
    // memori proses web dan tidak pernah menyeberang ke worker.
    const jejakIde = bacaJejakIde(row.script_validation_result);
    await pgSimpanArsipPrompt({
      jobId: row.id,
      specJson: JSON.stringify(ringkasSpec(spec, modelTier)),
      segmentsJson: JSON.stringify(segments),
      negativePrompt: spec.negativePrompt,
      modelParams: JSON.stringify({ ...ringkasParams(spec), format, template_id: row.template_id ?? null }),
      ideId: jejakIde.ideId,
      ideSkor: jejakIde.ideSkor,
    });
  } catch (err) {
    console.warn(`[job ${row.id.slice(0, 8)}] arsip prompt gagal disimpan (diabaikan): ${(err as Error).message}`);
  }

  // GERBANG PROMPT — SESUDAH arsip, SEBELUM penyedia.
  //
  // Urutannya diperbaiki (reviewer ronde 3): dulu throw terjadi sebelum
  // pgSimpanArsipPrompt, jadi justru prompt yang DIHENTIKAN — satu-satunya
  // yang benar-benar perlu dibedah — adalah satu-satunya yang tidak pernah
  // tersimpan. Arsip bukan panggilan berbayar, jadi menaruhnya lebih dulu
  // tidak memindahkan biaya apa pun.
  //
  // Yang MEMBLOKIR hanya negasi tentang orang. Kosakata bertetangga
  // (mandi/handuk/basah) tetap dicatat tapi tidak menahan render: penyaring
  // menghukum kosakata, dan sebagian kosakata itu memang milik produknya —
  // menahan render karena kata "mandi" mematikan kategori sabun. Nama produk
  // ikut dikirim ke detektor dengan alasan yang sama.
  //
  // vo_broll tidak lewat gerbang ini sama sekali: visualnya FOTO ASLI milik
  // pengguna, tidak ada penyedia video yang dipanggil, jadi tidak ada
  // penyaring yang bisa menolaknya.
  {
    const temuan = periksaPromptAkhir({
      shots: spec.shots.map((sh) => ({ index: sh.index, prompt: sh.prompt })),
      negativePrompt: spec.negativePrompt,
      namaProduk: row.product_name,
      format,
      withAudio: spec.generateAudio !== false,
    });
    const keras = temuan.filter((t) => t.keras);
    if (keras.length) {
      const rincian = ringkasTemuanPrompt(keras);
      console.error(`[gerbang-prompt] job ${row.id.slice(0, 8)} DIHENTIKAN sebelum provider — ${rincian}`);
      throw new Error(`Prompt akhir tidak lolos gerbang dan tidak dikirim: ${rincian}`);
    }
  }
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
  // FRAME PERTAMA BUATAN (2026-08-13). Mode i2v menjadikan gambar yang dikirim
  // sebagai frame pertama PERSIS — jadi selama gambarnya foto produk, setiap
  // shot berangkat dari foto produk, dan template yang premisnya MENAHAN
  // produk mustahil dijalankan. Terukur lewat tiga putaran render: "Atap
  // Jebol" tidak pernah punya atap runtuh, "Meja Kosong" tidak pernah punya
  // meja kosong.
  //
  // HANYA untuk shot yang memang butuh. Kalau frame pertama boleh berupa
  // produk apa adanya, foto asli brand JUSTRU lebih baik: identitas produknya
  // dijamin persis dan tidak ada biaya tambahan.
  //
  // GAGAL = PAKAI FOTO ASLI. Video yang framing-nya kurang pas masih bisa
  // dipakai; job yang mati karena satu panggilan gambar gagal tidak.
  //
  // STEP 2 (17 Agu): pada tier/format yang berhak, frame pertamanya DITURUNKAN
  // dari paket CAST-REF avatar dan diperiksa QC-F1 dulu — supaya klipnya
  // terasa satu sesi rekaman, bukan beberapa ruangan berbeda. Lihat
  // bolehFrameTurunan() untuk kenapa gerbangnya tier + format.
  let qcF1: RingkasanQcF1[] = [];
  let specSiap: VisualSpec;
  if (bolehFrameTurunan({ format, tier, orgId: row.org_id })) {
    const turunan = await siapkanFrameTurunan(spec, workDir, row.id, {
      kunci: kunciCastRef({ presetId: row.creator_category, customDesc: customDesc ?? null }),
      deskripsi: category.promptSeed,
      productName: row.product_name,
      // MEREK TEPERCAYA. Kolom products.brand belum ada (migrasi diblokir),
      // jadi sumbernya raw_meta.brand kalau intake sudah menyimpannya. Kosong
      // = QC-F1 hero UNVERIFIED, dan itu memang yang diinginkan: lebih baik
      // menolak memakai frame daripada menyatakan setia pada merek yang kita
      // sendiri cuma menebaknya.
      merekEksplisit: merekTepercaya(row),
    });
    specSiap = turunan.spec;
    qcF1 = turunan.qcF1;
    if (turunan.biayaIdr > 0) await jobs.addCost(row.id, turunan.biayaIdr);
  } else {
    specSiap = await siapkanFramePertama(spec, workDir, row.id);
  }
  // Verdict QC-F1 ikut ke arsip prompt lewat modelParams — SENGAJA belum kolom
  // sendiri. Kolom qc_f1_json (migrasi 0033) menunggu 0030/0031 dipasang lebih
  // dulu, dan menahan buktinya sampai migrasi itu jalan berarti kehilangan
  // bukti dari job-job pertama yang justru paling perlu dibedah.
  if (qcF1.length) {
    try {
      await pool.query(
        // ::text di luar WAJIB — model_params kolomnya TEXT, dan Postgres tidak
        // mengecor jsonb ke text secara implisit saat penugasan.
        `UPDATE job_prompts SET model_params = (model_params::jsonb || $2::jsonb)::text WHERE job_id = $1`,
        [row.id, JSON.stringify({ qc_f1: qcF1 })]
      );
    } catch (err) {
      console.warn(`[job ${row.id.slice(0, 8)}] verdict QC-F1 gagal diarsipkan (diabaikan): ${(err as Error).message}`);
    }
  }

  const video = reused ?? (format === "vo_broll" ? await buildPhotoPanVideo(specSiap, workDir) : await generateVideoWithFailover(specSiap, workDir));
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

  // PACKSHOT PENUTUP DARI FOTO ASLI BRAND (2026-08-14).
  //
  // Model video tidak bisa merender teks kecil label dengan benar — yang
  // keluar kata karangan yang berubah antar shot. Dua putaran perbaikan prompt
  // diukur dan gagal. Untuk brand yang membayar, label adalah identitasnya:
  // iklan indah yang mencetak nama produk salah bukan "hampir benar", ia tidak
  // bisa dipakai.
  //
  // Shot penutup diganti klip dari foto asli yang diunggah brand, dengan
  // push-in halus. Labelnya dijamin benar karena itu memang labelnya. Klipnya
  // yang sudah terlanjur digenerate tetap dibayar — penggantian ini soal MUTU,
  // bukan penghematan, dan penghematannya baru berlaku di job berikutnya.
  for (let i = 0; i < specSiap.shots.length && i < clipPaths.length; i++) {
    const shot = specSiap.shots[i];
    if (!packshotAsliUntukShot({ index: i, jumlahShot: specSiap.shots.length, tanpaOrang: shot.tanpaOrang === true })) continue;
    try {
      // Dimensi dari klip nyata, bukan dari spec — spec.width/height
      // di-hardcode 720x1280 sementara TVC dirender 16:9.
      const dim = await dimensiDariKlip(clipPaths[0]);
      clipPaths[i] = await buildPackshotAsli({
        fotoPath: primaryRef, durationSec: shot.durationSec,
        width: dim.width, height: dim.height,
        outPath: path.join(workDir, `packshot_${i}.mp4`),
      });
      console.log(`[job ${row.id.slice(0, 8)}] shot penutup diganti packshot foto asli — label dijamin benar`);
    } catch (err) {
      console.warn(`[job ${row.id.slice(0, 8)}] packshot asli gagal, pakai klip generate: ${(err as Error).message}`);
    }
  }

  if (!(await jobs.transition(row.id, "GENERATING_VOICE", { worker: "postgres" }))) return;
  const vo: { path: string; startSec: number }[] = [];
  let geminiVoPath: string | undefined;
  const usedMockVideo = isMockProviderName(video.providerName);
  // r7 (Brian 2026-08-07): "presenter/lipsync jual Super HQ 80rb-an, sisanya
  // video+VO mulut nggak lipsync" — satu-satunya kombinasi berlip-sync
  // sungguhan adalah Wajah AI di tier Super HQ (audio embedded asli
  // dipertahankan); semua kombinasi lain pakai gaya voice-over (Gemini TTS).
  // AUDIO NATIVE JADI BAWAAN untuk format berpresenter (talking_head, tvc).
  //
  // Dulu hanya Wajah AI di tier Super HQ yang mempertahankan audio model;
  // sisanya SELALU diganti Gemini TTS. Konsekuensinya tidak kecil: mulut
  // presenter dilarang sinkron ke kata mana pun ("no lip-sync to any specific
  // words" di negative prompt), karena VO akhirnya pasti berbeda dari yang
  // diucapkan model. Jadi kita membayar model untuk menggerakkan mulut, lalu
  // melarangnya berbicara.
  //
  // Spike 17 Agu membuktikan Seedance MEMANG menghasilkan audio dan mulut yang
  // bicara sinkron pada klip 5 detik (docs/spike-2026-08-17): AAC 32 kHz,
  // mean -21 dB, dan mulut terlihat membentuk kata di frame 0,5/2,5/4,5 dtk.
  //
  // Gemini TTS TETAP dipakai untuk hands_only dan vo_broll — di sana
  // pembicaranya memang tidak pernah terlihat, jadi narasi luar-kamera adalah
  // bentuk yang benar, bukan kompromi.
  const isPresenterLipsync = format === "talking_head" || format === "tvc";
  if (!withAudio) await jobs.setProviders(row.id, undefined, "none-silent-caption");
  else if (format === "vo_broll") {
    // No embedded audio is possible here (no video model call happened) —
    // real TTS is the only option, unlike hands_only/talking_head's mock-only rule.
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const result = await synthesizeElevenLabsVoiceover(stripDeliveryTags(segment.text), path.join(workDir, `vo_real_${i}.mp3`));
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
    const voText = hargaTerbilang(segments.map((segment) => segment.tts_text ?? segment.text).join(" ... "));
    const tts = await synthesizeGeminiVoiceover(voText, category.voiceName, category.voiceStyle, path.join(workDir, "vo_gemini.wav"));
    geminiVoPath = tts.filePath;
    await jobs.addCost(row.id, tts.costIdr);
    await jobs.setProviders(row.id, undefined, "gemini-tts");
  } else {
    let voiceProvider = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const result = await synthesizeVoiceWithFailover({ jobId: row.id, text: stripDeliveryTags(segment.text), segmentIndex: i, slotSec: segment.end - segment.start, language: "id-ID", register: row.script_register }, workDir);
      if (!voiceProvider) voiceProvider = result.providerName;
      vo.push({ path: result.asset.filePath, startSec: segment.start });
      await jobs.addCost(row.id, result.costIdr);
    }
    await jobs.setProviders(row.id, undefined, `${voiceProvider} (simulasi embedded)`);
  }
  const mode: CompositeMode = !withAudio ? "caption" : format === "vo_broll" ? "vo" : usedMockVideo ? "vo" : "embedded";
  const captions = !withAudio ? await renderCaptionPngs(buildCaptionCards({ segments, productName: row.product_name }), workDir) : undefined;
  // Musik hanya untuk tier senyap. Percobaan memasangnya di tier bersuara
  // dibatalkan 2026-08-14 setelah diukur tidak terdengar — catatan lengkapnya
  // di lib/media/compositor.ts.
  const musicPath = path.join(process.cwd(), "assets", "music", "bg-bed.m4a");
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

    // Overlay klaim dipasang SEBELUM endcard, supaya klaim menempel di konten
    // utama saja — menimpanya di layar penutup brand justru merusak endcard.
    if (row.product_claims) {
      outputPath = await appendClaimOverlays({
        videoPath: outputPath, workDir,
        claims: sanitizeClaims(JSON.parse(row.product_claims || "[]")),
      });
    }

    // Endcard ber-brand, SESUDAH compositing dan SEBELUM QC.
    //
    // Sesudah compositing: graf filter compositor sudah panjang dan sudah
    // terbukti; endcard sebagai langkah terpisah berarti kegagalannya paling
    // buruk cuma menghilangkan endcard, bukan merusak videonya.
    //
    // Sebelum QC: QC memeriksa durasi, dan menambah 2 detik SETELAH
    // pemeriksaan akan membuat berkas yang dikirim ke brand berbeda dari yang
    // diperiksa — persis jenis celah yang membuat pemeriksaan jadi teater.
    if (row.org_id) {
      const kit = await loadBrandKit(row.org_id);
      if (kit && (kit.logoPath || kit.tagline)) {
        outputPath = await appendEndcard({
          videoPath: outputPath, workDir,
          logoPath: kit.logoPath, colorHex: kit.color ?? ENDCARD_DEFAULT_COLOR, tagline: kit.tagline,
        });
      }
    }
    if (!(await jobs.transition(row.id, "QC_CHECK", { worker: "postgres" }))) return;
    qc = await runQc({ filePath: outputPath, targetDurationSec: row.duration_s, isMockProvider: usedMockVideo,
      // QC-11: batas orang datang DARI SPEC yang dipakai merender, bukan
      // diturunkan ulang di QC — satu aturan, satu tempat.
      maxPeople: spec.maxPeople,
      presenterLipsync: isPresenterLipsync,
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

    // PERBAIKI, JANGAN CUMA MENOLAK.
    //
    // Retry di loop ini semula hanya menyusun ulang (composite) KLIP YANG SAMA
    // PERSIS — jadi untuk cacat yang hidup di dalam video hasil model (dua
    // orang di satu frame, telapak ketiga), retry-nya mustahil berhasil: ia
    // membayar satu compositing lagi untuk menghasilkan kegagalan yang sama,
    // lalu job digagalkan dan brand tidak mendapat apa-apa.
    //
    // QC-11 tahu DETIK mana yang cacat, jadi shot penyebabnya bisa ditunjuk
    // dan digenerate ulang sendirian. Satu klip, bukan seluruh video: untuk
    // TVC 6 shot itu beda antara ~Rp2.771 dan ~Rp16.626.
    //
    // Dibatasi 2 shot per job. Kalau lebih dari dua shot cacat, yang salah
    // kemungkinan besar arahannya, bukan satu lemparan dadu yang sial — dan
    // menggenerate ulang terus akan membakar margin tanpa memperbaiki apa pun.
    const qc11 = qc.checks.find((check) => check.code === "QC-11" && check.status === "fail");
    if (retry === 0 && qc11?.detikGagal?.length && !usedMockVideo) {
      const durasiShot = specSiap.shots.map((shot) => shot.durationSec);
      const idxCacat = [...new Set(qc11.detikGagal.map((d) => shotUntukDetik(durasiShot, d)))]
        .filter((i) => i >= 0)
        .slice(0, 2);
      for (const idx of idxCacat) {
        const tmpDir = path.join(workDir, `qcfix-${idx}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        try {
          const ulang = await generateVideoWithFailover({ ...specSiap, shots: [specSiap.shots[idx]] }, tmpDir);
          await jobs.addCost(row.id, ulang.costIdr);
          fs.copyFileSync(ulang.assets[0].filePath, clipPaths[idx]);
          console.log(`[job ${row.id.slice(0, 8)}] QC-11 menolak detik ${qc11.detikGagal.join(", ")} -> shot ${idx + 1} digenerate ulang`);
        } catch (err) {
          // Gagal memperbaiki bukan alasan menyembunyikan kegagalan aslinya:
          // biarkan QC berikutnya yang memutuskan, dengan klip apa adanya.
          console.warn(`[job ${row.id.slice(0, 8)}] perbaikan shot ${idx + 1} gagal: ${(err as Error).message}`);
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    }
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
  // Job selesai: ingatan task tidak berguna lagi, dan membiarkannya justru
  // berbahaya — task lama yang masih tercatat bisa terpakai ulang kalau job
  // ini pernah disentuh lagi. Kegagalan pembersihan tidak boleh menggagalkan
  // job yang sudah sukses; barisnya kedaluwarsa sendiri lewat batas umur.
  await pgTaskMemo.clear(row.id).catch((err) =>
    console.warn(`[job ${row.id.slice(0, 8)}] gagal bersihkan ingatan task: ${(err as Error).message}`)
  );
}

/** The Redis worker owns timeout recovery while PostgreSQL is the runtime. */
export async function sweepPostgresStaleJobs(): Promise<number> {
  const jobs = new PgJobsRepository(assertUrl(), { stateTimeoutsMin: config.stateTimeoutsMin });
  try {
    // Penyapuan yang sama juga menutup celah arah sebaliknya: job yang SUKSES
    // tapi hold-nya tidak pernah ter-capture karena proses mati di antara
    // transisi READY dan captureCredits.
    const dirapikan = await jobs.reconcileReadyHolds();
    if (dirapikan) console.warn(`[sweep] ${dirapikan} job READY di-capture susulan (hold menggantung)`);
    const promoDirapikan = await jobs.reconcileReadyPromoHolds();
    if (promoDirapikan) console.warn(`[sweep] ${promoDirapikan} promo READY di-capture susulan (hold menggantung)`);
    return await jobs.sweepStaleJobs();
  } finally { await jobs.close(); }
}
