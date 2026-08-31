import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import {
  authorizedStagingCandidateLineageRead,
  buildStagingCandidateLineageReceipt,
  buildStagingWebDatabaseBindingReceipt,
  JJ_PRINCIPAL_ID,
  JJ_PRODUCT_ID,
  JJ_SCRIPT_ID,
} from "@/lib/staging-candidate-lineage";
import { postgresRuntimeBinding } from "@/lib/postgres/runtime-binding.cjs";
import type { PoolClient } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorizedStagingCandidateLineageRead(request)) return new Response("Not found", { status: 404 });
  const pool = getPool(config.databaseUrl);
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const binding = await postgresRuntimeBinding(client);
    const result = await client.query(
      `SELECT j.*, p.creator_category, pr.images, pr.raw_meta,
        current_database() database_name, current_user database_principal,
        coalesce(inet_server_addr()::text,'local') database_server_address,
        coalesce(inet_server_port(),0)::int database_server_port,
        (SELECT count(*)::int FROM provider_tasks t WHERE t.job_id=j.id) provider_task_count,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold') hold_count,
        (SELECT coalesce(sum(l.delta),0)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold') hold_delta,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type IN ('capture','release')) terminal_ledger_count,
        (SELECT coalesce(sum(l.delta),0)::int FROM credit_ledger l WHERE l.job_id=j.id) job_ledger_net,
        (SELECT count(*)::int FROM jobs x WHERE x.product_id=j.product_id) product_job_count,
        (SELECT count(*)::int FROM scripts x WHERE x.product_id=j.product_id) product_script_count
        ,(SELECT count(*)::int FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id AND a.action='candidate.lifecycle.created') lifecycle_receipt_count
        ,(SELECT a.actor FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id AND a.action='candidate.lifecycle.created' ORDER BY a.created_at DESC LIMIT 1) lifecycle_actor
        ,(SELECT a.meta FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id AND a.action='candidate.lifecycle.created' ORDER BY a.created_at DESC LIMIT 1) lifecycle_meta
        ,(SELECT a.created_at FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id AND a.action='candidate.lifecycle.created' ORDER BY a.created_at DESC LIMIT 1) lifecycle_created_at
       FROM jobs j
       JOIN personas p ON p.id=j.persona_id
       JOIN products pr ON pr.id=j.product_id
       WHERE j.product_id=$1 AND j.script_id=$2 AND j.user_id=$3 AND j.org_id IS NULL`,
      [JJ_PRODUCT_ID, JJ_SCRIPT_ID, JJ_PRINCIPAL_ID],
    );
    await client.query("COMMIT");
    const sha = process.env.RENDER_GIT_COMMIT ?? "";
    const queriedAt = new Date().toISOString();
    const webBinding = buildStagingWebDatabaseBindingReceipt(binding, result.rowCount ?? 0, queriedAt, sha);
    const lineage = result.rowCount === 0 ? null : buildStagingCandidateLineageReceipt(result.rows[0], queriedAt, sha);
    if (lineage && lineage.lifecycle.database_binding_sha256 !== binding.sha256) {
      throw new Error("JJ lifecycle/web database binding mismatch");
    }
    const body = lineage ? { ...lineage, web_process_database_binding: webBinding } : webBinding;
    return Response.json(body, {
      status: 200,
      headers: { "cache-control": "private, no-store, max-age=0, must-revalidate" },
    });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    console.error("[staging-candidate-lineage] fail-closed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ code: "STAGING_LINEAGE_UNAVAILABLE" }, { status: 409 });
  } finally { client?.release(); }
}
