import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgPromoJobsRepository } from "@/lib/postgres/promo-jobs";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { enqueuePromoJob } from "@/lib/promo/queue";
import { getHookById } from "@/lib/promo/hook-library";
import { getCreatorCategory } from "@/lib/personas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// r-single-clip (Brian 2026-08-10): konsepnya "1 hook AI + 1 klip real" —
// harus sinkron dengan MAX_CLIPS di app/promo/page.tsx.
const MAX_CLIPS = 1;
const MAX_AVATAR_DESCRIPTION_LEN = 600;

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

    // Toggle "hook normal <-> crazy" (Brian 2026-08-10): wajib pilih 1 hook
    // dari lib/promo/hook-library.ts — bukan default diam-diam, biar user
    // benar-benar memilih intensitas sebelum bayar.
    const hookId = typeof body.hook_id === "string" ? body.hook_id : "";
    const hookEntry = getHookById(hookId);
    if (!hookEntry) throw ERR.BAD_REQUEST("Pilih hook dulu.", "hook_id is required and must be a known hook.");

    let avatar: { kind: "preset" | "custom"; presetId?: string; customDescription?: string } | null = null;
    if (hookEntry.hasPerson) {
      const avatarBody = body.avatar ?? {};
      const kind = avatarBody.kind === "custom" ? "custom" : avatarBody.kind === "preset" ? "preset" : null;
      if (kind === "preset") {
        const presetId = typeof avatarBody.preset_id === "string" ? avatarBody.preset_id : "";
        const persona = getCreatorCategory(presetId);
        if (!persona || persona.status !== "active") throw ERR.BAD_REQUEST("Pilih avatar dulu.", "avatar.preset_id must be a known active persona.");
        avatar = { kind: "preset", presetId };
      } else if (kind === "custom") {
        const description = typeof avatarBody.description === "string" ? avatarBody.description.trim() : "";
        if (!description) throw ERR.BAD_REQUEST("Upload foto avatar dulu.", "avatar.description is required for custom avatar.");
        avatar = { kind: "custom", customDescription: description.slice(0, MAX_AVATAR_DESCRIPTION_LEN) };
      } else {
        throw ERR.BAD_REQUEST("Pilih avatar dulu.", "avatar.kind must be 'preset' or 'custom'.");
      }
    }

    const priceIdr = config.promoPriceIdr;
    const jobsRepo = new PgPromoJobsRepository(config.databaseUrl);
    const job = await jobsRepo.create(user.id, uploadedClipUrls, hookEntry.id, avatar);
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
