import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getRedisJobQueue } from "@/lib/job-queue";
import { PgJobsRepository } from "@/lib/postgres/jobs";

// Temporary staging-only recovery endpoint. Removed immediately after the
// isolated load-test jobs are refunded and deleted from their nonce queue.
export async function POST(req: Request) {
  const secret = process.env.STAGING_LOAD_CLEANUP_SECRET;
  if (!secret || req.headers.get("x-staging-load-cleanup") !== secret) return new NextResponse(null, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.job_ids) ? body.job_ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
  if (!ids.length) return NextResponse.json({ error: "job_ids wajib diisi" }, { status: 400 });
  const repo = new PgJobsRepository(config.databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin });
  const queue = getRedisJobQueue();
  try {
    let refunded = 0; let removed = 0;
    for (const id of ids) {
      const result = await repo.failJob(id, "staging load-test cleanup");
      if (result.changed) refunded += result.refunded;
      const queued = await queue.getJob(id); if (queued) { await queued.remove(); removed++; }
    }
    return NextResponse.json({ requested: ids.length, refunded_idr: refunded, redis_removed: removed });
  } finally { await repo.close(); await queue.close(); }
}
