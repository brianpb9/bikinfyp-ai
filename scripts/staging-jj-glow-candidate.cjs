/**
 * One-shot reviewed staging admission for the internally-owned JJ GLOW QA
 * fixture. This file never calls a script/media provider. It inserts one
 * human-authored draft, then deliberately crosses the canonical HTTP approve
 * and job-admission gates. The staging worker must be externally verified as
 * suspended before this script is run.
 */
const { Pool } = require("pg");
const crypto = require("node:crypto");

const BASE = "https://racun-ai-staging-web.onrender.com";
const PRINCIPAL = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
const EMAIL = "brianpb9@gmail.com";
const PRODUCT_ID = "c470390e-ad3d-4cc8-9ba2-4557691fa7a7";
const PRODUCT_NAME = "JJ GLOW GLUTA PINK BRIGHTENING SOAP";
const SCRIPT_ID = "f2207c1f-4a96-4c03-a42e-8b2c6fc3f68d";
const OTP = "846271";
const EXPECTED_REFERENCE_SHA = "744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1";
const EXPECTED_RECEIPT_SHA = "ca3906a381e6d299bc46fe62aeefbc3bd9b4183a6ff59c4f3cde2ca8f94788c3";
const EXPECTED_HOLD_IDR = 12_000;

const segments = [
  { role: "hook", start: 0, end: 3,
    text: "Eh bestie, lihat bentuk sabun batang ini, simpel banget tuh.",
    visual_direction: "Tangan langsung memegang sabun dalam close-up.", product_state: "partial" },
  { role: "demo", start: 3, end: 10,
    text: "Ini JJ GLOW GLUTA PINK BRIGHTENING SOAP, kosmetika terdaftar BPOM, nih.",
    visual_direction: "Tangan memutar referensi internal dengan penanda QA tetap terlihat.", product_state: "hero" },
  { role: "cta", start: 10, end: 15,
    text: "Kalau mau lihat detailnya, cek keranjang ya.",
    visual_direction: "Tangan menunjuk detail produk dan penanda QA.", product_state: "hero" },
];
const admission = {
  contentType: "affiliate", format: "hands_only", durationSec: 15,
  templateId: "manual-bpom-facts-v1", wordBudget: 29, requirePriceMention: false,
  hookLevel: "agak_berani", productCategory: "beauty", mechanic: "knowledge",
};
const initialValidation = {
  passed: true, errors: [], warnings: [], checked_at: "2026-08-31T00:00:00.000Z",
  script_source: "manual", admisi: admission,
};
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");

