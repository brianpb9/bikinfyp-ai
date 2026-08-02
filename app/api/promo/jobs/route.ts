import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { processPromoJob } from "@/lib/promo/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/promo/jobs {uploaded_clip_url} — Video Promosi (non-ecommerce)
// prototype. Runs in-process (Render is a persistent Node server, not
// serverless — the fire-and-forget promise below keeps running after the
// response is sent). Deliberately not on the BullMQ/Redis queue shared with
// the e-commerce pipeline: this is prototype-only, unbilled, isolated.
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Prototype ini butuh runtime PostgreSQL.", "Video Promosi prototype requires Postgres runtime.");
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const uploadedClipUrl = String(body.uploaded_clip_url ?? "");
    if (!uploadedClipUrl) throw ERR.BAD_REQUEST("uploaded_clip_url wajib diisi.", "uploaded_clip_url is required.");

    const repo = new PgPromoJobsRepository(config.databaseUrl);
    const job = await repo.create(user.id, uploadedClipUrl);
    await repo.close();

    processPromoJob(job).catch((err) => console.error(`[promo] job ${job.id} unhandled:`, err));

    return Response.json({ id: job.id, state: job.state }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
