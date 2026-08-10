import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BulkRunJob = {
  job_id: string; state: string; product_name: string; cost_actual_idr: number;
  video_url: string | null; caption: string | null;
};

// GET /api/dashboard/bulk/:runId — status satu bulk run, org-scoped (bukan
// per-user) supaya nantinya anggota org lain bisa lihat hasil yang sama
// (tidak ada RBAC granular di MVP — semua member org lihat semua, sesuai
// batas M3/M4 yang disetujui). Video hanya disertakan saat job READY.
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard bulk-generate requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const { runId } = await ctx.params;

    const pool = new Pool({ connectionString: config.databaseUrl });
    let rows: BulkRunJob[];
    try {
      const result = await pool.query<BulkRunJob>(
        `SELECT j.id AS job_id, j.state, p.name AS product_name, j.cost_actual_idr,
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
      await pool.end();
    }
    if (rows.length === 0) throw ERR.NOT_FOUND("Bulk run-nya");

    const jobs = rows.map((row) => ({
      job_id: row.job_id, state: row.state, product_name: row.product_name, cost_idr: row.cost_actual_idr,
      video_url: row.state === "READY" && row.video_url ? createSignedUrl(row.video_url) : null,
      caption: row.caption,
    }));

    return Response.json({
      bulk_run_id: runId,
      jobs,
      ready_count: jobs.filter((j) => j.state === "READY").length,
      failed_count: jobs.filter((j) => j.state === "FAILED" || j.state === "REFUNDED").length,
      total: jobs.length,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
