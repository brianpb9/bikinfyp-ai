import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseDeterministicFixtureAdmission } from "../lib/postgres/worker";

const manifest = JSON.stringify({
  version: 1,
  references: [{
    rel: "products/trace/source.svg",
    sha256: "a".repeat(64),
    versiBukti: 1,
    snapshotRel: `jobs/${"b".repeat(36)}/approved-references/0-${"a".repeat(64)}.svg`,
  }],
});
const snapshot = JSON.stringify({
  version: 2,
  productName: "NOVA Serum",
  category: "beauty",
  priceIdr: 13000,
  trustedBrand: { source: "products.raw_meta.brand", value: "NOVA" },
  productVisualDesc: "Botol serum NOVA",
  brandBrief: null,
  claims: [],
});

test("deterministic worker accepts canonical immutable admission values", () => {
  const parsed = parseDeterministicFixtureAdmission({ approved_reference_manifest: manifest, job_product_snapshot: snapshot });
  assert.equal(parsed.manifest.references[0].sha256, "a".repeat(64));
  assert.equal(parsed.productSnapshot.productName, "NOVA Serum");
});

test("deterministic worker rejects tampered manifest and snapshot shapes", () => {
  const tamperedManifest = JSON.stringify({ ...JSON.parse(manifest), references: [{ ...JSON.parse(manifest).references[0], sha256: "tampered" }] });
  const tamperedSnapshot = JSON.stringify({ ...JSON.parse(snapshot), trustedBrand: { source: "untrusted", value: "NOVA" } });
  assert.throws(
    () => parseDeterministicFixtureAdmission({ approved_reference_manifest: tamperedManifest, job_product_snapshot: snapshot }),
    /REF_MANIFEST_INVALID/,
  );
  assert.throws(
    () => parseDeterministicFixtureAdmission({ approved_reference_manifest: manifest, job_product_snapshot: tamperedSnapshot }),
    /PRODUCT_SNAPSHOT_INVALID/,
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
