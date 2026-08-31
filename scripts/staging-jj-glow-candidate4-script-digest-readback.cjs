/** Exact managed, read-only provenance receipt for Candidate #4's approved-script digest. */
const crypto = require("node:crypto");
const { Pool } = require("pg");

const SCRIPT_ID = "ca32178f-2731-4234-bb07-48f24a2f2079";
const JOB_ID = "2c49a5c8-9465-4400-a214-159336a2c097";
const SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
};
const digest = (value) => crypto.createHash("sha256").update(canonical(value)).digest("hex");

async function main() {
  if (process.env.RACUN_DEPLOY_ENV !== "staging" || process.env.RENDER_SERVICE_ID !== SERVICE_ID) {
    throw new Error("CANDIDATE_4_SCRIPT_DIGEST_RUNTIME_MISMATCH");
  }
  const pool = new Pool({ connectionString:process.env.DATABASE_URL, max:1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const script = (await client.query(`SELECT id,job_id,product_id,hook_family,emotion,register,segments,caption,
      hashtags,validation_result,quality_tier,hook_level,approved_by_user_at,edited_by_user,created_at
      FROM scripts WHERE id=$1`, [SCRIPT_ID])).rows[0];
    const audits = (await client.query(`SELECT actor,created_at,meta FROM audit_log
      WHERE entity='scripts' AND entity_id=$1 AND action='script.manual_staged' ORDER BY created_at,id`, [SCRIPT_ID])).rows;
    if (!script || script.job_id !== JOB_ID || audits.length !== 1) {
      throw new Error("CANDIDATE_4_SCRIPT_DIGEST_ROW_MISMATCH");
    }
    const normalized = {...script, edited_by_user:Number(script.edited_by_user), manual_evidence_audit:audits[0]};
    console.log(JSON.stringify({event:"JJ_GLOW_CANDIDATE_4_SCRIPT_DIGEST_READBACK_PASS",
      service_id:process.env.RENDER_SERVICE_ID,runtime_sha:process.env.RENDER_GIT_COMMIT,
      transaction:"REPEATABLE READ READ ONLY",script:normalized,
      approved_script_sha256:digest(normalized),mutation:false}));
    await client.query("ROLLBACK");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error("JJ_GLOW_CANDIDATE_4_SCRIPT_DIGEST_READBACK_FAIL", error.message); process.exit(1); });
