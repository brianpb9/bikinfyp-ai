import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { validateScript } from "@/lib/script-engine/validator";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { tierPriceIdr } from "@/lib/credits";
import { enqueueJob } from "@/lib/job-queue";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { PgJobsRepository } from "@/lib/postgres/jobs";
import { postgresRuntimeEnabled, smokeApproveScript, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { BULK_FORMAT, BULK_TIER, BULK_DURATION_S } from "@/lib/dashboard-bulk-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConfirmResult =
  | { status: "queued"; product_id: string; script_id: string; job_id: string }
  | { status: "failed"; product_id: string; script_id: string; reason: string };

// POST /api/dashboard/bulk/confirm {bulk_run_id, items:[{product_id,script_id}]}
// — fase 2: SATU klik "Setujui Semua & Mulai Render" untuk seluruh batch dari
// fase 1 (POST .../bulk). Ini gerbang HITL sungguhan (aturan keras #5, sama
// seperti /api/scripts/:id/approve satuan) — bukan cuma formalitas, karena
// validateScript "light" di sini bisa MENOLAK item yang sudah dianggap "ready"
// di fase 1 kalau ada perubahan state di antara dua request. Kredit ditahan
// per-item dari wallet ORG (bukan retail) — kegagalan satu item (kredit
// kurang) tidak menggagalkan item lain (partial success, sesuai rencana M3).
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard bulk-generate requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const bulkRunId = typeof body.bulk_run_id === "string" && body.bulk_run_id ? body.bulk_run_id : crypto.randomUUID();
    const rawItems: unknown[] = Array.isArray(body.items) ? body.items : [];
    const items = rawItems
      .map((it): { product_id: string; script_id: string } => {
        const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
        return { product_id: String(obj.product_id ?? ""), script_id: String(obj.script_id ?? "") };
      })
      .filter((it) => it.product_id && it.script_id)
      .slice(0, 10);
    if (items.length === 0) throw ERR.BAD_REQUEST("Tidak ada item untuk di-render.", "No items to confirm.");

    const priceIdr = tierPriceIdr(BULK_TIER, BULK_DURATION_S);
    const pool = new Pool({ connectionString: config.databaseUrl });
    const jobsRepo = new PgJobsRepository(config.databaseUrl);
    const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
    const results: ConfirmResult[] = [];
    try {
      for (const item of items) {
        const script = await smokeGetScript(user.id, item.script_id);
        if (!script || script.product_id !== item.product_id || script.job_id) {
          results.push({ status: "failed", ...item, reason: "Skrip tidak ditemukan atau sudah pernah dipakai." });
          continue;
        }
        const product = await smokeGetProduct(user.id, item.product_id);
        if (!product || product.org_id !== membership.org_id) {
          results.push({ status: "failed", ...item, reason: "Produk tidak ditemukan di organisasi ini." });
          continue;
        }

        const segments = JSON.parse(script.segments) as SegmentDraft[];
        const validation = validateScript(
          { hook_family: script.hook_family, register: script.register, segments, productName: product.name,
            priceIdr: product.price_idr, promoPriceBeforeIdr: product.promo_price_before_idr,
            qualityTier: script.quality_tier as "silent_caption" | "high_quality" | "super_hq" },
          "light"
        );
        if (!validation.passed) {
          results.push({ status: "failed", ...item, reason: "Skrip tidak lolos validasi saat konfirmasi — buat ulang di fase generate." });
          continue;
        }
        await smokeApproveScript(user.id, item.script_id, { segments, edited: false, validationResult: validation });

        const jobId = crypto.randomUUID();
        const now = new Date().toISOString();
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO jobs (id,user_id,org_id,bulk_run_id,product_id,persona_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at)
             VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,'QUEUED',$10,$10)`,
            [jobId, user.id, membership.org_id, bulkRunId, item.product_id, item.script_id, BULK_FORMAT, BULK_TIER, BULK_DURATION_S, now]
          );
          await client.query("UPDATE scripts SET job_id=$1 WHERE id=$2", [jobId, item.script_id]);
          await client.query(
            "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'job.created','jobs',$3,$4,$5)",
            [crypto.randomUUID(), user.id, jobId, JSON.stringify({ script_id: item.script_id, dashboard_bulk_run_id: bulkRunId, org_id: membership.org_id }), now]
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
          results.push({ status: "failed", ...item, reason: "Kredit organisasi tidak cukup." });
          continue;
        }

        try {
          await enqueueJob(jobId);
        } catch {
          await jobsRepo.failJob(jobId, "Antrean render tidak tersedia; kredit dikembalikan otomatis.");
          results.push({ status: "failed", ...item, reason: "Antrean render tidak tersedia — kredit dikembalikan otomatis." });
          continue;
        }
        results.push({ status: "queued", ...item, job_id: jobId });
      }
    } finally {
      await pool.end();
      await jobsRepo.close();
      await creditsRepo.close();
    }

    return Response.json({
      bulk_run_id: bulkRunId,
      queued_count: results.filter((r) => r.status === "queued").length,
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
