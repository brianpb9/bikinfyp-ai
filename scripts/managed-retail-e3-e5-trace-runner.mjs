#!/usr/bin/env node
import crypto from "node:crypto";
import sharp from "sharp";
import { SignJWT } from "jose";
import { Pool } from "pg";
import { Queue } from "bullmq";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

const TASK = "P1-MANAGED-STAGING-RETAIL-E3-E5-MUTATION-TRACE-20260825";
const APP_SHA = "246fa65949a487e82e4594c0bebb6ecc5a4e53bb";
const ORIGIN = "https://racun-ai-staging-web.onrender.com";
const startedAt = new Date().toISOString();
const suffix = crypto.randomUUID();
const userId = `retail-e3e5-user-${suffix}`;
const email = `retail-e3e5-${suffix}@staging.invalid`;
let productId = null;

for (const key of ["DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL"]) if (!process.env[key]) throw new Error(`managed slot absent: ${key}`);
if (process.env.RACUN_DB_RUNTIME !== "postgres" || process.env.STORAGE_MODE !== "r2") throw new Error("managed PostgreSQL/R2 required");
if ((process.env.DUITKU_IS_PRODUCTION ?? "false").toLowerCase() === "true" || (process.env.PAYMENTS_GO_LIVE ?? "false").toLowerCase() === "true") throw new Error("live payments forbidden");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const queue = new Queue(process.env.REDIS_QUEUE_NAME || "racun-jobs", { connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null } });
const s3 = new S3Client({ endpoint: process.env.R2_ENDPOINT, region: process.env.R2_REGION || "auto", credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY }, forcePathStyle: true });
const scalar = async (sql, values = []) => Number((await pool.query(sql, values)).rows[0]?.n ?? 0);
const target = async () => ({
  users: await scalar("SELECT count(*) n FROM users WHERE id=$1", [userId]), products: await scalar("SELECT count(*) n FROM products WHERE user_id=$1", [userId]),
  scripts: await scalar("SELECT count(*) n FROM scripts s JOIN products p ON p.id=s.product_id WHERE p.user_id=$1", [userId]), jobs: await scalar("SELECT count(*) n FROM jobs WHERE user_id=$1", [userId]),
  provider_tasks: await scalar("SELECT count(*) n FROM provider_tasks pt JOIN jobs j ON j.id=pt.job_id WHERE j.user_id=$1", [userId]), ledger: await scalar("SELECT count(*) n FROM credit_ledger WHERE user_id=$1", [userId]),
  payments: await scalar("SELECT count(*) n FROM payments WHERE user_id=$1", [userId]), audits: await scalar("SELECT count(*) n FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]),
});
const financial = async () => {
  const out = {};
  for (const table of ["invoices", "refunds", "settlements"]) {
    const exists = Boolean((await pool.query("SELECT to_regclass($1) IS NOT NULL present", [`public.${table}`])).rows[0]?.present);
    const hasUser = exists && Boolean((await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='user_id'", [table])).rowCount);
    out[table] = { exists, target_rows: hasUser ? await scalar(`SELECT count(*) n FROM ${table} WHERE user_id=$1`, [userId]) : 0 };
  }
  return out;
};
const queueState = async () => {
  const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "failed", "completed", "paused");
  const jobs = await queue.getJobs(["wait", "active", "delayed", "prioritized", "failed"], 0, 499, true);
  return { counts, task_identity_jobs: jobs.filter((job) => String(job.data?.userId ?? "") === userId).length };
};
const objects = async () => {
  if (!productId) return [];
  const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET, Prefix: `uploads/${productId}/` }));
  return (page.Contents ?? []).map((item) => item.Key).filter(Boolean).sort();
};
const exists = async (key) => { try { await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })); return true; } catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return false; throw error; } };
const bytes = async (key) => Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))).Body.transformToByteArray());
const png = async (variant) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="${variant === 1 ? "#e9e2d7" : "#dfe8ed"}"/><rect x="330" y="130" width="420" height="760" rx="100" fill="#f8f3ea" stroke="#625c55" stroke-width="8"/><text x="540" y="465" text-anchor="middle" font-family="Arial" font-size="42" font-weight="bold" fill="#222">NOVA SERUM</text><text x="540" y="525" text-anchor="middle" font-family="Arial" font-size="30" fill="#333">SKINCARE</text></svg>`)).png().toBuffer();
const call = async (token, path, init) => {
  const response = await fetch(`${ORIGIN}${path}`, { ...init, headers: { ...(init.headers ?? {}), cookie: `racun_token=${encodeURIComponent(token)}`, "user-agent": `${TASK}/1` } });
  const raw = await response.text(); let body = {}; try { body = JSON.parse(raw); } catch { body = { unparseable: true }; }
  return { status: response.status, body };
};

