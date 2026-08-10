import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { validateScript } from "@/lib/script-engine/validator";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { tierPriceIdr } from "@/lib/credits";
import { enqueueJob } from "@/lib/job-queue";
import { getCreatorCategory } from "@/lib/personas";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { PgJobsRepository } from "@/lib/postgres/jobs";
import { postgresRuntimeEnabled, pgFindOrCreatePersona, smokeApproveScript, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_VIDEOS = 6;

type ConfirmResult =
  | { status: "queued"; script_id: string; job_id: string }
  | { status: "failed"; script_id: string; reason: string };

// POST /api/dashboard/campaign/confirm — gerbang HITL sungguhan (aturan
// keras #5): SATU klik menyetujui N skrip dari SATU produk, lalu tiap skrip
// jadi satu job render. Kredit ditahan per-video dari wallet ORG; kegagalan
// satu video (kredit kurang) tidak menggagalkan yang lain.
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));

    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    const product = await smokeGetProduct(user.id, productId);
    if (!product || product.org_id !== membership.org_id) throw ERR.NOT_FOUND("Produknya");

    const scriptIds: string[] = (Array.isArray(body.script_ids) ? body.script_ids : [])
      .map((s: unknown) => String(s ?? "")).filter(Boolean).slice(0, MAX_VIDEOS);
    if (scriptIds.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 skrip untuk dirender.", "No scripts selected.");

    const format = body.format === "talking_head" ? "talking_head" : body.format === "hands_only" ? "hands_only" : null;
    if (!format) throw ERR.BAD_REQUEST("Format tidak dikenal. Pilih Wajah AI atau Tangan + VO.", "Unknown format.");

    // Avatar: preset (persona) ATAU deskripsi hasil upload foto sendiri.
    // Persona tetap dibuat walau pakai avatar custom — voice TTS terkunci di
    // persona (foto tidak memberi tahu apa pun soal suara).
    const creatorCategoryId = typeof body.creator_category === "string" ? body.creator_category : "";
    const category = getCreatorCategory(creatorCategoryId);
    if (!category || category.status !== "active") throw ERR.BAD_REQUEST("Pilih avatar dulu.", "Unknown or inactive creator category.");
    const personaId = (await pgFindOrCreatePersona(user.id, category)).id;
    const avatarCustomDesc = typeof body.avatar_custom_desc === "string" && body.avatar_custom_desc.trim()
      ? body.avatar_custom_desc.trim().slice(0, 600)
      : null;

    const runId = typeof body.run_id === "string" && body.run_id ? body.run_id : crypto.randomUUID();
    const pool = new Pool({ connectionString: config.databaseUrl });
    const jobsRepo = new PgJobsRepository(config.databaseUrl);
    const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
    const results: ConfirmResult[] = [];
    try {
      for (const scriptId of scriptIds) {
        const script = await smokeGetScript(user.id, scriptId);
        if (!script || script.product_id !== productId || script.job_id) {
          results.push({ status: "failed", script_id: scriptId, reason: "Skrip tidak ditemukan atau sudah pernah dipakai." });
          continue;
        }
        const segments = JSON.parse(script.segments) as SegmentDraft[];
        // Tier & durasi diturunkan dari skrip tersimpan (otoritatif) — tidak
        // pernah dipercaya dari body request, sama seperti /api/jobs retail.
        const tier = script.quality_tier as "silent_caption" | "high_quality" | "super_hq";
        const durationS = Math.max(...segments.map((s) => s.end));
        if (format === "talking_head" && durationS !== 15) {
          results.push({ status: "failed", script_id: scriptId, reason: "Wajah AI cuma tersedia untuk video 15 detik." });
          continue;
        }
        const priceIdr = tierPriceIdr(tier, durationS);

        const validation = validateScript(
          { hook_family: script.hook_family, register: script.register, segments, productName: product.name,
            priceIdr: product.price_idr, promoPriceBeforeIdr: product.promo_price_before_idr, qualityTier: tier },
          "light"
        );
        if (!validation.passed) {
          results.push({ status: "failed", script_id: scriptId, reason: "Skrip tidak lolos validasi saat konfirmasi — buat ulang." });
          continue;
        }
        await smokeApproveScript(user.id, scriptId, { segments, edited: false, validationResult: validation });

        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            // requires_approval=TRUE: job dashboard brand SELALU berhenti di
            // gerbang review scene (M11). Brand menilai gambar & pesan tiap
            // scene sebelum digabung. Retail tidak pernah menyalakan ini.
            `INSERT INTO jobs (id,user_id,org_id,bulk_run_id,avatar_custom_desc,product_id,persona_id,script_id,format,quality_tier,duration_s,requires_approval,state,created_at,state_changed_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,'QUEUED',$12,$12)`,
            [jobId, user.id, membership.org_id, runId, avatarCustomDesc, productId, personaId, scriptId, format, tier, durationS, now]
          );
          await client.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jobId, scriptId]);
          await client.query(
            "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'job.created','jobs',$3,$4,$5)",
            [crypto.randomUUID(), user.id, jobId, JSON.stringify({ script_id: scriptId, campaign_run_id: runId, org_id: membership.org_id, custom_avatar: Boolean(avatarCustomDesc) }), now]
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          client.release();
        }

        const held = await creditsRepo.holdCredits({ userId: user.id, orgId: membership.org_id }, jobId, priceIdr);
        if (!held) {
          await jobsRepo.failJob(jobId, "Kredit organisasi tidak cukup.");
          results.push({ status: "failed", script_id: scriptId, reason: "Kredit organisasi tidak cukup." });
          continue;
        }
        try {
          await enqueueJob(jobId);
        } catch {
          await jobsRepo.failJob(jobId, "Antrean render tidak tersedia; kredit dikembalikan otomatis.");
          results.push({ status: "failed", script_id: scriptId, reason: "Antrean render tidak tersedia — kredit dikembalikan otomatis." });
          continue;
        }
        results.push({ status: "queued", script_id: scriptId, job_id: jobId });
      }
    } finally {
      await pool.end();
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
  }
}
