import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseDeterministicFixtureAdmission, workerExecutionMode } from "../lib/postgres/worker";

const manifest = JSON.stringify({
  version: 2,
  references: [{
    rel: "products/trace/source.svg",
    sha256: "a".repeat(64),
    versiBukti: 1,
    labelOcrStatus: "READABLE", labelOcrVersion: 1,
    snapshotRel: `jobs/${"b".repeat(36)}/approved-references/0-${"a".repeat(64)}.svg`,
  }],
});
const snapshot = JSON.stringify({
  version: 3,
  productName: "NOVA Serum",
  category: "beauty",
  priceIdr: 13000,
  promoPriceBeforeIdr: null,
  promoEndsAt: null,
  promoStockLeft: null,
  trustedBrand: { source: "products.raw_meta.brand", value: "NOVA" },
  productVisualDesc: "Botol serum NOVA",
  brandBrief: null,
  claims: [],
});
const confirmedType = {
  product_type_token: "serum wajah",
  product_type_confirmed_token: "serum wajah",
  product_type_confirmed_by: "staging-fixture",
  product_type_confirmed_at: "2026-08-27T00:00:00.000Z",
  product_type_version: 1,
  product_type_state: "CONFIRMED",
  category_review_state: "CLEAR",
  category_review_reason: null,
  category_reviewed_by: null,
  category_reviewed_role: null,
  category_reviewed_at: null,
  category_review_version: 1,
};

test("deterministic worker accepts canonical immutable admission values", () => {
  const parsed = parseDeterministicFixtureAdmission({ approved_reference_manifest: manifest, job_product_snapshot: snapshot, ...confirmedType });
  assert.equal(parsed.manifest.references[0].sha256, "a".repeat(64));
  assert.equal(parsed.productSnapshot.productName, "NOVA Serum");
});

test("deterministic worker rejects tampered manifest and snapshot shapes", () => {
  const tamperedManifest = JSON.stringify({ ...JSON.parse(manifest), references: [{ ...JSON.parse(manifest).references[0], sha256: "tampered" }] });
  const tamperedSnapshot = JSON.stringify({ ...JSON.parse(snapshot), trustedBrand: { source: "untrusted", value: "NOVA" } });
  assert.throws(
    () => parseDeterministicFixtureAdmission({ approved_reference_manifest: tamperedManifest, job_product_snapshot: snapshot, ...confirmedType }),
    /REF_MANIFEST_INVALID/,
  );
  assert.throws(
    () => parseDeterministicFixtureAdmission({ approved_reference_manifest: manifest, job_product_snapshot: tamperedSnapshot, ...confirmedType }),
    /PRODUCT_SNAPSHOT_INVALID/,
  );
});

test("deterministic W1 rejects quarantined product type before materialization", () => {
  assert.throws(
    () => parseDeterministicFixtureAdmission({
      approved_reference_manifest: manifest,
      job_product_snapshot: snapshot,
      ...confirmedType,
      product_type_state: "QUARANTINED",
    }),
    (error: unknown) => (error as { body?: { code?: string } }).body?.code === "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
  );
});

test("deterministic branch materializes immutable references before FFmpeg output", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = fs.readFileSync(path.join(here, "../lib/postgres/worker.ts"), "utf8");
  const branch = source.slice(source.indexOf("async function runDeterministicFixture"), source.indexOf("async function runProviderPipeline"));
  const parseAt = branch.indexOf("parseDeterministicFixtureAdmission(row)");
  const materializeAt = branch.indexOf("materializeJobReferenceManifest(admission.manifest");
  const ffmpegAt = branch.indexOf("await runFf(");
  assert.ok(parseAt >= 0 && materializeAt > parseAt && ffmpegAt > materializeAt);
});

test("ledger-less job is rejected unless deterministic worker gate is active", () => {
  assert.throws(() => workerExecutionMode(false, { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging" }), /ZERO_LEDGER_JOB_REQUIRES/);
  assert.equal(workerExecutionMode(true, { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging" }), "provider");
  assert.equal(workerExecutionMode(false, { NODE_ENV: "test", RACUN_WORKER_DETERMINISTIC: "1" }), "deterministic_trace");
});

test("deterministic trace worker rejects held ordinary jobs before fixture or provider", () => {
  assert.throws(
    () => workerExecutionMode(true, { NODE_ENV: "test", RACUN_WORKER_DETERMINISTIC: "1" }),
    /TRACE_WORKER_REJECTS_HELD_ORDINARY_JOB/,
  );
});
