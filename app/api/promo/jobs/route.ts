import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { enqueuePromoJob } from "@/lib/promo/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/promo/jobs {uploaded_clip_url} — Video Promosi (non-ecommerce)
// prototype. Enqueued on its own BullMQ queue (lib/promo/queue.ts), consumed
// by the Docker worker service — that's where ffmpeg/ffprobe actually live,
// the web service has neither. Deliberately a separate queue from the
// e-commerce pipeline's: prototype-only, unbilled state machine, isolated.
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

    await enqueuePromoJob(job.id);

    return Response.json({ id: job.id, state: job.state }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
