#!/usr/bin/env node

// Managed-STAGING-only trace. Emits one sanitized receipt; never prints
// credentials, JWTs, signed URLs, test IDs, or object keys.
import crypto from "node:crypto";
import sharp from "sharp";
import { SignJWT } from "jose";
import { Pool } from "pg";
import { Queue } from "bullmq";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const TASK = "P1-MANAGED-STAGING-RETAIL-E2-E4-TRACE-20260825";
const APP_SHA = "246fa65949a487e82e4594c0bebb6ecc5a4e53bb";
const ORIGIN = "https://racun-ai-staging-web.onrender.com";
const startedAt = new Date().toISOString();
const suffix = crypto.randomUUID();
const userId = `retail-e2e4-user-${suffix}`;
const email = `retail-e2e4-${suffix}@staging.invalid`;
let productId = null;

for (const key of ["DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"]) {
  if (!process.env[key]) throw new Error(`required managed slot absent: ${key}`);
}
if (process.env.RACUN_DB_RUNTIME !== "postgres") throw new Error("PostgreSQL runtime required");
if (process.env.STORAGE_MODE !== "r2") throw new Error("R2 storage required");
if ((process.env.PAYMENT_GATEWAY ?? "").toLowerCase() !== "duitku") throw new Error("Duitku staging required");
if ((process.env.DUITKU_IS_PRODUCTION ?? "false").toLowerCase() === "true") throw new Error("Duitku production forbidden");
if ((process.env.PAYMENTS_GO_LIVE ?? "false").toLowerCase() === "true") throw new Error("live payments forbidden");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const queue = new Queue(process.env.REDIS_QUEUE_NAME || "racun-jobs", { connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null } });
const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: process.env.R2_REGION || "auto",
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});

