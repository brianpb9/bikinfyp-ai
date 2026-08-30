/**
 * One-shot reviewed staging admission for the internally-owned JJ GLOW QA
 * fixture. This file never calls a script/media provider. It inserts one
 * human-authored draft, then deliberately crosses the canonical HTTP approve
 * and job-admission gates. The staging worker must be externally verified as
 * suspended before this script is run.
 */
const { Pool } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

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
const BPOM_EVIDENCE_PATH = "docs/evidence/BPOM-KO-NA18260500350-20260831.json";
const BPOM_EVIDENCE_SHA256 = "d1c70d7e4f198ca8f63d587ceeeccc18af6b87fe2f7f5fb90a7ebb0b7f711d37";
const EXPECTED_PRODUCT_STATE_SHA256 = "2d575429751a26f5fe3ef51ddb4be5d4f537beb720b69c0d2f5db2182bb77af1";

const EXPECTED_PRODUCT_STATE = {
  id: PRODUCT_ID, user_id: PRINCIPAL, org_id: null, name: PRODUCT_NAME, price_idr: 1,
  category: "beauty", source_url: null,
  product_visual_desc: "INTERNAL QA fixture. Rp1 is a staging sentinel, not a market-price claim. BPOM NIE NA18260500350 verified active.",
  brand_brief: null, claims: null, promo_price_before_idr: null, promo_ends_at: null, promo_stock_left: null,
  images: ["uploads/c470390e-ad3d-4cc8-9ba2-4557691fa7a7/9047a662-d664-48f8-9c67-69fc10bc8289.webp"],
  brand: "JJ GLOW",
  staging_reference_rights: {
    scope: "internal_staging_ai_and_derivatives_only",
    receipt_key: "uploads/c470390e-ad3d-4cc8-9ba2-4557691fa7a7/9047a662-d664-48f8-9c67-69fc10bc8289.webp.rights.json",
    reference_key: "uploads/c470390e-ad3d-4cc8-9ba2-4557691fa7a7/9047a662-d664-48f8-9c67-69fc10bc8289.webp",
    receipt_sha256: EXPECTED_RECEIPT_SHA, reference_sha256: EXPECTED_REFERENCE_SHA, publication_permitted: false,
  },
  product_type_token: "bar soap",
  product_type_confirmed_token: "bar soap", product_type_confirmed_by: PRINCIPAL,
  product_type_confirmed_at: "2026-08-30T23:07:25.811Z", product_type_version: 1,
  product_type_state: "CONFIRMED", category_review_state: "CLEAR", category_review_reason: null,
  category_reviewed_by: PRINCIPAL, category_reviewed_role: "Founder/CEO",
  category_reviewed_at: "2026-08-30T23:07:26.018Z", category_review_version: 2,
};

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
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  : value;
const canonicalSha = (value) => sha(JSON.stringify(canonical(value)));
const exactIso = (value) => value == null ? null : new Date(value).toISOString();
const exactNumber = (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} is not finite`);
  return parsed;
};
const nullableNumber = (value, field) => value == null ? null : exactNumber(value, field);

function selectedProductState(product) {
  let rawMeta;
  try { rawMeta = JSON.parse(product.raw_meta || "{}"); } catch { throw new Error("product raw_meta invalid"); }
  return {
    id: product.id, user_id: product.user_id, org_id: product.org_id, name: product.name,
    price_idr: exactNumber(product.price_idr, "price_idr"), category: product.category, source_url: product.source_url,
    product_visual_desc: product.product_visual_desc, brand_brief: product.brand_brief, claims: product.claims,
    promo_price_before_idr: nullableNumber(product.promo_price_before_idr, "promo_price_before_idr"),
    promo_ends_at: product.promo_ends_at, promo_stock_left: nullableNumber(product.promo_stock_left, "promo_stock_left"),
    images: JSON.parse(product.images || "[]"), brand: rawMeta.brand ?? null,
    staging_reference_rights: rawMeta.staging_reference_rights ?? null,
    product_type_token: product.product_type_token, product_type_confirmed_token: product.product_type_confirmed_token,
    product_type_confirmed_by: product.product_type_confirmed_by,
    product_type_confirmed_at: exactIso(product.product_type_confirmed_at),
    product_type_version: exactNumber(product.product_type_version, "product_type_version"), product_type_state: product.product_type_state,
    category_review_state: product.category_review_state, category_review_reason: product.category_review_reason,
    category_reviewed_by: product.category_reviewed_by, category_reviewed_role: product.category_reviewed_role,
    category_reviewed_at: exactIso(product.category_reviewed_at),
    category_review_version: exactNumber(product.category_review_version, "category_review_version"),
  };
}

function assertExpectedProductState(product) {
  if (canonicalSha(EXPECTED_PRODUCT_STATE) !== EXPECTED_PRODUCT_STATE_SHA256) throw new Error("expected product-state digest constant invalid");
  if (canonicalSha(selectedProductState(product)) !== EXPECTED_PRODUCT_STATE_SHA256) throw new Error("exact product/C5 state digest mismatch");
}

function validateBpomEvidence(bytes, nowMs = Date.now()) {
  if (!Buffer.isBuffer(bytes)) throw new Error("BPOM evidence missing");
  if (sha(bytes) !== BPOM_EVIDENCE_SHA256) throw new Error("BPOM evidence digest mismatch");
  let evidence;
  try { evidence = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("BPOM evidence invalid JSON"); }
  if (evidence.schema !== "bikinfyp.authoritative-product-evidence/v1"
      || evidence.evidence_id !== "BPOM-KO-NA18260500350-20260831"
      || !String(evidence.source_url || "").startsWith("https://cekbpom.pom.go.id/")
      || evidence.query?.class_id !== "12" || evidence.query?.product_register !== "NA18260500350"
      || evidence.query?.records_filtered !== 1 || !Number.isFinite(Date.parse(evidence.retrieved_at))
      || !Number.isFinite(Date.parse(evidence.valid_until)) || nowMs > Date.parse(evidence.valid_until)) {
    throw new Error("BPOM evidence invalid or stale");
  }
  const expectedFacts = {
    application: "Notifikasi Kosmetika", category: "Kosmetika", nie: "NA18260500350",
    product_name: "GLUTA PINK BRIGHTENING SOAP", brand: "JJ GLOW", product_form: "Padat Sabun",
    status: "Berlaku", issued_on: "2026-04-13", expires_on: "2029-04-12",
    registrant: "UNINDO AJIDHARMA INDUSTRY, PT", manufacturer: "UNINDO AJIDHARMA INDUSTRY, PT",
    package: "Sachet, Dus 45 g, Sachet, Dus 90 g, Sachet, Dus 70 g, Sachet, Dus 80 g",
  };
  const claimIds = Array.isArray(evidence.claim_ledger) ? evidence.claim_ledger.map((claim) => claim.claim_id) : [];
  if (evidence.source_record_sha256 !== "276fe8522820b4625fd9a4d5948aa30b8080addaa9d207eaf79600586c7da9fd"
      || canonicalSha(evidence.source_record) !== evidence.source_record_sha256
      || canonicalSha(evidence.facts) !== canonicalSha(expectedFacts)
      || JSON.stringify(claimIds) !== JSON.stringify(["BPOM-REGISTRATION-STATUS", "BPOM-NIE", "BPOM-VALIDITY-DATES"])) {
    throw new Error("BPOM evidence facts/claims mismatch");
  }
  return evidence;
}

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
    const bpomEvidence = validateBpomEvidence(fs.readFileSync(path.resolve(process.cwd(), BPOM_EVIDENCE_PATH)));
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
      if (!product || product.script_count !== 0 || product.job_count !== 0
        || product.balance < EXPECTED_HOLD_IDR) throw new Error("candidate preflight invariant mismatch");
      assertExpectedProductState(product);
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
          task: "P0-JJ-GLOW-CANDIDATE-CONTRACT-20260831-R6",
          rights_evidence_source_task: "P0-JJ-GLOW-RIGHTS-REMEDIATION-20260831-R5",
          source: "manual", bpom_evidence_id: bpomEvidence.evidence_id,
          bpom_evidence_sha256: BPOM_EVIDENCE_SHA256, claims: bpomEvidence.claim_ledger, provider_calls: 0,
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

module.exports = {
  segments, admission, EXPECTED_PRODUCT_STATE, EXPECTED_PRODUCT_STATE_SHA256,
  BPOM_EVIDENCE_PATH, BPOM_EVIDENCE_SHA256, selectedProductState, assertExpectedProductState, validateBpomEvidence,
};
if (require.main === module) {
  main().catch((error) => {
    console.error("JJ_GLOW_CANDIDATE_FAIL", error.message);
    process.exit(1);
  });
}
