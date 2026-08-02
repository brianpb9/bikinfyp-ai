import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { createSignedUrl } from "@/lib/signed-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/promo/jobs/:id — poll status (Video Promosi prototype).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Prototype ini butuh runtime PostgreSQL.", "Video Promosi prototype requires Postgres runtime.");
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const repo = new PgPromoJobsRepository(config.databaseUrl);
    const job = await repo.get(id, user.id);
    await repo.close();
    if (!job) throw ERR.NOT_FOUND("Job-nya");

    return Response.json({
      id: job.id,
      state: job.state,
      error_message: job.error_message,
      output_url: job.state === "READY" && job.output_url ? createSignedUrl(job.output_url) : null,
      cost_actual_idr: job.cost_actual_idr,
      created_at: job.created_at,
      completed_at: job.completed_at,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
