import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { postgresRuntimeEnabled, pgAudit } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rencana posting. Lihat migrations/postgres/0019_post_plans.sql — ini
// perencana, bukan pengunggah otomatis. Tidak ada satu pun jalur di sini yang
// menghubungi TikTok/Instagram, dan UI-nya menyatakan itu terang-terangan.

const CHANNELS = new Set(["tiktok", "instagram", "shopee", "youtube", "lainnya"]);

type PlanRow = {
  id: string; job_id: string; channel: string; scheduled_at: string;
  caption: string | null; status: string; posted_at: string | null;
  product_name: string; state: string; video_url: string | null;
};

function nameFor(productName: string): string {
  return productName.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 50) || "video";
}

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const pool = getPool(config.databaseUrl);
    try {
      const plans = (await pool.query<PlanRow>(
        `SELECT pp.id, pp.job_id, pp.channel, pp.scheduled_at, pp.caption, pp.status, pp.posted_at,
                p.name AS product_name, j.state, o.video_url
         FROM post_plans pp
         JOIN jobs j ON j.id = pp.job_id
         JOIN products p ON p.id = j.product_id
         LEFT JOIN outputs o ON o.job_id = j.id
         WHERE pp.org_id = $1
         ORDER BY pp.scheduled_at ASC`,
        [membership.org_id]
      )).rows;

      // Video yang layak dijadwalkan: sudah READY dan punya berkas. Job yang
      // masih berjalan sengaja TIDAK ditawarkan — menjadwalkan sesuatu yang
      // belum tentu jadi hanya memindahkan kekecewaan ke hari H.
      const ready = (await pool.query<{ job_id: string; product_name: string; video_url: string; created_at: string }>(
        `SELECT j.id AS job_id, p.name AS product_name, o.video_url, j.created_at
         FROM jobs j JOIN products p ON p.id = j.product_id JOIN outputs o ON o.job_id = j.id
         WHERE j.org_id = $1 AND j.state = 'READY' AND o.video_url IS NOT NULL
         ORDER BY j.created_at DESC LIMIT 100`,
        [membership.org_id]
      )).rows;

      return Response.json({
        plans: plans.map((r) => ({
          id: r.id, job_id: r.job_id, channel: r.channel, scheduled_at: r.scheduled_at,
          caption: r.caption, status: r.status, posted_at: r.posted_at,
          product_name: r.product_name,
          download_url: r.video_url
            ? `${createSignedUrl(r.video_url)}&dl=${encodeURIComponent(`${nameFor(r.product_name)}.mp4`)}`
            : null,
        })),
        ready: ready.map((r) => ({ job_id: r.job_id, product_name: r.product_name })),
      });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("publish", membership.org_id);
    const body = await req.json().catch(() => ({}));

    const jobId = String(body.job_id ?? "");
    const channel = String(body.channel ?? "").toLowerCase();
    const scheduledAt = String(body.scheduled_at ?? "");
    if (!jobId) throw ERR.BAD_REQUEST("Pilih videonya dulu.", "job_id is required.");
    if (!CHANNELS.has(channel)) throw ERR.BAD_REQUEST("Kanal tidak dikenal.", "Unknown channel.");
    if (Number.isNaN(Date.parse(scheduledAt))) throw ERR.BAD_REQUEST("Tanggal/jamnya belum benar.", "Invalid scheduled_at.");

    const pool = getPool(config.databaseUrl);
    try {
      // Kepemilikan diperiksa lewat org_id job-nya, bukan lewat job_id saja.
      // Tanpa ini, siapa pun yang tahu sebuah job_id bisa menautkannya ke
      // organisasinya sendiri dan ikut mengunduh videonya lewat GET di atas.
      const owned = await pool.query(
        "SELECT 1 FROM jobs WHERE id=$1 AND org_id=$2 AND state='READY'", [jobId, membership.org_id]
      );
      if (!owned.rowCount) throw ERR.NOT_FOUND("Videonya");

      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO post_plans (id, org_id, job_id, channel, scheduled_at, caption, status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'planned',$7,$8)`,
        [id, membership.org_id, jobId, channel, scheduledAt,
         String(body.caption ?? "").slice(0, 2200) || null, user.id, new Date().toISOString()]
      );
      await pgAudit(user.id, "post.planned", "post_plans", id, { org_id: membership.org_id, channel });
      return Response.json({ id });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    const status = String(body.status ?? "");
    if (!id) throw ERR.BAD_REQUEST("id wajib diisi.", "id is required.");
    if (!["planned", "posted", "skipped"].includes(status)) throw ERR.BAD_REQUEST("Status tidak dikenal.", "Unknown status.");

    const pool = getPool(config.databaseUrl);
    try {
      const res = await pool.query(
        "UPDATE post_plans SET status=$1, posted_at=$2 WHERE id=$3 AND org_id=$4",
        [status, status === "posted" ? new Date().toISOString() : null, id, membership.org_id]
      );
      if (!res.rowCount) throw ERR.NOT_FOUND("Rencananya");
      await pgAudit(user.id, "post.status", "post_plans", id, { status });
      return Response.json({ ok: true });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    if (!id) throw ERR.BAD_REQUEST("id wajib diisi.", "id is required.");
    const pool = getPool(config.databaseUrl);
    try {
      const res = await pool.query("DELETE FROM post_plans WHERE id=$1 AND org_id=$2", [id, membership.org_id]);
      if (!res.rowCount) throw ERR.NOT_FOUND("Rencananya");
      return Response.json({ deleted: true });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}
