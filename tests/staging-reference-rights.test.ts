import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
const { setMediaStorageForTests } = await import("../lib/storage");
const {
  STAGING_REFERENCE_RIGHTS_SCHEMA,
  canonicalReferenceRightsJson,
  parseStagingReferenceRightsDeclaration,
  persistStagingReferenceRightsReceipt,
} = await import("../lib/staging-reference-rights");

const actor = "ac8b0a3e-8835-4e64-80e6-2e2cae6198b8";
const sha = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");
const source = Buffer.from("deterministic-internal-source");
const declaration = () => ({
  schema: STAGING_REFERENCE_RIGHTS_SCHEMA,
  source_kind: "internally_created_synthetic",
  creation_tool: "sharp-local/v1",
  deterministic_source_sha256: sha(source), prompt_sha256: sha("prompt"), negative_prompt_sha256: sha("negative"),
  tool_terms_reference: "internal deterministic renderer", tool_terms_sha256: sha("terms"),
  tool_terms_accepted_at: "2026-08-31T00:00:00.000Z",
  no_external_image_inputs: true, no_third_party_logo_or_trade_dress: true, not_official_brand_source: true,
  rights_owner: "HDRV internal QA", rights_scope: "internal_staging_ai_and_derivatives_only",
  publication_permitted: false, term_ends_at: "2027-08-31T00:00:00.000Z", revocation_contact: "Founder/CEO",
});

const values = new Map<string, Buffer>();
setMediaStorageForTests({
  async put(key, body) { values.set(key, Buffer.from(body)); },
  async delete(key) { values.delete(key); },
  async get(key) { const body = values.get(key); return body ? { body, size: body.length } : null; },
  async stat(key) { const body = values.get(key); return body ? { size: body.length } : null; },
  async materialize() { return null; },
});

beforeEach(() => {
  values.clear();
  process.env.STAGING_INTERNAL_REFERENCE_INGESTION = "1";
  process.env.RENDER_SERVICE_ID = "srv-staging";
  process.env.STAGING_INTERNAL_REFERENCE_SERVICE_ID = "srv-staging";
  process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE = "Founder/CEO";
  process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID = actor;
});
after(() => setMediaStorageForTests(undefined));

test("staging receipt fails closed unless service, role, and exact principal are bound", () => {
  process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID = "someone-else";
  assert.throws(() => parseStagingReferenceRightsDeclaration(declaration(), actor), /ACTOR_NOT_AUTHORIZED/);
  process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID = actor;
  process.env.STAGING_INTERNAL_REFERENCE_SERVICE_ID = "another-service";
  assert.throws(() => parseStagingReferenceRightsDeclaration(declaration(), actor), /DISABLED/);
});

test("receipt binds exact source, normalized object, actor, product, scope, and canonical digest", async () => {
  const parsed = parseStagingReferenceRightsDeclaration(declaration(), actor);
  assert.ok(parsed);
  const rel = "uploads/product-jj-glow/0.webp";
  const normalized = Buffer.from("normalized-webp-bytes");
  values.set(rel, normalized);
  const result = await persistStagingReferenceRightsReceipt({
    declaration: parsed, actorId: actor, productId: "product-jj-glow", productName: "JJ GLOW GLUTA PINK BRIGHTENING SOAP",
    productBrand: "JJ GLOW", sourceBytes: source, rel, now: "2026-08-31T01:00:00.000Z",
  });
  assert.equal(result.receipt.actor_principal_id, actor);
  assert.equal(result.receipt.normalized_object.sha256, sha(normalized));
  assert.equal(result.receipt.normalized_object.storage_key, rel);
  assert.equal(result.receipt.publication_permitted, false);
  assert.equal(result.receipt.not_official_brand_source, true);
  const stored = values.get(result.storageKey);
  assert.ok(stored);
  assert.equal(result.sha256, sha(stored));
  assert.equal(stored.toString(), canonicalReferenceRightsJson(result.receipt));
});

test("source digest mismatch cannot emit a receipt", async () => {
  const parsed = parseStagingReferenceRightsDeclaration(declaration(), actor);
  assert.ok(parsed);
  values.set("uploads/p/0.webp", Buffer.from("normalized"));
  await assert.rejects(persistStagingReferenceRightsReceipt({
    declaration: parsed, actorId: actor, productId: "p", productName: "JJ GLOW", productBrand: "JJ GLOW",
    sourceBytes: Buffer.from("different"), rel: "uploads/p/0.webp", now: "2026-08-31T01:00:00.000Z",
  }), /SOURCE_DIGEST_MISMATCH/);
  assert.equal(values.has("uploads/p/0.webp.rights.json"), false);
});
