import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizedStagingCandidateLineageRead,
  buildStagingCandidateLineageReceipt,
  JJ_LINEAGE_HEADER,
  JJ_LINEAGE_SERVICE_ID,
  JJ_PRODUCT_ID,
  JJ_REFERENCE_SHA,
  JJ_RIGHTS_RECEIPT_SHA,
  JJ_SCRIPT_ID,
  stagingCandidateLineageHeader,
} from "../lib/staging-candidate-lineage";

const secret = "0123456789abcdef0123456789abcdef";
const sha = "a".repeat(40);
const now = 1_800_000_000_000;
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging", RENDER_SERVICE_ID: JJ_LINEAGE_SERVICE_ID, RENDER_GIT_COMMIT: sha, AUTH_SECRET: secret };

describe("staging candidate lineage evidence", () => {
  it("accepts only a short-lived exact-SHA HMAC header", () => {
    const value = stagingCandidateLineageHeader(secret, sha, { nowMs: now, nonce: "1".repeat(32) });
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: value } }), env, now + 1), true);
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: `${value.slice(0, -1)}0` } }), env, now + 1), false);
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: value } }), { ...env, RACUN_DEPLOY_ENV: "production" }, now + 1), false);
  });

  it("projects only sanitized, lineage-bound fields and deterministic digests", () => {
    const referenceKey = `uploads/${JJ_PRODUCT_ID}/reference.webp`;
    const receiptKey = `${referenceKey}.rights.json`;
    const row = {
      id: "job-row-id", persona_id: "persona-row-id", product_id: JJ_PRODUCT_ID, script_id: JJ_SCRIPT_ID,
      state: "QUEUED", creator_category: "lokal", provider_video: null, provider_voice: null, output_url: null,
      provider_task_count: 0, hold_count: 1, product_job_count: 1, product_script_count: 1,
      approved_reference_manifest: { version: 2, references: [{ sha256: JJ_REFERENCE_SHA }] },
      job_product_snapshot: { version: 4, productName: "JJ GLOW" }, images: [referenceKey],
      raw_meta: { staging_reference_rights: { reference_key: referenceKey, receipt_key: receiptKey, reference_sha256: JJ_REFERENCE_SHA, receipt_sha256: JJ_RIGHTS_RECEIPT_SHA, publication_permitted: false } },
    };
    const receipt = buildStagingCandidateLineageReceipt(row, "2026-08-31T00:00:00.000Z", sha);
    assert.deepEqual(receipt.lineage, { job_id: "job-row-id", persona_id: "persona-row-id", subject_id: "persona-row-id", product_id: JJ_PRODUCT_ID, script_id: JJ_SCRIPT_ID });
    assert.equal(receipt.frozen_runtime.state, "QUEUED");
    assert.equal(receipt.frozen_runtime.provider_task_count, 0);
    assert.equal(receipt.frozen_runtime.worker_required_suspended, true);
    assert.doesNotMatch(JSON.stringify(receipt), /email|secret|DATABASE_URL/i);
    assert.match(receipt.receipt_payload_sha256, /^[0-9a-f]{64}$/);
  });
});
