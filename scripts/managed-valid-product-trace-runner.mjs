#!/usr/bin/env node

// Staging-only one-off runner for P1-MANAGED-STAGING-VALID-PRODUCT-TRACE-20260825.
// The command is executed from the already-deployed web image by passing these
// exact bytes as base64 to `node -e`. It never prints credentials or JWTs.

import crypto from "node:crypto";
import sharp from "sharp";
import { SignJWT } from "jose";
import { Pool } from "pg";
import { Queue } from "bullmq";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const TASK = "P1-MANAGED-STAGING-VALID-PRODUCT-TRACE-20260825";
const APP_SHA = "246fa65949a487e82e4594c0bebb6ecc5a4e53bb";
const origin = "https://racun-ai-staging-web.onrender.com";
const startedAt = new Date().toISOString();
const suffix = crypto.randomUUID();
const userId = `trace-user-${suffix}`;
const email = `trace-${suffix}@staging.invalid`;
const cookieName = "racun_token";
const imageKeys = [];

const required = [
  "DATABASE_URL", "AUTH_SECRET", "R2_ENDPOINT", "R2_BUCKET",
  "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "REDIS_URL",
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`required managed slot absent: ${key}`);
}
if (process.env.RACUN_DB_RUNTIME !== "postgres") throw new Error("staging PostgreSQL runtime required");
if (process.env.STORAGE_MODE !== "r2") throw new Error("staging R2 storage required");
if ((process.env.PAYMENT_GATEWAY ?? "").toLowerCase() !== "duitku") throw new Error("Duitku staging required");
if ((process.env.DUITKU_IS_PRODUCTION ?? "false").toLowerCase() === "true") throw new Error("Duitku production forbidden");
if ((process.env.PAYMENTS_GO_LIVE ?? "false").toLowerCase() === "true") throw new Error("payments live forbidden");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const s3 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: process.env.R2_REGION || "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
const queue = new Queue(process.env.REDIS_QUEUE_NAME || "racun-jobs", {
  connection: { url: process.env.REDIS_URL, maxRetriesPerRequest: null },
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
  audits: await scalar("SELECT count(*) n FROM audit_log WHERE actor=$1", [userId]),
});
const queueSnapshot = async () => {
  const counts = await queue.getJobCounts("wait", "active", "delayed", "prioritized", "failed", "completed", "paused");
  const jobs = await queue.getJobs(["wait", "active", "delayed", "prioritized", "failed"], 0, 499, true);
  return {
    counts,
    task_identity_jobs: jobs.filter((job) => String(job.data?.jobId ?? "").startsWith("trace-job-")).length,
  };
};
const makePng = async (withLabel) => {
  const label = withLabel
    ? '<text x="540" y="465" text-anchor="middle" font-family="Arial" font-size="42" font-weight="bold" fill="#222">NOVA SERUM</text><text x="540" y="525" text-anchor="middle" font-family="Arial" font-size="30" fill="#333">SKINCARE</text>'
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#e9e2d7"/><ellipse cx="540" cy="920" rx="250" ry="45" fill="#c8bfb2"/><rect x="330" y="130" width="420" height="760" rx="100" fill="#f8f3ea" stroke="#625c55" stroke-width="8"/><rect x="440" y="60" width="200" height="140" rx="24" fill="#999188"/>${label}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};
const postProduct = async (token, input) => {
  const response = await fetch(`${origin}/api/products`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${cookieName}=${encodeURIComponent(token)}`,
      "user-agent": `${TASK}/1`,
    },
    body: JSON.stringify(input),
  });
  const raw = await response.text();
  let body = {};
  try { body = JSON.parse(raw); } catch { body = { unparsable: true }; }
  return { response, body };
};
const headExists = async (key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return false;
    throw error;
  }
};
const getBytes = async (key) => {
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
};

const receipt = {
  schema: "managed-valid-product-trace/v1",
  task: TASK,
  started_at: startedAt,
  deployed_app_sha_expected: APP_SHA,
  execution: "MANAGED_STAGING_ONE_OFF_PLUS_PUBLIC_HTTP",
  preconditions: {
    node_env_production: process.env.NODE_ENV === "production",
    postgres_runtime: process.env.RACUN_DB_RUNTIME === "postgres",
    storage_mode_r2: process.env.STORAGE_MODE === "r2",
    r2_slots_present: true,
    queue_mode: process.env.RACUN_QUEUE_MODE,
    payment_gateway: "duitku",
    duitku_production: false,
    payments_go_live: false,
    credential_values_or_digests_recorded: false,
  },
  requested_endpoints: ["POST /api/products (valid)", "POST /api/products (brand mismatch)", "POST /api/products (unreadable label)"],
  forbidden_endpoints_called: [],
  payment_url_opened: false,
  generation_provider_called: false,
  positive: null,
  counterexamples: {},
  admission_boundary: {
    executed: false,
    reason: "PostgreSQL retail admission checks balance before prepareAdmissionReferenceManifest; zero balance cannot reach Product Truth, while sufficient balance would create a hold and enqueue. The task forbids both.",
    policy_weakened: false,
  },
  before: {},
  before_cleanup: {},
  after_cleanup: {},
  cleanup: { database: false, media: false },
  result: "FAIL",
};

let positiveProductId = null;
try {
  receipt.before = { target: await targetSnapshot(), queue: await queueSnapshot() };
  await pool.query(
    "INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES ($1,NULL,$2,$3,'free','id-ID',$4)",
    [userId, email, "Managed staging trace", startedAt],
  );
  const token = await new SignJWT({ phone: "" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
  const validPng = await makePng(true);
  const blankPng = await makePng(false);
  const data = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;

  const positive = await postProduct(token, {
    name: "Nova Serum Skincare",
    brand: "NOVA",
    price_idr: 12000,
    category: "beauty",
    images_base64: [data(validPng)],
  });
  if (positive.response.status !== 201 || typeof positive.body.product_id !== "string" || !Array.isArray(positive.body.images)) {
    throw new Error(`positive product route failed with HTTP ${positive.response.status}`);
  }
  positiveProductId = positive.body.product_id;
  imageKeys.push(...positive.body.images.map(String));
  const product = (await pool.query(
    "SELECT id,user_id,name,price_idr,category,images,raw_meta FROM products WHERE id=$1 AND user_id=$2",
    [positiveProductId, userId],
  )).rows[0];
  if (!product) throw new Error("positive product row missing");
  const key = imageKeys[0];
  const object = await getBytes(key);
  const sidecarBytes = await getBytes(`${key}.meta.json`);
  const sidecar = JSON.parse(sidecarBytes.toString("utf8"));
  receipt.positive = {
    http: positive.response.status,
    product_row_exact_owner: product.user_id === userId,
    product_id_matches: product.id === positiveProductId,
    product_fields_match: product.name === "Nova Serum Skincare" && Number(product.price_idr) === 12000 && product.category === "beauty",
    image_count: JSON.parse(product.images).length,
    image_object_present: true,
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

  const brandMismatch = await postProduct(token, {
    name: "Nova Serum Skincare",
    brand: "ORBIT",
    price_idr: 12000,
    category: "beauty",
    images_base64: [data(validPng)],
  });
  receipt.counterexamples.brand_mismatch = {
    http: brandMismatch.response.status,
    code: brandMismatch.body.code ?? null,
    retryable: brandMismatch.body.retryable ?? null,
  };

  const unreadable = await postProduct(token, {
    name: "Nova Serum Skincare",
    brand: "NOVA",
    price_idr: 12000,
    category: "beauty",
    images_base64: [data(blankPng)],
  });
  receipt.counterexamples.label_unreadable = {
    http: unreadable.response.status,
    code: unreadable.body.code ?? null,
    retryable: unreadable.body.retryable ?? null,
  };
  receipt.counterexamples.classifier_failed = {
    executed: false,
    reason: "No deterministic managed input can force classifier infrastructure failure without mutating the accepted runtime; policy/runtime mutation is forbidden.",
  };
  receipt.counterexamples.evidence_invalid = {
    executed: false,
    reason: "The public admission boundary requires a credit-producing path before evidence preparation; corrupting accepted R2 evidence solely to bypass that order would weaken the safe trace and was not done.",
  };

  receipt.before_cleanup = { target: await targetSnapshot(), queue: await queueSnapshot() };
  const safety = receipt.before_cleanup.target;
  if (safety.jobs !== 0 || safety.provider_tasks !== 0 || safety.ledger !== 0 || safety.payments !== 0) {
    throw new Error("forbidden job/provider/ledger/payment state detected");
  }
  if (receipt.counterexamples.brand_mismatch.http !== 400 || receipt.counterexamples.brand_mismatch.code !== "BRAND_MISMATCH") {
    throw new Error("BRAND_MISMATCH counterexample failed");
  }
  if (receipt.counterexamples.label_unreadable.http !== 400 || receipt.counterexamples.label_unreadable.code !== "LABEL_UNREADABLE") {
    throw new Error("LABEL_UNREADABLE counterexample failed");
  }
  if (receipt.positive.sidecar.jenis !== "product_photo" || receipt.positive.sidecar.layak_referensi !== true || !receipt.positive.sidecar.sha256_matches_object) {
    throw new Error("positive Product Truth sidecar failed");
  }
  receipt.result = "PASS_PENDING_CLEANUP";
} catch (error) {
  receipt.error = { name: error?.name ?? "Error", message: String(error?.message ?? error).slice(0, 500) };
} finally {
  try {
    for (const key of imageKeys.flatMap((value) => [value, `${value}.meta.json`])) {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    }
    receipt.cleanup.media = (await Promise.all(imageKeys.flatMap((value) => [value, `${value}.meta.json`]).map(headExists))).every((value) => !value);
  } catch (error) {
    receipt.cleanup.media_error = String(error?.message ?? error).slice(0, 300);
  }
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM audit_log WHERE actor=$1 OR entity_id=$2", [userId, positiveProductId]);
      await client.query("DELETE FROM products WHERE user_id=$1", [userId]);
      await client.query("DELETE FROM users WHERE id=$1", [userId]);
      await client.query("COMMIT");
      receipt.cleanup.database = true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    receipt.cleanup.database_error = String(error?.message ?? error).slice(0, 300);
  }
  try {
    receipt.after_cleanup = { target: await targetSnapshot(), queue: await queueSnapshot() };
  } catch (error) {
    receipt.after_cleanup_error = String(error?.message ?? error).slice(0, 300);
  }
  const afterTarget = receipt.after_cleanup.target ?? {};
  const targetClean = Object.values(afterTarget).every((value) => value === 0);
  const queueClean = receipt.after_cleanup.queue?.task_identity_jobs === 0;
  if (receipt.result === "PASS_PENDING_CLEANUP" && receipt.cleanup.media && receipt.cleanup.database && targetClean && queueClean) {
    receipt.result = "PASS";
  } else if (receipt.result === "PASS_PENDING_CLEANUP") {
    receipt.result = "FAIL_CLEANUP";
  }
  receipt.finished_at = new Date().toISOString();
  await queue.close().catch(() => {});
  await pool.end().catch(() => {});
  console.log(JSON.stringify(receipt));
}
