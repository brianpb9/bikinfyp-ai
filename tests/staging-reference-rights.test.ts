import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

process.env.RACUN_NO_DOTENV = "1";
const { setMediaStorageForTests } = await import("../lib/storage");
const {
  STAGING_REFERENCE_RIGHTS_SCHEMA,
  canonicalReferenceRightsJson,
  parseStagingReferenceRightsDeclaration,
  persistStagingReferenceRightsReceipt,
  verifyStagingReferenceRightsBinding,
} = await import("../lib/staging-reference-rights");
const { assertReferencePublicationPermitted, prepareJobReferenceManifest } = await import("../lib/job-reference-manifest");
const { KEBIJAKAN_KLASIFIKASI } = await import("../lib/media/klasifikasi-gambar");

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
  process.env.RACUN_DEPLOY_ENV = "staging";
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

test("matching service IDs remain rejected outside staging", () => {
  process.env.RACUN_DEPLOY_ENV = "production";
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

test("persistence rechecks authoritative issuance chronology after processing", async () => {
  const futureAccepted={...declaration(),tool_terms_accepted_at:"2026-09-01T00:00:00.000Z"};
  const parsed=parseStagingReferenceRightsDeclaration(futureAccepted,actor);
  assert.ok(parsed);
  values.set("uploads/p/time.webp",Buffer.from("normalized"));
  await assert.rejects(persistStagingReferenceRightsReceipt({declaration:parsed,actorId:actor,productId:"p",
    productName:"JJ GLOW",productBrand:"JJ GLOW",sourceBytes:source,rel:"uploads/p/time.webp",
    now:"2026-08-31T01:00:00.000Z"}),/CHRONOLOGY_INVALID/);
  const elapsed=parseStagingReferenceRightsDeclaration({...declaration(),term_ends_at:"2026-08-31T02:00:00.000Z"},actor);
  assert.ok(elapsed);
  await assert.rejects(persistStagingReferenceRightsReceipt({declaration:elapsed,actorId:actor,productId:"p",
    productName:"JJ GLOW",productBrand:"JJ GLOW",sourceBytes:source,rel:"uploads/p/time.webp",
    now:"2026-08-31T02:00:00.000Z"}),/CHRONOLOGY_INVALID/);
});

test("admission manifest binds receipt; missing, tampered, expired and non-publishable states fail closed", async () => {
  const parsed=parseStagingReferenceRightsDeclaration(declaration(),actor);
  assert.ok(parsed);
  const rel="uploads/jj/0.webp",normalized=Buffer.from("normalized-jj");
  values.set(rel,normalized);
  values.set(`${rel}.meta.json`,Buffer.from(JSON.stringify({sha256:sha(normalized),jenis:"product_photo",
    layakReferensi:true,rasioAreaTeks:0,jumlahKata:0,alasan:"fixture",versiBukti:KEBIJAKAN_KLASIFIKASI.versiBukti,
    labelOcrStatus:"READABLE",labelOcrVersion:1})));
  const persisted=await persistStagingReferenceRightsReceipt({declaration:parsed,actorId:actor,productId:"jj",
    productName:"JJ GLOW",productBrand:"JJ GLOW",sourceBytes:source,rel,now:"2026-08-31T01:00:00.000Z"});
  const binding={receipt_key:persisted.storageKey,receipt_sha256:persisted.sha256,reference_key:rel,
    reference_sha256:sha(normalized),scope:"internal_staging_ai_and_derivatives_only" as const,publication_permitted:false as const};
  await assert.rejects(prepareJobReferenceManifest({jobId:"job-jj-unbound",candidateRels:[rel]}),/BINDING_MISSING/);
  const prepared=await prepareJobReferenceManifest({jobId:"job-jj",candidateRels:[rel],stagingReferenceRightsBinding:binding});
  assert.deepEqual(prepared.manifest.stagingReferenceRights?.binding,binding);
  assert.throws(()=>assertReferencePublicationPermitted(prepared.manifest),/PUBLICATION_FORBIDDEN/);
  const receiptBytes=values.get(persisted.storageKey)!;
  values.delete(persisted.storageKey);
  await assert.rejects(verifyStagingReferenceRightsBinding({binding,referenceRel:rel,now:"2026-08-31T01:01:00.000Z"}),/RECEIPT_MISSING/);
  values.set(persisted.storageKey,Buffer.concat([receiptBytes,Buffer.from(" ")]));
  await assert.rejects(verifyStagingReferenceRightsBinding({binding,referenceRel:rel,now:"2026-08-31T01:01:00.000Z"}),/RECEIPT_TAMPERED/);
  values.set(persisted.storageKey,receiptBytes);
  await assert.rejects(verifyStagingReferenceRightsBinding({binding,referenceRel:rel,now:"2027-08-31T00:00:00.000Z"}),/INVALID_OR_EXPIRED/);
  values.set(`${persisted.storageKey}.revoked.json`,Buffer.from("revoked by Founder"));
  await assert.rejects(verifyStagingReferenceRightsBinding({binding,referenceRel:rel,now:"2026-08-31T01:01:00.000Z"}),/RIGHTS_REVOKED/);
});

test("both workers invoke the publication guard before READY transition", () => {
  const sqlite=fs.readFileSync("lib/worker.ts","utf8");
  const postgres=fs.readFileSync("lib/postgres/worker.ts","utf8");
  assert.ok(sqlite.indexOf("assertReferencePublicationPermitted(currentEvidence.manifest)") < sqlite.indexOf('transition(job.id, "READY")'));
  const persist=postgres.slice(postgres.indexOf("async function persistReadyOutput"));
  assert.ok(persist.indexOf("assertReferencePublicationPermitted") < persist.indexOf('jobs.transition(row.id, "READY"'));
});
