const { Client } = require("pg");

const PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
const PRINCIPAL_ID = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const rows = (await client.query(
      `SELECT j.id job_id, j.persona_id, j.state, j.created_at,
        j.provider_video IS NULL provider_video_is_null,
        j.provider_voice IS NULL provider_voice_is_null,
        j.output_url IS NULL output_url_is_null,
        (SELECT count(*)::int FROM provider_tasks t WHERE t.job_id=j.id) provider_task_count,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold') hold_count,
        (SELECT coalesce(sum(l.delta),0)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold') hold_delta,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type IN ('capture','release')) terminal_ledger_count
       FROM jobs j
       WHERE j.product_id=$1 AND j.script_id=$2 AND j.user_id=$3 AND j.org_id IS NULL
       ORDER BY j.created_at`,
      [PRODUCT_ID, SCRIPT_ID, PRINCIPAL_ID],
    )).rows;
    const totals = (await client.query(
      `SELECT
        (SELECT count(*)::int FROM scripts WHERE product_id=$1 AND user_id=$2 AND org_id IS NULL) product_script_count,
        (SELECT count(*)::int FROM jobs WHERE product_id=$1 AND user_id=$2 AND org_id IS NULL) product_job_count,
        (SELECT count(*)::int FROM provider_tasks t JOIN jobs j ON j.id=t.job_id WHERE j.product_id=$1) product_provider_task_count,
        (SELECT count(*)::int FROM audit_log WHERE action='script.manual_staged' AND entity_id=$3) manual_stage_audit_count,
        (SELECT count(*)::int FROM credit_ledger WHERE id='jj-glow-candidate-credit-grant-20260831') historical_grant_count,
        (SELECT coalesce(sum(delta),0)::int FROM credit_ledger WHERE user_id=$2 AND org_id IS NULL) balance`,
      [PRODUCT_ID, PRINCIPAL_ID, SCRIPT_ID],
    )).rows[0];
    await client.query("COMMIT");
    // Render's one-off log retrieval currently exposes stderr reliably; this
    // payload is intentionally secret-free and safe to preserve as evidence.
    console.error("JJ_REPLACEMENT_READBACK_PASS", JSON.stringify({
      queried_at: new Date().toISOString(),
      runtime: {
        service_id: process.env.RENDER_SERVICE_ID || null,
        deploy_env: process.env.RACUN_DEPLOY_ENV || null,
        deployed_sha: process.env.RENDER_GIT_COMMIT || null,
      },
      product_id: PRODUCT_ID,
      script_id: SCRIPT_ID,
      rows,
      totals,
      mutation: false,
    }));
    // Force Render to retain the diagnostic stream for this read-only probe.
    // Exit 42 means "receipt emitted", not a readback failure.
    process.exit(42);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("JJ_REPLACEMENT_READBACK_FAIL", error.message);
  process.exit(1);
});
