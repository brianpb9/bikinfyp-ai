import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, audit, type JobRow } from "@/lib/db";
import { applyFypReport, type FypSnapshotRow } from "@/lib/fyp-snapshot";
import { pgApplyFypReport, pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/jobs/:id/report {posted_url, views?, orders?} — user melaporkan video
// yang sudah diposting (loop predicted-vs-actual MODEL FYP).
// posted_url BEKU setelah terisi; views/orders boleh di-update kapan pun.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const postedUrl = String(body.posted_url ?? "");
    const views = body.views === undefined || body.views === null ? null : Number(body.views);
    const orders = body.orders === undefined || body.orders === null ? null : Number(body.orders);

    let row: FypSnapshotRow;
    if (postgresRuntimeEnabled()) {
      // Validasi URL di sini (jalur SQLite memvalidasi di applyFypReport).
      let parsed: URL;
      try {
        parsed = new URL(postedUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("non-http");
      } catch {
        throw ERR.BAD_REQUEST("Linknya belum valid — tempel link postingan lengkap ya (diawali https://).", "Invalid posted URL.");
      }
      const cleanNum = (v: number | null) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
      let updated;
      try {
        updated = await pgApplyFypReport(user.id, id, { postedUrl: parsed.toString(), views: cleanNum(views), orders: cleanNum(orders) });
      } catch (e) {
        if (e instanceof Error && e.message === "FYP_POSTED_URL_FROZEN")
          throw ERR.BAD_REQUEST(
            "Link postingan untuk video ini sudah tercatat dan tidak bisa diganti (data pembanding harus beku). Kalau salah tempel, hubungi kami ya.",
            "posted_url is frozen once set."
          );
        throw e;
      }
      if (!updated) throw ERR.NOT_FOUND("Skor video ini");
      row = updated as FypSnapshotRow;
      await pgAudit(user.id, "fyp.reported", "fyp_snapshots", id, { posted_url: row.posted_url, outcome: row.outcome_json });
      return Response.json({
        job_id: id,
        posted_url: row.posted_url,
        posted_at: row.posted_at,
        outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
        score: row.score,
        model_version: row.model_version,
      });
    }

    const db = getDb();
    const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, user.id) as JobRow | undefined;
    if (!job) throw ERR.NOT_FOUND("Videonya");
    row = applyFypReport(db, id, { postedUrl, views, orders });
    audit(user.id, "fyp.reported", "fyp_snapshots", id, { posted_url: row.posted_url, outcome: row.outcome_json });
    return Response.json({
      job_id: id,
      posted_url: row.posted_url,
      posted_at: row.posted_at,
      outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
      score: row.score,
      model_version: row.model_version,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
