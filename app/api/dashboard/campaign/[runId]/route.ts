import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { isCurrentC5JobGeneration } from "@/lib/legacy-job-quarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkRunJob = {
  job_id: string; state: string; product_name: string; cost_actual_idr: number;
  video_url: string | null; caption: string | null;
  job_product_snapshot: string | null;
  product_category:string;category_review_state:string;category_review_reason:string|null;category_review_version:number;
};

// GET /api/dashboard/campaign/:runId — status satu campaign run, org-scoped (bukan
// per-user) supaya nantinya anggota org lain bisa lihat hasil yang sama
// (tidak ada RBAC granular di MVP — semua member org lihat semua, sesuai
// batas M3/M4 yang disetujui). Video hanya disertakan saat job READY.
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const { runId } = await ctx.params;

    const pool = getPool(config.databaseUrl);
    let rows: BulkRunJob[];
    try {
      const result = await pool.query<BulkRunJob>(
        `SELECT j.id AS job_id, j.state,j.job_product_snapshot, p.name AS product_name,p.category AS product_category,
                p.category_review_state,p.category_review_reason,p.category_review_version,j.cost_actual_idr,
                o.video_url, o.caption
         FROM jobs j
         JOIN products p ON p.id = j.product_id
         LEFT JOIN outputs o ON o.job_id = j.id
         WHERE j.org_id = $1 AND j.bulk_run_id = $2
         ORDER BY j.created_at ASC`,
        [membership.org_id, runId]
      );
      rows = result.rows;
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
    if (rows.length === 0) throw ERR.NOT_FOUND("Bulk run-nya");

    const jobs = rows.map((row, i) => {
      const ready = row.state === "READY" && row.video_url && isCurrentC5JobGeneration(row);
      // Nama berkas dari nama produk + nomor urut, bukan UUID: brand mengunduh
      // 6 berkas sekaligus dan harus bisa membedakannya di folder Downloads.
      const base = row.product_name.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 50) || "video";
      return {
        job_id: row.job_id, state: row.state, product_name: row.product_name, cost_idr: row.cost_actual_idr,
        video_url: ready ? createSignedUrl(row.video_url!) : null,
        download_url: ready ? `${createSignedUrl(row.video_url!)}&dl=${encodeURIComponent(`${base}-${i + 1}.mp4`)}` : null,
        caption: ready ? row.caption : null,
      };
    });

    return Response.json({
      campaign_run_id: runId,
      jobs,
      ready_count: jobs.filter((j) => j.state === "READY" && j.video_url !== null).length,
      failed_count: jobs.filter((j) => j.state === "FAILED" || j.state === "REFUNDED").length,
      total: jobs.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