const scalar = async (sql, values = []) => Number((await pool.query(sql, values)).rows[0]?.n ?? 0);
const targetSnapshot = async () => ({
  users: await scalar("SELECT count(*) n FROM users WHERE id=$1", [userId]),
  products: await scalar("SELECT count(*) n FROM products WHERE user_id=$1", [userId]),
  scripts: await scalar("SELECT count(*) n FROM scripts s JOIN products p ON p.id=s.product_id WHERE p.user_id=$1", [userId]),
  jobs: await scalar("SELECT count(*) n FROM jobs WHERE user_id=$1", [userId]),
  provider_tasks: await scalar("SELECT count(*) n FROM provider_tasks pt JOIN jobs j ON j.id=pt.job_id WHERE j.user_id=$1", [userId]),
  ledger: await scalar("SELECT count(*) n FROM credit_ledger WHERE user_id=$1", [userId]),
  payments: await scalar("SELECT count(*) n FROM payments WHERE user_id=$1", [userId]),
  audits: await scalar("SELECT count(*) n FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]),
});
const optionalFinancialTables = async () => {
  const result = {};
  for (const table of ["invoices", "refunds", "settlements"]) {
    const exists = Boolean((await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`])).rows[0]?.present);
    if (!exists) { result[table] = { exists: false, target_rows: 0 }; continue; }
    const hasUser = Boolean((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='user_id'", [table])).rowCount);
    result[table] = { exists: true, target_rows: hasUser ? await scalar(`SELECT count(*) n FROM ${table} WHERE user_id=$1`, [userId]) : 0, identity_column_present: hasUser };
  }
  return result;
};
const queueSnapshot = async () => {
  const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "failed", "completed", "paused");
  const jobs = await queue.getJobs(["wait", "active", "delayed", "prioritized", "failed"], 0, 499, true);
  return { counts, task_identity_jobs: jobs.filter((job) => String(job.data?.userId ?? "") === userId).length };
};
const listObjects = async () => {
  if (!productId) return [];
  const out = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: `uploads/${productId}/`, ContinuationToken: token }));
    out.push(...(page.Contents ?? []).map((item) => item.Key).filter(Boolean));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
};
const getBytes = async (key) => {
  const object = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  return Buffer.from(await object.Body.transformToByteArray());
};
const makePng = async (label) => {
  const text = label
    ? `<text x="540" y="465" text-anchor="middle" font-family="Arial" font-size="42" font-weight="bold" fill="#222">${label} SERUM</text><text x="540" y="525" text-anchor="middle" font-family="Arial" font-size="30" fill="#333">SKINCARE</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#e9e2d7"/><ellipse cx="540" cy="920" rx="250" ry="45" fill="#c8bfb2"/><rect x="330" y="130" width="420" height="760" rx="100" fill="#f8f3ea" stroke="#625c55" stroke-width="8"/><rect x="440" y="60" width="200" height="140" rx="24" fill="#999188"/>${text}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};
const requestJson = async (token, path, init) => {
  const response = await fetch(`${ORIGIN}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: `racun_token=${encodeURIComponent(token)}`, "user-agent": `${TASK}/1` } });
  const raw = await response.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { body = { unparseable: true }; }
  return { status: response.status, body };
};
const addPhoto = async (token, bytes, filename) => {
  const form = new FormData();
  form.append("photos", new Blob([bytes], { type: "image/png" }), filename);
  return requestJson(token, `/api/products/${productId}/photos`, { method: "POST", body: form });
};

const receipt = {
  schema: "managed-retail-e2-e4-trace/v1",
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
  requested_endpoints: [], forbidden_endpoints_called: [], payment_url_opened: false, generation_provider_called: false,
  e2: null, fixture_e1: null, e4_positive: null, counterexamples: {}, before: {}, before_cleanup: {}, after_cleanup: {}, cleanup: {}, result: "FAIL",
};

try {
  receipt.before = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: 0 };
  await pool.query("INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES ($1,NULL,$2,$3,'free','id-ID',$4)", [userId, email, "Managed retail E2 E4 trace", startedAt]);
  const token = await new SignJWT({ phone: "" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.AUTH_SECRET));

  // The only controlled public source is this staging service itself. Submit it
  // through E2 normally: the existing marketplace whitelist must reject it
  // before fetch. A positive E2 would require an owned allowed-domain fixture,
  // which this runtime does not have; no public marketplace asset is substituted.
  receipt.requested_endpoints.push("POST /api/products/extract (controlled staging source; expected whitelist rejection)");
  const e2 = await requestJson(token, "/api/products/extract", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: `${ORIGIN}/api/health` }) });
  const afterE2Products = await scalar("SELECT count(*) n FROM products WHERE user_id=$1", [userId]);
  const afterE2Objects = await listObjects();
  receipt.e2 = {
    positive_executed: false,
    controlled_source_provenance: "same managed staging origin and health path",
    http: e2.status,
    extracted: e2.body.extracted ?? null,
    reason: e2.body.reason ?? null,
    ssrf_whitelist_bypassed: false,
    postgres_products_created: afterE2Products,
    r2_objects_created: afterE2Objects.length,
    blocker: "No deterministic source is controlled under the accepted marketplace whitelist (tiktok.com, shopee.co.id, tokopedia.com, shp.ee). Using a third-party marketplace asset would be untrusted; adding a host or bypassing validation is forbidden.",
  };
  if (e2.status !== 200 || e2.body.extracted !== false || !String(e2.body.reason ?? "").includes("domain di luar whitelist") || afterE2Products !== 0 || afterE2Objects.length !== 0) throw new Error("E2 controlled-source blocker was not preserved fail-closed");

  // Independently safe E4 fixture through the public E1 contract, including a
  // registered brand. This avoids direct DB mutation and gives E4 its existing
  // authoritative brand input.
  receipt.requested_endpoints.push("POST /api/products (E1 fixture setup)");
  const validPng = await makePng("NOVA");
  const fixture = await requestJson(token, "/api/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nova Serum Skincare", brand: "NOVA", price_idr: 12000, category: "beauty", images_base64: [`data:image/png;base64,${validPng.toString("base64")}`] }) });
  if (fixture.status !== 201 || typeof fixture.body.product_id !== "string" || !Array.isArray(fixture.body.images) || fixture.body.images.length !== 1) throw new Error(`E1 fixture failed with HTTP ${fixture.status}`);
  productId = fixture.body.product_id;
  const initialKeys = fixture.body.images.map(String);
  const fixtureRow = (await pool.query("SELECT id,user_id,org_id,name,price_idr,category,images,raw_meta FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
  receipt.fixture_e1 = {
    http: fixture.status,
    exact_owner_retail: fixtureRow?.user_id === userId && fixtureRow?.org_id === null,
    exact_core_fields: fixtureRow?.name === "Nova Serum Skincare" && Number(fixtureRow?.price_idr) === 12000 && fixtureRow?.category === "beauty",
    raw_meta_brand_exact: fixtureRow?.raw_meta === JSON.stringify({ brand: "NOVA" }),
    ordered_images_exact: fixtureRow?.images === JSON.stringify(initialKeys),
  };
  if (!Object.values(receipt.fixture_e1).every(Boolean)) throw new Error("E1 fixture row mismatch");

  receipt.requested_endpoints.push("POST /api/products/:id/photos (valid E4)");
  const positive = await addPhoto(token, validPng, "nova-second.png");
  if (positive.status !== 200 || !Array.isArray(positive.body.images) || positive.body.images.length !== 2) throw new Error(`E4 positive failed with HTTP ${positive.status}`);
  const rowAfterPositive = (await pool.query("SELECT images FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
  const persistedImages = JSON.parse(rowAfterPositive.images);
  const addedKey = positive.body.images[1];
  const object = await getBytes(addedKey);
  const sidecar = JSON.parse((await getBytes(`${addedKey}.meta.json`)).toString("utf8"));
  receipt.e4_positive = {
    http: positive.status,
    api_db_ordered_images_exact: JSON.stringify(positive.body.images) === JSON.stringify(persistedImages),
    initial_identity_preserved: persistedImages[0] === initialKeys[0],
    appended_key_exact: persistedImages[1] === addedKey,
    r2_object_present: true,
    sidecar_present: true,
    sidecar: { jenis: sidecar.jenis, layak_referensi: sidecar.layakReferensi, rasio_area_teks: sidecar.rasioAreaTeks, jumlah_kata: sidecar.jumlahKata, versi_bukti: sidecar.versiBukti, sha256_matches_object: sidecar.sha256 === crypto.createHash("sha256").update(object).digest("hex") },
  };
  if (!receipt.e4_positive.api_db_ordered_images_exact || !receipt.e4_positive.initial_identity_preserved || !receipt.e4_positive.appended_key_exact || receipt.e4_positive.sidecar.jenis !== "product_photo" || receipt.e4_positive.sidecar.layak_referensi !== true || !receipt.e4_positive.sidecar.sha256_matches_object) throw new Error("E4 exact identity/sidecar failed");

  const assertNegativeUnchanged = async (label, response, beforeImages, beforeObjects) => {
    const row = (await pool.query("SELECT images FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
    const objects = (await listObjects()).sort();
    receipt.counterexamples[label] = { http: response.status, code: response.body.code ?? null, retryable: response.body.retryable ?? null, postgres_unchanged: row.images === beforeImages, r2_object_set_unchanged: JSON.stringify(objects) === JSON.stringify([...beforeObjects].sort()) };
  };
  const beforeNegativeImages = rowAfterPositive.images;
  const beforeNegativeObjects = await listObjects();
  receipt.requested_endpoints.push("POST /api/products/:id/photos (brand mismatch E4)");
  await assertNegativeUnchanged("brand_mismatch", await addPhoto(token, await makePng("ORBIT"), "orbit.png"), beforeNegativeImages, beforeNegativeObjects);
  receipt.requested_endpoints.push("POST /api/products/:id/photos (unreadable E4)");
  await assertNegativeUnchanged("label_unreadable", await addPhoto(token, await makePng(null), "blank.png"), beforeNegativeImages, beforeNegativeObjects);
  receipt.counterexamples.classifier_failed = { executed: false, reason: "No deterministic input can force classifier infrastructure failure without mutating the accepted runtime." };
  receipt.counterexamples.evidence_invalid = { executed: false, reason: "The E4 contract creates sidecars internally; forcing missing/corrupt evidence requires direct R2 mutation and was not performed." };
  for (const [name, code] of [["brand_mismatch", "BRAND_MISMATCH"], ["label_unreadable", "LABEL_UNREADABLE"]]) {
    const result = receipt.counterexamples[name];
    if (result.http !== 400 || result.code !== code || !result.postgres_unchanged || !result.r2_object_set_unchanged) throw new Error(`E4 ${code} counterexample failed`);
  }

  await new Promise((resolve) => setTimeout(resolve, 300));
  receipt.before_cleanup = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: (await listObjects()).length };
  const forbidden = receipt.before_cleanup.target;
  if (forbidden.scripts || forbidden.jobs || forbidden.provider_tasks || forbidden.ledger || forbidden.payments) throw new Error("forbidden state detected");
  if (Object.values(receipt.before_cleanup.optional_financial).some((entry) => entry.target_rows !== 0)) throw new Error("optional financial residue detected");
  if (Object.values(receipt.before_cleanup.queue.counts).some((value) => value !== 0) || receipt.before_cleanup.queue.task_identity_jobs !== 0) throw new Error("queue not zero");
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
      await client.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]);
      await client.query("DELETE FROM products WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      await client.query("COMMIT"); receipt.cleanup.database = true;
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pool.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]);
  } catch (error) { receipt.cleanup.database_error = String(error?.message ?? error).slice(0, 300); }
  try { receipt.after_cleanup = { target: await targetSnapshot(), optional_financial: await optionalFinancialTables(), queue: await queueSnapshot(), r2_object_count: (await listObjects()).length }; }
  catch (error) { receipt.after_cleanup_error = String(error?.message ?? error).slice(0, 300); }
  const cleanTarget = Object.values(receipt.after_cleanup.target ?? {}).every((value) => value === 0);
  const cleanFinancial = Object.values(receipt.after_cleanup.optional_financial ?? {}).every((entry) => entry.target_rows === 0);
  const cleanQueue = receipt.after_cleanup.queue?.task_identity_jobs === 0 && Object.values(receipt.after_cleanup.queue?.counts ?? {}).every((value) => value === 0);
  if (receipt.result === "PASS_PENDING_CLEANUP" && receipt.cleanup.media && receipt.cleanup.database && cleanTarget && cleanFinancial && cleanQueue && receipt.after_cleanup.r2_object_count === 0) receipt.result = "PASS";
  else if (receipt.result === "PASS_PENDING_CLEANUP") receipt.result = "FAIL_CLEANUP";
  receipt.finished_at = new Date().toISOString();
  await queue.close().catch(() => {}); await pool.end().catch(() => {});
  console.log(JSON.stringify(receipt));
}
