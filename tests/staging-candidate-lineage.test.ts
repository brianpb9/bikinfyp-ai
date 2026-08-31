import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authorizedStagingCandidateLineageRead,
  buildStagingCandidateLineageReceipt,
  JJ_LINEAGE_HEADER,
  JJ_LINEAGE_SERVICE_ID,
  JJ_PRODUCT_ID,
  JJ_PRINCIPAL_ID,
  JJ_REFERENCE_SHA,
  JJ_RIGHTS_SCOPE,
  JJ_RIGHTS_RECEIPT_SHA,
  JJ_SCRIPT_ID,
  stagingCandidateLineageHeader,
} from "../lib/staging-candidate-lineage";

const secret = "0123456789abcdef0123456789abcdef";
const sha = "a".repeat(40);
const now = 1_800_000_000_000;
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging", RENDER_SERVICE_ID: JJ_LINEAGE_SERVICE_ID, RENDER_GIT_COMMIT: sha, AUTH_SECRET: secret };

function validRow() {
  const referenceKey = `uploads/${JJ_PRODUCT_ID}/9047a662-d664-48f8-9c67-69fc10bc8289.webp`;
  const receiptKey = `${referenceKey}.rights.json`;
  const binding = {
    receipt_key: receiptKey,
    receipt_sha256: JJ_RIGHTS_RECEIPT_SHA,
    reference_key: referenceKey,
    reference_sha256: JJ_REFERENCE_SHA,
    scope: JJ_RIGHTS_SCOPE,
    publication_permitted: false,
  };
  return {
    id: "job-row-id", persona_id: "persona-row-id", product_id: JJ_PRODUCT_ID, script_id: JJ_SCRIPT_ID,
    state: "QUEUED", creator_category: "lokal", provider_video: null, provider_voice: null, output_url: null,
    provider_task_count: 0, hold_count: 1, hold_delta: -12_000, terminal_ledger_count: 0, job_ledger_net: -12_000,
    database_name: "private-staging-db", database_principal: "staging_role",
    database_server_address: "10.0.0.12", database_server_port: 5432,
    product_job_count: 1, product_script_count: 1,
    approved_reference_manifest: {
      version: 2,
      references: [{ rel: referenceKey, sha256: JJ_REFERENCE_SHA }],
      stagingReferenceRights: {
        binding,
        receipt: {
          actor_principal_id: JJ_PRINCIPAL_ID,
          actor_role: "Founder/CEO",
          creation_tool: "HDRV deterministic original SVG rendered locally to PNG",
          deterministic_source_sha256: "acdba045f3f65610015e4cbe240676484b6e1a415ec96a1d664813d3aa4c2d61",
          issued_at: "2026-08-30T23:07:29.998Z",
          negative_prompt_sha256: "cc54f02f255a69eb1b982d388e29a7c40b1bd647ce6621b877971f776be252de",
          no_external_image_inputs: true,
          no_third_party_logo_or_trade_dress: true,
          normalized_object: {
            bytes: 14502,
            mime: "image/webp",
            sha256: JJ_REFERENCE_SHA,
            storage_key: referenceKey,
            version_id: null,
            version_id_status: "UNAVAILABLE_STORAGE_ABSTRACTION",
          },
          not_official_brand_source: true,
          owning_user_id: JJ_PRINCIPAL_ID,
          owning_org_id: null,
          product_brand: "JJ GLOW",
          product_id: JJ_PRODUCT_ID,
          product_name: "JJ GLOW GLUTA PINK BRIGHTENING SOAP",
          prompt_sha256: "1d98afa662578d62c53482555646e6f823d205b2ee25fc9fb658d7d92b5523a3",
          publication_permitted: false,
          receipt_id: "030a1f31-cc60-452d-a1a7-92493122ec5e",
          revocation: { storage_key: `${receiptKey}.revoked.json`, status_at_issuance: "NOT_REVOKED" },
          revocation_contact: "brianpb9@gmail.com",
          rights_owner: "HDRV internal QA",
          rights_scope: JJ_RIGHTS_SCOPE,
          schema: "bikinfyp.staging-reference-rights/v1",
          source_kind: "internally_created_synthetic",
          term_ends_at: "2027-08-31T00:00:00.000Z",
          tool_terms_accepted_at: "2026-08-30T22:00:00.000Z",
          tool_terms_reference: "HDRV internally-created deterministic SVG/PNG QA asset; owned test fixture; no external image-generation provider or third-party input.",
          tool_terms_sha256: "6c4e1548fa550cc92f7db2e220a3393afc8020abd8c5102ff81e8553dea34f76",
          upload_input_sha256: "acdba045f3f65610015e4cbe240676484b6e1a415ec96a1d664813d3aa4c2d61",
        },
      },
    },
    job_product_snapshot: {
      version: 4,
      productName: "JJ GLOW GLUTA PINK BRIGHTENING SOAP",
      category: "beauty",
      categoryReviewVersion: 2,
      priceIdr: 1,
      promoPriceBeforeIdr: null,
      promoEndsAt: null,
      promoStockLeft: null,
      trustedBrand: { source: "products.raw_meta.brand", value: "JJ GLOW" },
      productVisualDesc: "INTERNAL QA fixture. Rp1 is a staging sentinel, not a market-price claim. BPOM NIE NA18260500350 verified active.",
      brandBrief: null,
      claims: [],
    },
    images: [referenceKey],
    raw_meta: { staging_reference_rights: binding },
  };
}

