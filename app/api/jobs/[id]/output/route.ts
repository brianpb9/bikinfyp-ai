import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, type JobRow } from "@/lib/db";
import { createSignedUrl } from "@/lib/signed-url";
import { PRE_DOWNLOAD_NOTICE } from "@/lib/config/compliance";
import { postgresRuntimeEnabled, smokeGetJob, smokeGetOutput } from "@/lib/postgres/smoke-runtime";
import { computeViralityChecklist } from "@/lib/virality-checklist";
import { assertCategoryReviewClear } from "@/lib/product-type-boundary";
import { assertCurrentC5JobGeneration } from "@/lib/legacy-job-quarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/jobs/:id/output — paket keluaran (F-09) dengan signed URL TTL 1 jam.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const db = postgresRuntimeEnabled() ? null : getDb();
    const job = postgresRuntimeEnabled()
      ? await smokeGetJob(user.id, id) as (JobRow & { product_category: string; category_review_state: string; category_review_reason: string | null; category_review_version: number }) | null
      : db!.prepare(`SELECT j.*,p.category AS product_category,p.category_review_state,
          p.category_review_reason,p.category_review_version
          FROM jobs j JOIN products p ON p.id=j.product_id
          WHERE j.id = ? AND j.user_id = ? AND j.org_id IS NULL`).get(id, user.id) as (JobRow & { product_category: string; category_review_state: string; category_review_reason: string | null; category_review_version: number }) | undefined;
    if (!job) throw ERR.NOT_FOUND("Job-nya");
    assertCategoryReviewClear({state:job.category_review_state as "CLEAR"|"QUARANTINED",
      reason:job.category_review_reason as never,version:job.category_review_version},job.product_category);
    assertCurrentC5JobGeneration(job);
    if (job.state !== "READY") throw ERR.JOB_NOT_READY();

    const output = postgresRuntimeEnabled()
      ? await smokeGetOutput(user.id, id) as { job_id: string; video_url: string; caption: string; hashtags: string; suggested_post_time: string; compliance_checklist: string } | null
      : db!.prepare("SELECT * FROM outputs WHERE job_id = ?").get(id) as { job_id: string; video_url: string; caption: string; hashtags: string; suggested_post_time: string; compliance_checklist: string } | undefined;
    if (!output) throw ERR.JOB_NOT_READY();

    const ctaText = `${output.caption} ${JSON.parse(output.hashtags).join(" ")}`.toLowerCase();
    const virality = computeViralityChecklist({
      durationSec: job.duration_s,
      // "keranjang" saja, BUKAN "keranjang kuning". "Kuning" cuma istilah
      // branding TikTok Shop; Shopee/Tokopedia/manual memakai "keranjang" polos
      // (lihat cartLabelForUrl). Pemeriksaan literal lama menyatakan caption
      // Shopee yang berbunyi "cek keranjang" TIDAK punya CTA — positif palsu
      // yang menurunkan skor video yang sebenarnya benar.
      //
      // Validator L-03 sudah memakai pemeriksaan generik ini sejak lama dengan
      // alasan yang sama; pemeriksa di sini yang tertinggal.
      hasCta: ctaText.includes("keranjang"),
      hasAudioOrCaption: true, // guaranteed by format/tier constraints — silent_caption has synced captions, voiced tiers have embedded audio
    });

    return Response.json({
      job_id: id,
      video_url: createSignedUrl(output.video_url),
      video_expires_in_sec: 3600,
      caption: output.caption,
      hashtags: JSON.parse(output.hashtags),
      suggested_post_time: output.suggested_post_time,
      compliance_checklist: JSON.parse(output.compliance_checklist),
      virality_checklist: virality,
      notice: PRE_DOWNLOAD_NOTICE,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
