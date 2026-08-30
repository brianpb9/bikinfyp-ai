import assert from "node:assert/strict";
import test from "node:test";
import {
  JJ_GLOW_PRINCIPAL_ID, JJ_GLOW_PRODUCT_ID, JJ_GLOW_SCRIPT_ID,
  JJ_GLOW_STAGING_WEB_SERVICE_ID,
} from "../lib/staging-jj-glow-exact-admission";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_DEPLOY_ENV = "staging";
process.env.RENDER_SERVICE_ID = JJ_GLOW_STAGING_WEB_SERVICE_ID;
process.env.RACUN_DB_RUNTIME = "sqlite";
process.env.JOB_INTAKE_MODE = "open";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.DB_PATH = `/tmp/racun-test-jj-glow-endpoint-${process.pid}.db`;

const { getDb, now } = await import("../lib/db");
const { issueToken } = await import("../lib/auth");
const { POST: createJob } = await import("../app/api/jobs/route");
const db = getDb();
const phone = "081234567890";
db.prepare("INSERT INTO users (id,phone,email,name,tier,locale,created_at) VALUES (?,?,?,'Brian','free','id',?)")
  .run(JJ_GLOW_PRINCIPAL_ID, phone, "brianpb9@gmail.com", now());
db.prepare("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?,?,1,'beauty','[]',?)")
  .run(JJ_GLOW_PRODUCT_ID, JJ_GLOW_PRINCIPAL_ID, "JJ GLOW GLUTA PINK BRIGHTENING SOAP", now());
db.prepare(`INSERT INTO scripts
  (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,edited_by_user,created_at)
  VALUES (?,NULL,?,'H1','senang','bestie','[]','','[]','{}','high_quality',?,0,?)`)
  .run(JJ_GLOW_SCRIPT_ID, JJ_GLOW_PRODUCT_ID, now(), now());
const token = await issueToken(JJ_GLOW_PRINCIPAL_ID, phone);

test("endpoint menolak digest exact candidate yang hilang/kosong/malformed sebelum mutation", async () => {
  const before = {
    jobs: (db.prepare("SELECT count(*) n FROM jobs").get() as { n:number }).n,
    holds: (db.prepare("SELECT count(*) n FROM credit_ledger WHERE type='hold'").get() as { n:number }).n,
    personas: (db.prepare("SELECT count(*) n FROM personas").get() as { n:number }).n,
  };
  for (const [label, digest] of [["missing", undefined], ["empty", ""], ["malformed", { sha: "wrong" }], ["mismatch", "0".repeat(64)]] as const) {
    const body: Record<string, unknown> = { script_id: JJ_GLOW_SCRIPT_ID, creator_category: "lokal", format: "hands_only",
      quality_tier: "high_quality", duration_s: 15 };
    if (digest !== undefined) body.expected_product_state_sha256 = digest;
    const response = await createJob(new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `racun_token=${encodeURIComponent(token)}` },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400, label);
    assert.equal((await response.json()).code, "BAD_REQUEST", label);
  }
  assert.deepEqual({
    jobs: (db.prepare("SELECT count(*) n FROM jobs").get() as { n:number }).n,
    holds: (db.prepare("SELECT count(*) n FROM credit_ledger WHERE type='hold'").get() as { n:number }).n,
    personas: (db.prepare("SELECT count(*) n FROM personas").get() as { n:number }).n,
  }, before);
});