async function checkedJson(response, label) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${JSON.stringify(body)}`);
  return { response, body };
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) throw new Error("runtime secrets unavailable");
  if (process.env.RACUN_DEPLOY_ENV !== "staging" || process.env.RENDER_SERVICE_ID !== "srv-d9n28tijnfac73a87lt0") {
    throw new Error("staging service identity mismatch");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = false;
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const product = (await client.query(
      `SELECT p.*,
        (SELECT count(*)::int FROM scripts s WHERE s.product_id=p.id) script_count,
        (SELECT count(*)::int FROM jobs j WHERE j.product_id=p.id) job_count,
        (SELECT coalesce(sum(delta),0)::int FROM credit_ledger l WHERE l.user_id=p.user_id AND l.org_id IS NULL) balance
       FROM products p WHERE p.id=$1 AND p.user_id=$2 AND p.org_id IS NULL FOR UPDATE`,
      [PRODUCT_ID, PRINCIPAL],
      )).rows[0];
      if (!product || product.name !== PRODUCT_NAME || product.category !== "beauty"
        || product.category_review_state !== "CLEAR" || product.category_reviewed_by !== PRINCIPAL
        || product.category_reviewed_role !== "Founder/CEO" || product.category_review_version !== 2
        || product.product_type_state !== "CONFIRMED" || product.script_count !== 0 || product.job_count !== 0
        || product.balance < EXPECTED_HOLD_IDR) throw new Error("candidate preflight invariant mismatch");
      const images = JSON.parse(product.images || "[]");
      const rights = JSON.parse(product.raw_meta || "{}").staging_reference_rights;
      if (images.length !== 1 || !rights || rights.reference_key !== images[0]
        || rights.reference_sha256 !== EXPECTED_REFERENCE_SHA || rights.receipt_sha256 !== EXPECTED_RECEIPT_SHA
        || rights.publication_permitted !== false) throw new Error("candidate rights preflight mismatch");

      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO scripts (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,
          validation_result,quality_tier,hook_level,approved_by_user_at,edited_by_user,created_at)
         VALUES ($1,NULL,$2,'H1','senang','bestie',$3,$4,$5,$6,'high_quality','agak_berani',NULL,0,$7)`,
        [SCRIPT_ID, PRODUCT_ID, JSON.stringify(segments),
          "JJ GLOW GLUTA PINK BRIGHTENING SOAP adalah kosmetika padat sabun dengan NIE BPOM NA18260500350, aktif 13 April 2026–12 April 2029. Referensi visual internal QA; bukan kemasan resmi dan bukan untuk dijual.",
          JSON.stringify(["#JJGLOW", "#SabunBatang", "#BPOM"]), JSON.stringify(initialValidation), now],
      );
      await client.query(
        `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,'script.manual_staged','scripts',$3,$4,$5)`,
        [crypto.randomUUID(), PRINCIPAL, SCRIPT_ID, JSON.stringify({
          task: "P0-JJ-GLOW-RIGHTS-REMEDIATION-20260831-R5", source: "manual",
          bpom_nie: "NA18260500350", claims: [], provider_calls: 0,
        }), now],
      );
      await client.query("COMMIT");
      inserted = true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    const otpNow = new Date();
    const otpId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO otp_codes (id,email,code_hash,expires_at,attempts,created_at) VALUES ($1,$2,$3,$4,0,$5)",
      [otpId, EMAIL, sha(`${process.env.AUTH_SECRET}:otp:${EMAIL}:${OTP}`),
        new Date(otpNow.getTime() + 10 * 60_000).toISOString(), otpNow.toISOString()],
    );
    const auth = await checkedJson(await fetch(`${BASE}/api/auth/verify-otp`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, code: OTP }),
    }), "verify-otp");
    if (auth.body?.user?.id !== PRINCIPAL || auth.body?.user?.email !== EMAIL) throw new Error("wrong authenticated principal");
    const cookie = auth.response.headers.get("set-cookie");
    if (!cookie) throw new Error("session cookie missing");
    const headers = { cookie, "content-type": "application/json" };

    const approved = await checkedJson(await fetch(`${BASE}/api/scripts/${SCRIPT_ID}/approve`, {
      method: "POST", headers, body: JSON.stringify({}),
    }), "approve-script");
    if (!approved.body.approved_by_user_at || approved.body.validation?.passed !== true
        || approved.body.validation?.script_source !== "manual") throw new Error("canonical approval invariant mismatch");

    const admitted = await checkedJson(await fetch(`${BASE}/api/jobs`, {
      method: "POST", headers,
      body: JSON.stringify({ script_id: SCRIPT_ID, creator_category: "lokal", format: "hands_only", quality_tier: "high_quality", duration_s: 15 }),
    }), "admit-job");
    if (admitted.response.status !== 201 || admitted.body.state !== "QUEUED"
        || admitted.body.hold_idr !== EXPECTED_HOLD_IDR || admitted.body.duplicate) throw new Error("job admission response mismatch");
    const jobId = admitted.body.job_id;

    const final = (await pool.query(
      `SELECT j.*,s.approved_by_user_at,s.validation_result,p.creator_category,
        (SELECT count(*)::int FROM provider_tasks t WHERE t.job_id=j.id) provider_task_count,
        (SELECT count(*)::int FROM credit_ledger l WHERE l.job_id=j.id AND l.type='hold' AND l.delta=$2) hold_count
       FROM jobs j JOIN scripts s ON s.id=j.script_id JOIN personas p ON p.id=j.persona_id
       WHERE j.id=$1 AND j.user_id=$3 AND j.product_id=$4 AND j.org_id IS NULL`,
      [jobId, -EXPECTED_HOLD_IDR, PRINCIPAL, PRODUCT_ID],
    )).rows[0];
    if (!final || final.script_id !== SCRIPT_ID || final.state !== "QUEUED" || !final.approved_by_user_at
        || final.creator_category !== "lokal" || final.provider_video || final.provider_voice || final.output_url
        || final.provider_task_count !== 0 || final.hold_count !== 1) throw new Error("post-admission cross-row invariant mismatch");
    const validation = JSON.parse(final.validation_result);
    const manifest = JSON.parse(final.approved_reference_manifest);
    if (validation.script_source !== "manual" || validation.passed !== true
        || manifest.version !== 2 || manifest.references?.length !== 1
        || manifest.references[0].sha256 !== EXPECTED_REFERENCE_SHA
        || manifest.stagingReferenceRights?.binding?.reference_sha256 !== EXPECTED_REFERENCE_SHA
        || manifest.stagingReferenceRights?.binding?.receipt_sha256 !== EXPECTED_RECEIPT_SHA
        || manifest.stagingReferenceRights?.receipt?.publication_permitted !== false) throw new Error("manifest/provenance invariant mismatch");
    const totals = (await pool.query(
      `SELECT (SELECT count(*)::int FROM scripts WHERE product_id=$1) scripts,
              (SELECT count(*)::int FROM jobs WHERE product_id=$1) jobs`, [PRODUCT_ID],
    )).rows[0];
    if (totals.scripts !== 1 || totals.jobs !== 1) throw new Error("canonical candidate count mismatch");
    console.log(`JJ_GLOW_CANDIDATE_PASS product=${PRODUCT_ID} script=${SCRIPT_ID} job=${jobId} provider_tasks=0`);
  } catch (error) {
    if (inserted) {
      const committed = (await pool.query("SELECT id FROM jobs WHERE script_id=$1", [SCRIPT_ID]).catch(() => ({ rows: [] }))).rows[0];
      if (!committed) await pool.query("DELETE FROM scripts WHERE id=$1 AND job_id IS NULL", [SCRIPT_ID]).catch(() => undefined);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

module.exports = { segments, admission };
if (require.main === module) {
  main().catch((error) => {
    console.error("JJ_GLOW_CANDIDATE_FAIL", error.message);
    process.exit(1);
  });
}
