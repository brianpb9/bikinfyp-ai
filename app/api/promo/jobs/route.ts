import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { enqueuePromoJob } from "@/lib/promo/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CLIPS = 5;

// POST /api/promo/jobs {uploaded_clip_urls: string[]} — Video Promosi
// (non-ecommerce) prototype. Enqueued on its own BullMQ queue
// (lib/promo/queue.ts), consumed by the Docker worker service — that's
// where ffmpeg/ffprobe actually live, the web service has neither.
// Deliberately a separate queue from the e-commerce pipeline's:
// prototype-only, unbilled state machine, isolated.
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Prototype ini butuh runtime PostgreSQL.", "Video Promosi prototype requires Postgres runtime.");
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const raw = body.uploaded_clip_urls ?? (body.uploaded_clip_url ? [body.uploaded_clip_url] : []);
    const uploadedClipUrls = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
    if (uploadedClipUrls.length < 1) throw ERR.BAD_REQUEST("Minimal 1 klip upload wajib.", "At least one uploaded_clip_urls entry is required.");
    if (uploadedClipUrls.length > MAX_CLIPS) throw ERR.BAD_REQUEST(`Maksimal ${MAX_CLIPS} klip untuk prototype ini.`, "Too many clips for this prototype.");

    const repo = new PgPromoJobsRepository(config.databaseUrl);
    const job = await repo.create(user.id, uploadedClipUrls);
    await repo.close();

    await enqueuePromoJob(job.id);

    return Response.json({ id: job.id, state: job.state }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
