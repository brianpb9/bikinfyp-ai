#!/usr/bin/env node

// Staging-only one-off runner. It emits one sanitized JSON receipt and never
// prints credentials, JWTs, signed URLs, product IDs, or object keys.
import crypto from "node:crypto";
import sharp from "sharp";
import { SignJWT } from "jose";
import { Pool } from "pg";
import { Queue } from "bullmq";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const TASK = "P1-MANAGED-STAGING-ORG-INGESTION-TRACE-20260825";
const APP_SHA = "246fa65949a487e82e4594c0bebb6ecc5a4e53bb";
const ORIGIN = "https://racun-ai-staging-web.onrender.com";
const startedAt = new Date().toISOString();
const suffix = crypto.randomUUID();
const userId = `org-trace-user-${suffix}`;
const orgId = `org-trace-${suffix}`;
const memberId = `org-trace-member-${suffix}`;
const email = `org-trace-${suffix}@staging.invalid`;
const slug = `org-trace-${suffix}`;
let productId = null;
const imageKeys = [];

for (const key of ["DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"]) {
  if (!process.env[key]) throw new Error(`required managed slot absent: ${key}`);
}
if (process.env.RACUN_DB_RUNTIME !== "postgres") throw new Error("PostgreSQL runtime required");
if (process.env.STORAGE_MODE !== "r2") throw new Error("R2 storage required");
if ((process.env.PAYMENT_GATEWAY ?? "").toLowerCase() !== "duitku") throw new Error("Duitku staging required");
if ((process.env.DUITKU_IS_PRODUCTION ?? "false").toLowerCase() === "true") throw new Error("Duitku production forbidden");
if ((process.env.PAYMENTS_GO_LIVE ?? "false").toLowerCase() === "true") throw new Error("live payments forbidden");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const queue = new Queue(process.env.REDIS_QUEUE_NAME || "racun-jobs", {
  connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
});
const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: process.env.R2_REGION || "auto",
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

const scalar = async (sql, values = []) => Number((await pool.query(sql, values)).rows[0]?.n ?? 0);
const targetSnapshot = async () => ({
  users: await scalar("SELECT count(*) n FROM users WHERE id=$1", [userId]),
  organizations: await scalar("SELECT count(*) n FROM organizations WHERE id=$1", [orgId]),
  org_members: await scalar("SELECT count(*) n FROM org_members WHERE id=$1 OR (org_id=$2 AND user_id=$3)", [memberId, orgId, userId]),
  products: await scalar("SELECT count(*) n FROM products WHERE org_id=$1 OR user_id=$2", [orgId, userId]),
  scripts: await scalar("SELECT count(*) n FROM scripts s JOIN products p ON p.id=s.product_id WHERE p.org_id=$1 OR p.user_id=$2", [orgId, userId]),
  jobs: await scalar("SELECT count(*) n FROM jobs WHERE org_id=$1 OR user_id=$2", [orgId, userId]),
  provider_tasks: await scalar("SELECT count(*) n FROM provider_tasks pt JOIN jobs j ON j.id=pt.job_id WHERE j.org_id=$1 OR j.user_id=$2", [orgId, userId]),
  ledger: await scalar("SELECT count(*) n FROM credit_ledger WHERE org_id=$1 OR user_id=$2", [orgId, userId]),
  payments: await scalar("SELECT count(*) n FROM payments WHERE user_id=$1", [userId]),
  audits: await scalar("SELECT count(*) n FROM audit_log WHERE actor=$1 OR entity_id=$2 OR entity_id=$3", [userId, orgId, productId]),
});
const optionalFinancialTables = async () => {
  const result = {};
  for (const table of ["invoices", "refunds", "settlements"]) {
    const exists = Boolean((await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`])).rows[0]?.present);
    if (!exists) { result[table] = { exists: false, target_rows: 0 }; continue; }
    const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table])).rows.map((row) => row.column_name);
    const clauses = [];
    const values = [];
    if (columns.includes("user_id")) { values.push(userId); clauses.push(`user_id=$${values.length}`); }
    if (columns.includes("org_id")) { values.push(orgId); clauses.push(`org_id=$${values.length}`); }
    result[table] = { exists: true, target_rows: clauses.length ? await scalar(`SELECT count(*) n FROM ${table} WHERE ${clauses.join(" OR ")}`, values) : 0, identity_columns_present: clauses.length > 0 };
  }
  return result;
};
const queueSnapshot = async () => {
  const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "failed", "completed", "paused");
  const jobs = await queue.getJobs(["wait", "active", "delayed", "prioritized", "failed"], 0, 499, true);
  return { counts, task_identity_jobs: jobs.filter((job) => String(job.data?.userId ?? "") === userId || String(job.data?.orgId ?? "") === orgId).length };
};
const listObjects = async () => {
  if (!productId) return [];
  const found = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: `uploads/${productId}/`, ContinuationToken: token }));
    found.push(...(page.Contents ?? []).map((item) => item.Key).filter(Boolean));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return found;
};
const getBytes = async (key) => {
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
};
const makePng = async (withLabel) => {
  const label = withLabel
    ? '<text x="540" y="465" text-anchor="middle" font-family="Arial" font-size="42" font-weight="bold" fill="#222">NOVA SERUM</text><text x="540" y="525" text-anchor="middle" font-family="Arial" font-size="30" fill="#333">SKINCARE</text>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#e9e2d7"/><ellipse cx="540" cy="920" rx="250" ry="45" fill="#c8bfb2"/><rect x="330" y="130" width="420" height="760" rx="100" fill="#f8f3ea" stroke="#625c55" stroke-width="8"/><rect x="440" y="60" width="200" height="140" rx="24" fill="#999188"/>${label}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};
const requestJson = async (token, path, init) => {
  const response = await fetch(`${ORIGIN}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: `racun_token=${encodeURIComponent(token)}`, "user-agent": `${TASK}/1` } });
  const raw = await response.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { body = { unparseable: true }; }
  return { status: response.status, body };
};
const addPhoto = async (token, bytes) => {
  const form = new FormData();
  form.append("photos", new Blob([bytes], { type: "image/png" }), "nova.png");
  return requestJson(token, `/api/dashboard/campaign/product/${productId}/photos`, { method: "POST", body: form });
};

