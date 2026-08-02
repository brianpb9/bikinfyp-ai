import { NextResponse } from "next/server";
import { Pool } from "pg";
import { config } from "@/lib/config";
import { getRedisJobQueue } from "@/lib/job-queue";

export async function POST(req: Request) {
  const secret = process.env.STAGING_LOAD_AUDIT_SECRET;
  if (!secret || req.headers.get("x-staging-load-audit") !== secret) return new NextResponse(null, { status: 404 });
  const body: { job_ids?: unknown } = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.job_ids) ? body.job_ids.filter((id: unknown): id is string => typeof id === "string").slice(0, 50) : [];
  if (!ids.length) return NextResponse.json({ error: "job_ids wajib diisi" }, { status: 400 });
  const pool = new Pool({ connectionString: config.databaseUrl }); const queue = getRedisJobQueue();
  try {
    const rows = await Promise.all(ids.map(async (id) => {
      const job = (await pool.query<{ id:string; user_id:string; state:string }>("SELECT id,user_id,state FROM jobs WHERE id=$1", [id])).rows[0] ?? null;
      const ledger = await pool.query<{ type:string; delta:string }>("SELECT type,delta::text FROM credit_ledger WHERE job_id=$1 ORDER BY created_at,id", [id]);
      const redis = await queue.getJob(id);
      return { id, state: job?.state ?? null, user_id: job?.user_id ?? null, ledger: ledger.rows, net_idr: ledger.rows.reduce((sum, row) => sum + Number(row.delta), 0), redis: redis ? await redis.getState() : null };
    }));
    return NextResponse.json({ rows });
  } finally { await queue.close(); await pool.end(); }
}