describe("staging candidate lineage evidence", () => {
  it("accepts only a short-lived exact-SHA HMAC header", () => {
    const value = stagingCandidateLineageHeader(secret, sha, { nowMs: now, nonce: "1".repeat(32) });
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: value } }), env, now + 1), true);
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: `${value.slice(0, -1)}0` } }), env, now + 1), false);
    assert.equal(authorizedStagingCandidateLineageRead(new Request("https://example.test", { headers: { [JJ_LINEAGE_HEADER]: value } }), { ...env, RACUN_DEPLOY_ENV: "production" }, now + 1), false);
  });

  it("projects only sanitized, lineage-bound fields and deterministic digests", () => {
    const row = validRow();
    const receipt = buildStagingCandidateLineageReceipt(row, "2026-08-31T00:00:00.000Z", sha);
    assert.deepEqual(receipt.lineage, { job_id: "job-row-id", persona_id: "persona-row-id", subject_id: "persona-row-id", product_id: JJ_PRODUCT_ID, script_id: JJ_SCRIPT_ID });
    assert.equal(receipt.frozen_runtime.state, "QUEUED");
    assert.equal(receipt.frozen_runtime.provider_task_count, 0);
    assert.equal(receipt.frozen_runtime.terminal_ledger_count, 0);
    assert.equal(receipt.frozen_runtime.job_ledger_net, -12_000);
    assert.equal(receipt.frozen_runtime.worker_required_suspended, true);
    assert.match(receipt.control_plane.database_binding_sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(receipt), /email|secret|DATABASE_URL/i);
    assert.doesNotMatch(JSON.stringify(receipt), /private-staging-db|staging_role|10\.0\.0\.12/);
    assert.match(receipt.receipt_payload_sha256, /^[0-9a-f]{64}$/);
  });

  it("rejects incomplete or mutated admission-time lineage", () => {
    const missingRights = structuredClone(validRow());
    delete (missingRights.approved_reference_manifest as Record<string, unknown>).stagingReferenceRights;
    assert.throws(() => buildStagingCandidateLineageReceipt(missingRights, "2026-08-31T00:00:00.000Z", sha));

    const wrongScope = structuredClone(validRow());
    wrongScope.approved_reference_manifest.stagingReferenceRights.binding.scope = "publication";
    assert.throws(() => buildStagingCandidateLineageReceipt(wrongScope, "2026-08-31T00:00:00.000Z", sha));

    const missingReceiptKey = structuredClone(validRow());
    delete (missingReceiptKey.approved_reference_manifest.stagingReferenceRights.binding as Record<string, unknown>).receipt_key;
    assert.throws(() => buildStagingCandidateLineageReceipt(missingReceiptKey, "2026-08-31T00:00:00.000Z", sha));

    const mutatedSnapshot = structuredClone(validRow());
    mutatedSnapshot.job_product_snapshot.priceIdr = 2;
    assert.throws(() => buildStagingCandidateLineageReceipt(mutatedSnapshot, "2026-08-31T00:00:00.000Z", sha));

    const mutatedReceipt = structuredClone(validRow());
    mutatedReceipt.approved_reference_manifest.stagingReferenceRights.receipt.creation_tool = "evil";
    assert.throws(() => buildStagingCandidateLineageReceipt(mutatedReceipt, "2026-08-31T00:00:00.000Z", sha));
  });

  it("rejects candidates whose hold was released or captured", () => {
    const released = structuredClone(validRow());
    released.terminal_ledger_count = 1;
    released.job_ledger_net = 0;
    assert.throws(() => buildStagingCandidateLineageReceipt(released, "2026-08-31T00:00:00.000Z", sha));

    const captured = structuredClone(validRow());
    captured.terminal_ledger_count = 1;
    assert.throws(() => buildStagingCandidateLineageReceipt(captured, "2026-08-31T00:00:00.000Z", sha));

    const extraHolds = structuredClone(validRow());
    extraHolds.hold_count = 3;
    assert.throws(() => buildStagingCandidateLineageReceipt(extraHolds, "2026-08-31T00:00:00.000Z", sha));
  });
});
