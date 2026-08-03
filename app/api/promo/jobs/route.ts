import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { enqueuePromoJob } from "@/lib/promo/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CLIPS = 5;

// POST /api/promo/jobs {uploaded_clip_urls: string[]} — Video Promosi
// (non-ecommerce). Flat price (config.promoPriceIdr) held from the same
// credit_ledger as the e-commerce pipeline — job_id has no FK to `jobs`
// specifically, so PgCreditPaymentRepository works unmodified against
// promo_jobs.id. Enqueued on its own BullMQ queue (lib/promo/queue.ts),
// consumed by the Docker worker service — that's where ffmpeg/ffprobe
// actually live, the web service has neither. Deliberately a separate
// queue from the e-commerce pipeline's: isolated state machine, no
// entanglement with its retry/refund semantics.
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

    const priceIdr = config.promoPriceIdr;
    const jobsRepo = new PgPromoJobsRepository(config.databaseUrl);
    const job = await jobsRepo.create(user.id, uploadedClipUrls);
    await jobsRepo.close();

    const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
    let held: boolean;
    try { held = await creditsRepo.holdCredits(user.id, job.id, priceIdr); }
    finally { await creditsRepo.close(); }
    if (!held) {
      const failRepo = new PgPromoJobsRepository(config.databaseUrl);
      try { await failRepo.markFailed(job.id, "Kredit tidak cukup."); }
      finally { await failRepo.close(); }
      throw ERR.INSUFFICIENT_CREDITS();
    }

    await enqueuePromoJob(job.id);

    return Response.json({ id: job.id, state: job.state, hold_idr: priceIdr }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
