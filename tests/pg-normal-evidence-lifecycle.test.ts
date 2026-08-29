/** Real PostgreSQL integration for private evidence accounting. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";
import type { NormalEvidenceOfflineQcReceipt } from "../lib/media/normal-evidence-offline-qc";

const url = process.env.UJI_PG_URL ?? "";
const skip = !url;
if (!skip) {
  process.env.DATABASE_URL = url;
  process.env.RACUN_NO_DOTENV = "1";
}
const pool = skip ? null : new Pool({ connectionString: url });
const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const offlineReceipt = (artifactSha256: string): NormalEvidenceOfflineQcReceipt => ({
  passed: false, checked_at: now(), artifact_sha256: artifactSha256,
  evaluator: { identity: "bikinfyp.normal-evidence.offline-media-receipt", version: "1.0.0", network: "forbidden" },
  disposition: "INDEPENDENT_REVIEW_REQUIRED", frame_findings: [],
  audio_finding: { stream_present: true, mean_db: -20, max_db: -3, local_probe: true },
  checks: [
    { code: "EVIDENCE-BRAND", name: "Brand fidelity", status: "skip", detail: "INDEPENDENT_REVIEW_REQUIRED" },
    { code: "EVIDENCE-ANTI-SLOP", name: "Visual anti-slop", status: "skip", detail: "INDEPENDENT_REVIEW_REQUIRED" },
  ],
});

after(async () => {
  await pool?.end();
  if (!skip) await (await import("../lib/postgres/pool")).closePool?.();
});

test("CAPTURED_NO_PUBLICATION releases hold and terminalizes job without output/capture", { skip }, async () => {
  const userId = id(), productId = id(), scriptId = id(), jobId = id(), t = now();
  await pool!.query("INSERT INTO users (id,email,created_at) VALUES ($1,$2,$3)", [userId, `evidence-${userId}@example.test`, t]);
  await pool!.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Evidence Product',12000,'skincare','[]',$3)", [productId, userId, t]);
  await pool!.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','joy','casual','[]','c','[]','{}',$3)", [scriptId, productId, t]);
  await pool!.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'talking_head','high_quality',15,'QC_CHECK',$5,$5)", [jobId, userId, productId, scriptId, t]);
  await pool!.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)", [id(), userId, jobId, t]);
  await pool!.query(`INSERT INTO normal_representative_evidence_runs
    (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
     reference_brand,authorization_source,product_snapshot_sha256,deploy_sha,model,category,format,duration_s,
     resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,payload_sha256,provider_task_id,
     provider_usage_json,actual_cost_usd,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'subject',$6,$7,'Brand','approved_reference_manifest:v2',$8,$9,
      'dreamina-seedance-2-0-mini-260615','skincare','talking_head',15,'720p',1.134,1.25,1,
      'PROVIDER_SUCCEEDED',$10,'provider-task','{"completion_tokens":324000}',1.134,$11,$11)`,
    [`NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829-${jobId}`, digest(`capture:${jobId}`), jobId, userId, productId,
      "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(40), "6".repeat(64), t]);

  const { pgNormalEvidenceStore } = await import("../lib/postgres/normal-evidence");
  await pgNormalEvidenceStore.captureNoPublication(jobId, {
    taskId: "provider-task", artifactKey: `private/evidence/test/${jobId}.mp4`, artifactSha256: "7".repeat(64),
    qc: offlineReceipt("7".repeat(64)), correlation: { job_id: jobId, publication: false },
  });

  const job = (await pool!.query("SELECT state,output_url,completed_at FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(job.state, "REFUNDED"); assert.equal(job.output_url, null); assert.ok(job.completed_at);
  const ledger = (await pool!.query("SELECT type,delta FROM credit_ledger WHERE job_id=$1 ORDER BY created_at,id", [jobId])).rows;
  assert.deepEqual(ledger.map((x) => x.type).sort(), ["hold", "release"]);
  assert.equal(ledger.reduce((sum, x) => sum + Number(x.delta), 0), 0);
  assert.equal((await pool!.query("SELECT COUNT(*)::int n FROM outputs WHERE job_id=$1", [jobId])).rows[0].n, 0);
  const evidence = (await pool!.query("SELECT state,artifact_key,redaction_verified FROM normal_representative_evidence_runs WHERE job_id=$1", [jobId])).rows[0];
  assert.equal(evidence.state, "CAPTURED_NO_PUBLICATION"); assert.match(evidence.artifact_key, /^private\/evidence\//);
  assert.equal(evidence.redaction_verified, false, "offline capture cannot claim independent redaction verification");
  await assert.rejects(
    pool!.query("UPDATE normal_representative_evidence_runs SET redaction_verified=TRUE WHERE job_id=$1", [jobId]),
    /normal_evidence_redaction_verification_attested/,
    "migrated schema must reject an un-attested verified claim",
  );
  await assert.rejects(
    pool!.query(
      `UPDATE normal_representative_evidence_runs
          SET redaction_attestation_json=$2,redaction_attested_artifact_sha256=NULL,redaction_verified=TRUE
        WHERE job_id=$1`,
      [jobId, JSON.stringify({ reviewer: "independent-row-reviewer", verdict: "redaction_verified" })],
    ),
    /normal_evidence_redaction_verification_attested/,
    "non-empty attestation with a NULL attested digest must not exploit SQL CHECK three-valued logic",
  );
  await pool!.query(
    `UPDATE normal_representative_evidence_runs
        SET redaction_attestation_json=$2,redaction_attested_artifact_sha256=retrieval_sha256,redaction_verified=TRUE
      WHERE job_id=$1`,
    [jobId, JSON.stringify({ reviewer: "independent-row-reviewer", verdict: "redaction_verified", artifact_sha256: "7".repeat(64) })],
  );
  const attested = (await pool!.query(
    "SELECT redaction_verified,redaction_attested_artifact_sha256=retrieval_sha256 AS digest_bound FROM normal_representative_evidence_runs WHERE job_id=$1",
    [jobId],
  )).rows[0];
  assert.equal(attested.redaction_verified, true);
  assert.equal(attested.digest_bound, true);
});

test("STOP_NO_RETRY settlement releases hold and atomically terminalizes REFUNDED", { skip }, async () => {
  const userId = id(), productId = id(), scriptId = id(), jobId = id(), t = now();
  await pool!.query("INSERT INTO users (id,email,created_at) VALUES ($1,$2,$3)", [userId, `evidence-stop-${userId}@example.test`, t]);
  await pool!.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Stopped Evidence Product',12000,'skincare','[]',$3)", [productId, userId, t]);
  await pool!.query("INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','joy','casual','[]','c','[]','{}',$3)", [scriptId, productId, t]);
  await pool!.query("INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'talking_head','high_quality',15,'GENERATING_VISUAL',$5,$5)", [jobId, userId, productId, scriptId, t]);
  await pool!.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)", [id(), userId, jobId, t]);
  await pool!.query(`INSERT INTO normal_representative_evidence_runs
    (task_id,idempotency_key,job_id,user_id,product_id,subject_id,reference_sha256,reference_manifest_sha256,
     reference_brand,authorization_source,product_snapshot_sha256,deploy_sha,model,category,format,duration_s,
     resolution,estimated_cost_usd,max_cost_usd,provider_post_count,state,payload_sha256,stop_reason,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'subject',$6,$7,'Brand','approved_reference_manifest:v2',$8,$9,
      'dreamina-seedance-2-0-mini-260615','skincare','talking_head',15,'720p',1.134,1.25,1,
      'STOP_NO_RETRY',$10,'AMBIGUOUS_POST_WITHOUT_TASK',$11,$11)`,
    [`NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829-STOP-${jobId}`, digest(`stop:${jobId}`), jobId, userId, productId,
      "2".repeat(64), "3".repeat(64), "4".repeat(64), "5".repeat(40), "6".repeat(64), t]);
  const { pgNormalEvidenceStore } = await import("../lib/postgres/normal-evidence");
  await pgNormalEvidenceStore.settleStopNoRetry(jobId);
  const job = (await pool!.query("SELECT state,output_url,completed_at FROM jobs WHERE id=$1", [jobId])).rows[0];
  assert.equal(job.state, "REFUNDED"); assert.equal(job.output_url, null); assert.ok(job.completed_at);
  const ledger = (await pool!.query("SELECT type,delta FROM credit_ledger WHERE job_id=$1 ORDER BY created_at,id", [jobId])).rows;
  assert.deepEqual(ledger.map((x) => x.type).sort(), ["hold", "release"]);
  assert.equal(ledger.reduce((sum, x) => sum + Number(x.delta), 0), 0);
  assert.equal((await pool!.query("SELECT COUNT(*)::int n FROM outputs WHERE job_id=$1", [jobId])).rows[0].n, 0);
});
