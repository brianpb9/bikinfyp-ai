import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, type JobRow } from "@/lib/db";
import { sweepStaleJobs } from "@/lib/jobs";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled, smokeGetJob } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { pesanKegagalan, sebabDariAlasan } from "@/lib/pesan-kegagalan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/jobs/:id — status + progres.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (!postgresRuntimeEnabled()) sweepStaleJobs();
    const { id } = await ctx.params;
    const job = postgresRuntimeEnabled()
      ? await smokeGetJob(user.id, id) as JobRow | null
      : getDb().prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ? AND org_id IS NULL").get(id, user.id) as JobRow | undefined;
    if (!job) throw ERR.NOT_FOUND("Job-nya");

    // Sebab kegagalan tinggal di audit_log, bukan di baris job: failJob()
    // menulis {to, at, reason} ke sana. Dibaca HANYA saat job memang gagal —
    // job yang sehat tidak perlu membayar satu kueri tambahan.
    let alasanGagal: string | null = null;
    if (postgresRuntimeEnabled() && ["FAILED", "REFUNDED"].includes(job.state)) {
      try {
        const r = await getPool(config.databaseUrl).query<{ meta: string | null }>(
          `SELECT meta FROM audit_log
            WHERE entity='jobs' AND entity_id=$1 AND action='job.transition'
            ORDER BY created_at DESC LIMIT 5`, [id]);
        for (const baris of r.rows) {
          const m = JSON.parse(baris.meta ?? "{}") as { reason?: unknown };
          if (typeof m.reason === "string" && m.reason.trim()) { alasanGagal = m.reason; break; }
        }
      } catch {
        // Sebab tidak terbaca bukan alasan menggagalkan permintaan status —
        // pesannya jatuh ke varian "tidak diketahui", yang tetap jujur.
      }
    }

    return Response.json({
      id: job.id,
      state: job.state,
      format: job.format,
      duration_s: job.duration_s,
      script_id: job.script_id,
      product_id: job.product_id,
      quality_tier: job.quality_tier,
      provider_video: job.provider_video,
      provider_voice: job.provider_voice,
      cost_actual_idr: job.cost_actual_idr,
      qc_result: job.qc_result ? JSON.parse(job.qc_result) : null,
      created_at: job.created_at,
      completed_at: job.completed_at,
      message:
        job.state === "READY"
          ? "Videonya udah jadi! Jangan lupa nyalakan tanda 'konten AI' pas upload ya."
          : ["FAILED", "REFUNDED"].includes(job.state)
            // Sebabnya DISEBUT, bukan diseragamkan. Lihat lib/pesan-kegagalan.ts:
            // kalimat lama menyuruh mengganti foto walau penyebabnya bug kita,
            // dan Brian menerimanya pada job b95da10d yang fotonya tidak salah.
            ? pesanKegagalan(sebabDariAlasan(alasanGagal))
            : "Lagi dibikin — sekitar beberapa menit lagi. Kamu boleh tutup halaman ini, nanti kami kabarin.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
