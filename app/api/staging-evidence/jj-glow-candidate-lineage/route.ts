import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import {
  authorizedStagingCandidateLineageRead,
  buildStagingCandidateLineageReceipt,
  JJ_PRINCIPAL_ID,
  JJ_PRODUCT_ID,
  JJ_SCRIPT_ID,
} from "@/lib/staging-candidate-lineage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizedStagingCandidateLineageRead(request)) return new Response("Not found", { status: 404 });
  try {
    const result = await getPool(config.databaseUrl).query(
      `SELECT j.*, p.creator_category, pr.images, pr.raw_meta,
        (SELECT count(*)::int FROM provider_tasks t WHERE t.job_id=j.id) provider_task_count,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold' AND l.delta=-12000) hold_count,
        (SELECT count(*)::int FROM jobs x WHERE x.product_id=j.product_id) product_job_count,
        (SELECT count(*)::int FROM scripts x WHERE x.product_id=j.product_id) product_script_count
       FROM jobs j
       JOIN personas p ON p.id=j.persona_id
       JOIN products pr ON pr.id=j.product_id
       WHERE j.product_id=$1 AND j.script_id=$2 AND j.user_id=$3 AND j.org_id IS NULL`,
      [JJ_PRODUCT_ID, JJ_SCRIPT_ID, JJ_PRINCIPAL_ID],
    );
    if (result.rowCount !== 1) throw new Error("sole exact candidate required");
    const sha = process.env.RENDER_GIT_COMMIT ?? "";
    return Response.json(buildStagingCandidateLineageReceipt(result.rows[0], new Date().toISOString(), sha), {
      status: 200,
      headers: { "cache-control": "private, no-store, max-age=0, must-revalidate" },
    });
  } catch (error) {
    console.error("[staging-candidate-lineage] fail-closed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ code: "STAGING_LINEAGE_UNAVAILABLE" }, { status: 409 });
  }
}
