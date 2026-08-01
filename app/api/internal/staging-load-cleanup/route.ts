/**
 * Temporary staging-only recovery endpoint for the controlled queue load test.
 * It intentionally accepts no user input and only touches the fixed `Load Test %`
 * product marker. Remove immediately after the recovery deploy.
 */
import { Pool } from "pg";
import { config } from "@/lib/config";
import { getRedisJobQueue, closeRedisJobQueue } from "@/lib/job-queue";
import { PgJobsRepository } from "@/lib/postgres/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MARKER = "Load Test %";

function allowed(req: Request) {
  return process.env.RACUN_DEPLOY_ENV === "staging"
    && Boolean(process.env.RACUN_STAGING_LOAD_CLEANUP_SECRET)
    && req.headers.get("x-staging-load-cleanup-secret") === process.env.RACUN_STAGING_LOAD_CLEANUP_SECRET;
}

export async function POST(req: Request) {
  if (!allowed(req)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  if (!config.databaseUrl || !config.redisUrl) return Response.json({ code: "MISCONFIGURED" }, { status: 503 });

  const pool = new Pool({ connectionString: config.databaseUrl });
  const jobs = new PgJobsRepository(config.databaseUrl, { stateTimeoutsMin: config.stateTimeoutsMin });
  let scanned = 0, activeRefunded = 0, refundedIdr = 0, redisRemoved = 0;
  const stateCounts: Record<string, number> = {};
  try {
    // Fixed query, fixed marker, aggregate-only response: request data can
    // neither shape SQL nor target ordinary staging users.
    const found = await pool.query<{ id: string; state: string }>(
      "SELECT j.id,j.state FROM jobs j JOIN products p ON p.id=j.product_id WHERE p.name LIKE $1 ORDER BY j.created_at ASC LIMIT 100",
      [MARKER]
    );
    scanned = found.rowCount ?? 0;
    const queue = getRedisJobQueue();
    for (const row of found.rows) {
      stateCounts[row.state] = (stateCounts[row.state] ?? 0) + 1;
      if (!["READY", "FAILED", "REFUNDED"].includes(row.state)) {
        const result = await jobs.failJob(row.id, "Controlled staging load test cleanup before worker resume.");
        if (result.changed) { activeRefunded++; refundedIdr += result.refunded; }
      }
      const queued = await queue.getJob(row.id);
      if (queued) { await queued.remove(); redisRemoved++; }
    }
    return Response.json({ ok: true, marker: "Load Test %", scanned, state_counts_before_cleanup: stateCounts, active_refunded: activeRefunded, refunded_idr: refundedIdr, redis_removed: redisRemoved });
  } finally {
    await closeRedisJobQueue().catch(() => undefined);
    await jobs.close();
    await pool.end();
  }
}