const receipt = { schema: "managed-retail-e3-e5-trace/v1", task: TASK, started_at: startedAt, deployed_app_sha_expected: APP_SHA,
  preconditions: { postgres_runtime: true, storage_mode_r2: true, payment_gateway: process.env.PAYMENT_GATEWAY, duitku_production: false, payments_go_live: false, credential_values_or_digests_recorded: false },
  requested_endpoints: [], forbidden_endpoints_called: [], payment_url_opened: false, generation_provider_called: false, fixture: null, e3: null, e5: null, counterexample: null,
  immutable_job_snapshot: { executed: false, reason: "Creating an admitted job would require credits and may hold/enqueue; zero-money/zero-queue constraints forbid it." }, before: {}, before_cleanup: {}, after_cleanup: {}, cleanup: {}, result: "FAIL" };

try {
  receipt.before = { target: await target(), financial: await financial(), queue: await queueState(), r2_objects: 0 };
  await pool.query("INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES ($1,NULL,$2,$3,'free','id-ID',$4)", [userId, email, "Managed retail E3 E5", startedAt]);
  const token = await new SignJWT({ phone: "" }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("15m").sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const p1 = await png(1), p2 = await png(2);
  receipt.requested_endpoints.push("POST /api/products (two-image E1 fixture)");
  const fixture = await call(token, "/api/products", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nova Serum Skincare", brand: "NOVA", price_idr: 12000, category: "beauty", images_base64: [p1, p2].map((b) => `data:image/png;base64,${b.toString("base64")}`) }) });
  if (fixture.status !== 201 || typeof fixture.body.product_id !== "string" || fixture.body.images?.length !== 2) throw new Error(`fixture HTTP ${fixture.status}`);
  productId = fixture.body.product_id;
  const initialImages = fixture.body.images.map(String);
  const initialObjects = await objects();
  receipt.fixture = { http: 201, two_ordered_images: initialImages.length === 2, r2_image_sidecar_pairs: initialObjects.length === 4 };

  receipt.requested_endpoints.push("PATCH /api/products/:id (safe E3 metadata mutation)");
  const patch = await call(token, `/api/products/${productId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Nova Serum Skincare", price_idr: 13000, category: "beauty", product_visual_desc: "Botol serum krem dengan tutup abu-abu." }) });
  const patched = (await pool.query("SELECT name,price_idr,category,product_visual_desc,images,raw_meta FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
  const objectsAfterPatch = await objects();
  receipt.e3 = { http: patch.status, api_exact: patch.body.ok === true && patch.body.name === "Nova Serum Skincare" && Number(patch.body.price_idr) === 13000 && patch.body.category === "beauty",
    postgres_exact: patched?.name === "Nova Serum Skincare" && Number(patched?.price_idr) === 13000 && patched?.category === "beauty" && patched?.product_visual_desc === "Botol serum krem dengan tutup abu-abu.",
    ordered_images_unchanged: patched?.images === JSON.stringify(initialImages), brand_unchanged: patched?.raw_meta === JSON.stringify({ brand: "NOVA" }), r2_object_set_unchanged: JSON.stringify(objectsAfterPatch) === JSON.stringify(initialObjects) };
  if (patch.status !== 200 || !Object.values(receipt.e3).every(Boolean)) throw new Error("E3 mutation mismatch");

  const removed = initialImages[0], retained = initialImages[1];
  const retainedBytes = await bytes(retained); const retainedSidecar = JSON.parse((await bytes(`${retained}.meta.json`)).toString("utf8"));
  receipt.requested_endpoints.push("DELETE /api/products/:id/photos (E5 exact target)");
  const deleted = await call(token, `/api/products/${productId}/photos`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: removed }) });
  const afterDelete = (await pool.query("SELECT images FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
  receipt.e5 = { http: deleted.status, cleanup_failed: deleted.body.cleanup_failed ?? null, api_ordered_remaining_exact: JSON.stringify(deleted.body.images) === JSON.stringify([retained]), postgres_ordered_remaining_exact: afterDelete?.images === JSON.stringify([retained]),
    removed_object_absent: !(await exists(removed)), removed_sidecar_absent: !(await exists(`${removed}.meta.json`)), retained_object_present: await exists(retained), retained_sidecar_present: await exists(`${retained}.meta.json`),
    retained_sidecar_hash_exact: retainedSidecar.sha256 === crypto.createHash("sha256").update(retainedBytes).digest("hex") };
  if (deleted.status !== 200 || deleted.body.cleanup_failed !== false || !Object.entries(receipt.e5).filter(([key]) => !["http", "cleanup_failed"].includes(key)).every(([, value]) => value === true)) throw new Error("E5 deletion mismatch");

  const beforeUnknown = await objects();
  receipt.requested_endpoints.push("DELETE /api/products/:id/photos (unknown target)");
  const unknown = await call(token, `/api/products/${productId}/photos`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: "uploads/not-owned.webp" }) });
  const afterUnknown = (await pool.query("SELECT images FROM products WHERE id=$1 AND user_id=$2", [productId, userId])).rows[0];
  receipt.counterexample = { unknown_target_http: unknown.status, postgres_unchanged: afterUnknown?.images === JSON.stringify([retained]), r2_object_set_unchanged: JSON.stringify(await objects()) === JSON.stringify(beforeUnknown) };
  if (unknown.status !== 404 || !receipt.counterexample.postgres_unchanged || !receipt.counterexample.r2_object_set_unchanged) throw new Error("E5 unknown target did not fail closed");

  await new Promise((resolve) => setTimeout(resolve, 300));
  receipt.before_cleanup = { target: await target(), financial: await financial(), queue: await queueState(), r2_objects: (await objects()).length };
  const t = receipt.before_cleanup.target;
  if (t.scripts || t.jobs || t.provider_tasks || t.ledger || t.payments || Object.values(receipt.before_cleanup.financial).some((x) => x.target_rows) || Object.values(receipt.before_cleanup.queue.counts).some((x) => x) || receipt.before_cleanup.queue.task_identity_jobs) throw new Error("forbidden residue");
  receipt.result = "PASS_PENDING_CLEANUP";
} catch (error) { receipt.error = { name: error?.name ?? "Error", message: String(error?.message ?? error).slice(0, 500) }; }
finally {
  try { for (const key of await objects()) await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })); receipt.cleanup.media = (await objects()).length === 0; } catch (error) { receipt.cleanup.media_error = String(error?.message ?? error).slice(0, 300); }
  try { const c = await pool.connect(); try { await c.query("BEGIN"); await c.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]); await c.query("DELETE FROM products WHERE user_id=$1", [userId]); await c.query("DELETE FROM users WHERE id=$1", [userId]); await c.query("COMMIT"); receipt.cleanup.database = true; } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); } await new Promise((r) => setTimeout(r, 300)); await pool.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, productId]); } catch (error) { receipt.cleanup.database_error = String(error?.message ?? error).slice(0, 300); }
  try { receipt.after_cleanup = { target: await target(), financial: await financial(), queue: await queueState(), r2_objects: (await objects()).length }; } catch (error) { receipt.after_cleanup_error = String(error?.message ?? error).slice(0, 300); }
  const clean = Object.values(receipt.after_cleanup.target ?? {}).every((x) => x === 0) && Object.values(receipt.after_cleanup.financial ?? {}).every((x) => x.target_rows === 0) && Object.values(receipt.after_cleanup.queue?.counts ?? {}).every((x) => x === 0) && receipt.after_cleanup.queue?.task_identity_jobs === 0 && receipt.after_cleanup.r2_objects === 0;
  if (receipt.result === "PASS_PENDING_CLEANUP" && receipt.cleanup.media && receipt.cleanup.database && clean) receipt.result = "PASS"; else if (receipt.result === "PASS_PENDING_CLEANUP") receipt.result = "FAIL_CLEANUP";
  receipt.finished_at = new Date().toISOString(); await queue.close().catch(() => {}); await pool.end().catch(() => {}); console.log(JSON.stringify(receipt));
}
