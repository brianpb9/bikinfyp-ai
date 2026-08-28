import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { templateRequiresPriceMention, validateScript } from "@/lib/script-engine/validator";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { tierPriceIdr } from "@/lib/credits";
import { enqueueJob } from "@/lib/job-queue";
import { getCreatorCategory } from "@/lib/personas";
import { getAvatarPreset } from "@/lib/avatar-presets";
import { getRecordingStyle } from "@/lib/media/recording-styles";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { PgJobsRepository } from "@/lib/postgres/jobs";
import { pgAudit, pgSaveFypSnapshot, smokeApproveScript, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { scoreScriptPlan, type FypVideoFormat } from "@/lib/fyp-score";
import { getPool } from "@/lib/postgres/pool";
import { CAMPAIGN_TEMPLATES, TVC_ROUTES } from "@/lib/templates";
import { aiRenderBlockMessage } from "@/lib/template-render-safety";
import { renderSatuSel, type HasilSel } from "@/lib/dashboard/render-cell";
import { pastikanBolehBelanja } from "@/lib/dashboard-rbac";
import { acquireAdmissionReferenceEvidence } from "@/lib/job-admission-reference";
import { admissionRouteDependencies } from "@/lib/admission-route-dependencies";
import { assertCategoryReviewClear } from "@/lib/product-type-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEOS = 6;

// POST /api/dashboard/campaign/confirm — gerbang HITL sungguhan (aturan
// keras #5): SATU klik menyetujui N skrip dari SATU produk, lalu tiap skrip
// jadi satu job render. Kredit ditahan per-video dari wallet ORG; kegagalan
// satu video (kredit kurang) tidak menggagalkan yang lain.
export async function POST(req: Request) {
  let evidenceLease: Awaited<ReturnType<typeof acquireAdmissionReferenceEvidence>> | null = null;
  try {
    const routeDeps = admissionRouteDependencies();
    if (!routeDeps.postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { user, membership } = await routeDeps.requireOrgContextApi(req);
    await routeDeps.assertDashboardRate("confirm", membership.org_id);
    // Gerbang belanja. Langkah INI yang memotong saldo organisasi — bukan
    // pembuatan naskah — jadi di sinilah perannya diperiksa.
    pastikanBolehBelanja(membership.role);
    // Satu gerbang untuk semua yang memakan uang. Sebelumnya jalur ini cuma
    // memeriksa migrasi, jadi ia tetap membuka diri walau JOB_INTAKE_MODE
    // sudah "closed" untuk perawatan.
    await routeDeps.assertPaidAdmission();
    const body = await req.json().catch(() => ({}));

    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    // Per-ORG, bukan per-user. Produk dashboard dibuat satu anggota, dibayar
    // dari dompet organisasi, dan dipakai seluruh tim — pemeriksaan per-user
    // menolak rekan satu tim atas produk yang jelas ada di daftar mereka.
    const product = await routeDeps.smokeGetOrgProduct(membership.org_id, productId);
    if (!product) throw ERR.NOT_FOUND("Produknya");
    const scriptIds: string[] = (Array.isArray(body.script_ids) ? body.script_ids : [])
      .map((s: unknown) => String(s ?? "")).filter(Boolean).slice(0, MAX_VIDEOS);
    if (scriptIds.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 skrip untuk dirender.", "No scripts selected.");

    const ALLOWED_FORMATS = ["talking_head", "hands_only", "tvc", "ads"] as const;
    const format = ALLOWED_FORMATS.find((f) => f === body.format) ?? null;
    if (!format) throw ERR.BAD_REQUEST("Format tidak dikenal. Pilih Wajah AI, Tangan + VO, TVC, atau Iklan Jasa.", "Unknown format.");

    // Empat template bukti membutuhkan footage asli. Blok dilakukan sebelum
    // persona, kredit, job, atau antrean dibuat agar request yang melewati UI
    // tetap tidak menimbulkan side effect apa pun.
    const templateId =
      typeof body.template_id === "string" && CAMPAIGN_TEMPLATES.some((t) => t.id === body.template_id)
        ? body.template_id
        : null;
    const renderBlockMessage = aiRenderBlockMessage(templateId);
    if (renderBlockMessage) {
      throw ERR.BAD_REQUEST(renderBlockMessage, "AI render blocked: verified original footage required for this evidence template.");
    }

    // Avatar: preset (persona) ATAU deskripsi hasil upload foto sendiri.
    // Persona tetap dibuat walau pakai avatar custom — voice TTS terkunci di
    // persona (foto tidak memberi tahu apa pun soal suara).
    const avatarPreset = typeof body.avatar_id === "string" ? getAvatarPreset(body.avatar_id) : null;
    if (body.avatar_id && !avatarPreset) throw ERR.BAD_REQUEST("Avatar tidak dikenal. Pilih ulang avatarnya.", "Unknown avatar_id.");
    const creatorCategoryId = avatarPreset?.voice ?? (typeof body.creator_category === "string" ? body.creator_category : "");
    const category = getCreatorCategory(creatorCategoryId);
    if (!category || category.status !== "active") throw ERR.BAD_REQUEST("Pilih avatar dulu.", "Unknown or inactive creator category.");
    evidenceLease = await acquireAdmissionReferenceEvidence({
      productId: product.id,
      owner: { kind: "org", id: membership.org_id },
      boundary: "A5",
      loadSqliteCandidateRels: () => JSON.parse(product.images || "[]") as string[],
    });
    const lockedProductType = evidenceLease.productType;
    assertCategoryReviewClear({
      state: lockedProductType?.category_review_state as "CLEAR" | "QUARANTINED" | undefined,
      reason: lockedProductType?.category_review_reason as never,
      version: lockedProductType?.category_review_version ?? 0,
    }, lockedProductType?.category);
    const personaId = (await routeDeps.pgFindOrCreatePersona(user.id, category)).id;
    const avatarCustomDesc = typeof body.avatar_custom_desc === "string" && body.avatar_custom_desc.trim()
      ? body.avatar_custom_desc.trim().slice(0, 600)
      : avatarPreset?.castLock.slice(0, 600) ?? null;

    // Multi-shot & rasio. Divalidasi di sini, BUKAN dipercaya apa adanya:
    // keduanya masuk ke baris job dan dipakai worker berjam-jam kemudian,
    // jadi nilai ngawur akan muncul sebagai render aneh yang sulit dilacak.
    const RATIOS = ["9:16", "1:1", "16:9"];
    const ratio = RATIOS.includes(String(body.ratio)) ? String(body.ratio) : "9:16";
    // TVC tanpa model: hanya berlaku untuk format tvc — format lain memang
    // dibangun di sekitar presenter, jadi mematikan orangnya di sana akan
    // menghasilkan prompt yang bertengkar dengan dirinya sendiri.
    const noModel = format === "tvc" && body.no_model === true;
    const tvcRoute =
      // Divalidasi terhadap TVC_ROUTES, bukan daftar yang ditulis ulang di
      // sini: rute baru yang lupa didaftarkan akan diam-diam jatuh ke beat
      // generik tanpa jejak. "luxury" tetap dikecualikan karena itu perilaku
      // bawaan ketika tvc_route kosong.
      format === "tvc" && body.tvc_route !== "luxury" && TVC_ROUTES.includes(body.tvc_route as never)
        ? (body.tvc_route as string)
        : null;
    // Gaya rekam. Divalidasi DUA kali seperti template: harus ada di daftar,
    // DAN harus cocok dengan formatnya. Gaya yang tidak cocok ("selfie" pada
    // format tangan-saja) menaruh perintah yang berlawanan dengan negative
    // "no face" di prompt yang sama — render rusak yang tetap dibayar penuh.
    // Nilai tidak sah dibuang jadi null (= standar), bukan diteruskan.
    const gayaDiminta = typeof body.record_style === "string" ? body.record_style : "";
    const gaya = getRecordingStyle(gayaDiminta);
    const recordStyle =
      gaya && gaya.id !== "standar" && gaya.formats.includes(format as never) ? gaya.id : null;

    const rawShots = Number(body.shot_count);
    const shotCount = Number.isInteger(rawShots) && rawShots >= 2 && rawShots <= 6 ? rawShots : null;

    const runId = typeof body.run_id === "string" && body.run_id ? body.run_id : crypto.randomUUID();
    const pool = getPool(config.databaseUrl);
    const jobsRepo = new PgJobsRepository(config.databaseUrl);
    const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
    const results: HasilSel[] = [];
    try {
      for (const scriptId of scriptIds) {
        // Urutan per-sel (validasi ulang -> klaim atomik -> hold kredit ->
        // snapshot FYP -> antre) hidup di lib/dashboard/render-cell.ts, DIPAKAI
        // BERSAMA dengan matriks avatar x skenario. Satu salinan aturan uang,
        // bukan dua yang menyimpang diam-diam.
        results.push(await renderSatuSel({
          userId: user.id, orgId: membership.org_id,
          productId, productName: product.name, productPriceIdr: product.price_idr,
          // Label keranjang mengikuti platform — lihat konteksAdmisi().
          productSourceUrl: product.source_url,
          promoPriceBeforeIdr: product.promo_price_before_idr ?? null,
          scriptId, personaId, avatarCustomDesc,
          format, ratio, noModel, tvcRoute, templateId, recordStyle, shotCount, runId,
        }, { pool, jobsRepo, creditsRepo }));
      }
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
      await jobsRepo.close();
      await creditsRepo.close();
    }

    return Response.json({
      run_id: runId,
      queued_count: results.filter((r) => r.status === "queued").length,
      results,
    });
  } catch (err) {
    return errorResponse(err);
  } finally {
    await evidenceLease?.release();
  }
}