const receipt = {
  schema: "managed-org-ingestion-trace/v1",
  task: TASK,
  started_at: startedAt,
  deployed_app_sha_expected: APP_SHA,
  execution: "MANAGED_STAGING_ONE_OFF_PLUS_PUBLIC_HTTP",
  preconditions: {
    node_env_production: process.env.NODE_ENV === "production",
    postgres_runtime: process.env.RACUN_DB_RUNTIME === "postgres",
    storage_mode_r2: process.env.STORAGE_MODE === "r2",
    queue_mode: process.env.RACUN_QUEUE_MODE,
    payment_gateway: process.env.PAYMENT_GATEWAY,
    duitku_production: false,
    payments_go_live: false,
    credential_values_or_digests_recorded: false,
  },
  requested_endpoints: [],
  forbidden_endpoints_called: [],
  payment_url_opened: false,
  generation_provider_called: false,
  e6: null,
  e8_positive: null,
  counterexamples: {},
  before: {},
  before_cleanup: {},
  after_cleanup: {},
  cleanup: {},
  result: "FAIL",
};

try {
  receipt.before = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: (await listObjects()).length };
  await pool.query("INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES ($1,NULL,$2,$3,'free','id-ID',$4)", [userId, email, "Managed org trace", startedAt]);
  await pool.query("INSERT INTO organizations (id,name,slug,status,created_at) VALUES ($1,$2,$3,'active',$4)", [orgId, "Managed Org Trace", slug, startedAt]);
  await pool.query("INSERT INTO org_members (id,org_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',$4)", [memberId, orgId, userId, startedAt]);
  const token = await new SignJWT({ phone: "" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  receipt.requested_endpoints.push("POST /api/dashboard/campaign/product (manual E6)");
  const created = await requestJson(token, "/api/dashboard/campaign/product", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nova Serum Skincare", price_idr: 12000, category: "beauty" }) });
  if (created.status !== 200 || typeof created.body.product_id !== "string") throw new Error(`E6 create failed with HTTP ${created.status}`);
  productId = created.body.product_id;
  const productAtE6 = (await pool.query("SELECT id,user_id,org_id,source_url,name,price_idr,category,product_visual_desc,brand_brief,claims,images,promo_price_before_idr,promo_ends_at,promo_stock_left,raw_meta FROM products WHERE id=$1 AND org_id=$2", [productId, orgId])).rows[0];
  const e6Exact = productAtE6
    && productAtE6.user_id === userId && productAtE6.org_id === orgId
    && productAtE6.source_url === null && productAtE6.name === "Nova Serum Skincare"
    && Number(productAtE6.price_idr) === 12000 && productAtE6.category === "beauty"
    && productAtE6.product_visual_desc === null && productAtE6.brand_brief === null
    && productAtE6.claims === null && productAtE6.images === "[]"
    && productAtE6.promo_price_before_idr === null && productAtE6.promo_ends_at === null
    && productAtE6.promo_stock_left === null && productAtE6.raw_meta === null;
  receipt.e6 = {
    http: created.status,
    response_exact: created.body.product_id === productId && created.body.name === "Nova Serum Skincare" && Number(created.body.price_idr) === 12000 && created.body.category === "beauty" && Array.isArray(created.body.images) && created.body.images.length === 0,
    postgres_exact_create_data: Boolean(e6Exact),
    exact_org_owner: productAtE6?.org_id === orgId && productAtE6?.user_id === userId,
    ordered_images_empty: productAtE6?.images === "[]",
    raw_meta_brand: null,
  };
  if (!receipt.e6.response_exact || !receipt.e6.postgres_exact_create_data) throw new Error("E6 exact API/PostgreSQL create data mismatch");

  const validPng = await makePng(true);
  receipt.requested_endpoints.push("POST /api/dashboard/campaign/product/:id/photos (valid E8)");
  const added = await addPhoto(token, validPng);
  if (added.status !== 200 || !Array.isArray(added.body.images) || added.body.images.length !== 1) throw new Error(`E8 positive failed with HTTP ${added.status}`);
  imageKeys.push(...added.body.images.map(String));
  const productAtE8 = (await pool.query("SELECT images,raw_meta FROM products WHERE id=$1 AND org_id=$2", [productId, orgId])).rows[0];
  const persistedImages = JSON.parse(productAtE8.images);
  const key = imageKeys[0];
  const object = await getBytes(key);
  const sidecar = JSON.parse((await getBytes(`${key}.meta.json`)).toString("utf8"));
  receipt.e8_positive = {
    http: added.status,
    api_db_ordered_images_exact: JSON.stringify(added.body.images) === JSON.stringify(persistedImages),
    api_db_r2_key_identity_exact: JSON.stringify(persistedImages) === JSON.stringify(imageKeys),
    object_present: true,
    sidecar_present: true,
    sidecar: {
      jenis: sidecar.jenis,
      layak_referensi: sidecar.layakReferensi,
      rasio_area_teks: sidecar.rasioAreaTeks,
      jumlah_kata: sidecar.jumlahKata,
      versi_bukti: sidecar.versiBukti,
      sha256_matches_object: sidecar.sha256 === crypto.createHash("sha256").update(object).digest("hex"),
    },
  };
  if (!receipt.e8_positive.api_db_r2_key_identity_exact || receipt.e8_positive.sidecar.jenis !== "product_photo" || receipt.e8_positive.sidecar.layak_referensi !== true || !receipt.e8_positive.sidecar.sha256_matches_object) throw new Error("E8 exact image/sidecar identity failed");

  receipt.requested_endpoints.push("POST /api/dashboard/campaign/product/:id/photos (unreadable E8)");
  const beforeNegativeObjects = await listObjects();
  const beforeNegativeImages = productAtE8.images;
  const unreadable = await addPhoto(token, await makePng(false));
  const afterNegativeProduct = (await pool.query("SELECT images FROM products WHERE id=$1 AND org_id=$2", [productId, orgId])).rows[0];
  const afterNegativeObjects = await listObjects();
  receipt.counterexamples.label_unreadable = {
    http: unreadable.status,
    code: unreadable.body.code ?? null,
    retryable: unreadable.body.retryable ?? null,
    postgres_unchanged: afterNegativeProduct?.images === beforeNegativeImages,
    r2_object_set_unchanged: JSON.stringify(afterNegativeObjects.sort()) === JSON.stringify(beforeNegativeObjects.sort()),
  };
  receipt.counterexamples.brand_mismatch = {
    executed: false,
    reason: "E6 manual create has no brand input and persists raw_meta=null; E8 therefore has no registered brand to compare. Direct DB mutation or a new API contract would manufacture authority and was not done.",
    authoritative_blocker_observed: productAtE8.raw_meta === null,
  };
  receipt.counterexamples.classifier_failed = { executed: false, reason: "No deterministic input can force classifier infrastructure failure without mutating the accepted runtime." };
  receipt.counterexamples.evidence_invalid = { executed: false, reason: "Forcing corrupt/missing R2 evidence would require direct mutation of accepted evidence; no such mutation was performed." };
  if (receipt.counterexamples.label_unreadable.http !== 400 || receipt.counterexamples.label_unreadable.code !== "LABEL_UNREADABLE" || !receipt.counterexamples.label_unreadable.postgres_unchanged || !receipt.counterexamples.label_unreadable.r2_object_set_unchanged) throw new Error("E8 unreadable pre-persistence counterexample failed");

  await new Promise((resolve) => setTimeout(resolve, 300));
  receipt.before_cleanup = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: (await listObjects()).length };
  const forbidden = receipt.before_cleanup.target;
  if (forbidden.scripts || forbidden.jobs || forbidden.provider_tasks || forbidden.ledger || forbidden.payments) throw new Error("forbidden job/provider/ledger/payment state detected");
  if (Object.values(receipt.before_cleanup.optional_financial).some((entry) => entry.target_rows !== 0)) throw new Error("forbidden optional financial state detected");
  if (Object.values(receipt.before_cleanup.queue.counts).some((value) => value !== 0) || receipt.before_cleanup.queue.task_identity_jobs !== 0) throw new Error("queue is not zero");
  receipt.result = "PASS_PENDING_CLEANUP";
} catch (error) {
  receipt.error = { name: error?.name ?? "Error", message: String(error?.message ?? error).slice(0, 500) };
} finally {
  try {
    for (const key of await listObjects()) await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    receipt.cleanup.media = (await listObjects()).length === 0;
  } catch (error) { receipt.cleanup.media_error = String(error?.message ?? error).slice(0, 300); }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2 OR entity_id=$3", [userId, orgId, productId]);
      await client.query("DELETE FROM products WHERE org_id=$1 OR user_id=$2", [orgId, userId]);
      await client.query("DELETE FROM org_members WHERE org_id=$1 OR user_id=$2", [orgId, userId]);
      await client.query("DELETE FROM organizations WHERE id=$1", [orgId]);
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      await client.query("COMMIT");
      receipt.cleanup.database = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2 OR entity_id=$3", [userId, orgId, productId]);
  } catch (error) { receipt.cleanup.database_error = String(error?.message ?? error).slice(0, 300); }
  try {
    receipt.after_cleanup = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: (await listObjects()).length };
  } catch (error) { receipt.after_cleanup_error = String(error?.message ?? error).slice(0, 300); }
  const targetClean = Object.values(receipt.after_cleanup.target ?? {}).every((value) => value === 0);
  const financialClean = Object.values(receipt.after_cleanup.optional_financial ?? {}).every((entry) => entry.target_rows === 0);
  const queueClean = receipt.after_cleanup.queue?.task_identity_jobs === 0 && Object.values(receipt.after_cleanup.queue?.counts ?? {}).every((value) => value === 0);
  if (receipt.result === "PASS_PENDING_CLEANUP" && receipt.cleanup.media && receipt.cleanup.database && targetClean && financialClean && queueClean && receipt.after_cleanup.r2_object_count === 0) receipt.result = "PASS";
  else if (receipt.result === "PASS_PENDING_CLEANUP") receipt.result = "FAIL_CLEANUP";
  receipt.finished_at = new Date().toISOString();
  await queue.close().catch(() => {});
  await pool.end().catch(() => {});
  console.log(JSON.stringify(receipt));
}
