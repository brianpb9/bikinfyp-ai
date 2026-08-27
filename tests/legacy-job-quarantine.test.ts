import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  classifyLegacyJobEvidence,
  LEGACY_PRODUCT_REASON,
  LEGACY_REFERENCE_REASON,
  requireCurrentJobEvidence,
  type LegacyJobQuarantineReason,
} from "../lib/legacy-job-quarantine";
import { createJobProductSnapshotRaw } from "../lib/job-product-snapshot";
import { UnsafeLegacyReferenceSnapshot } from "../lib/job-reference-manifest";
import { UnsafeLegacyProductSnapshot } from "../lib/job-product-snapshot";

const manifest = JSON.stringify({
  version: 2,
  references: [{
    rel: "uploads/current.webp",
    sha256: "a".repeat(64),
    versiBukti: 1,
    labelOcrStatus: "READABLE",
    labelOcrVersion: 1,
    snapshotRel: `jobs/current/approved-references/0-${"a".repeat(64)}.webp`,
  }],
});
const snapshot = createJobProductSnapshotRaw({
  name: "Serum Current",
  category: "beauty",
  price_idr: 89_000,
  promo_price_before_idr: null,
  promo_ends_at: null,
  promo_stock_left: null,
});
const confirmedType = {
  product_type_token: "serum wajah",
  product_type_confirmed_token: "serum wajah",
  product_type_confirmed_by: "user-1",
  product_type_confirmed_at: "2026-08-27T00:00:00.000Z",
  product_type_version: 1,
  product_type_state: "CONFIRMED",
};

function reason(input: Parameters<typeof classifyLegacyJobEvidence>[0]): LegacyJobQuarantineReason | "CURRENT" {
  const result = classifyLegacyJobEvidence(input);
  return result.status === "CURRENT" ? "CURRENT" : result.reason;
}

test("classifier read-only membedakan missing, malformed, version lama, OCR/hash, dan product type quarantine", () => {
  const base = { approvedReferenceManifest: manifest, jobProductSnapshot: snapshot, productType: confirmedType };
  assert.equal(reason(base), "CURRENT");
  assert.equal(reason({ ...base, approvedReferenceManifest: null }), "REFERENCE_MANIFEST_MISSING");
  assert.equal(reason({ ...base, approvedReferenceManifest: "{" }), "REFERENCE_MANIFEST_MALFORMED");
  assert.equal(reason({ ...base, approvedReferenceManifest: JSON.stringify({ version: 1, references: [] }) }), "REFERENCE_MANIFEST_UNSUPPORTED_VERSION");
  assert.equal(reason({ ...base, approvedReferenceManifest: JSON.stringify({
    version: 2, references: [{ ...JSON.parse(manifest).references[0], sha256: "bad" }],
  }) }), "REFERENCE_MANIFEST_INVALID_OCR_OR_HASH");
  assert.equal(reason({ ...base, approvedReferenceManifest: JSON.stringify({
    version: 2, references: [{ ...JSON.parse(manifest).references[0], labelOcrStatus: "FAILED" }],
  }) }), "REFERENCE_MANIFEST_INVALID_OCR_OR_HASH");
  assert.equal(reason({ ...base, jobProductSnapshot: null }), "PRODUCT_SNAPSHOT_MISSING");
  assert.equal(reason({ ...base, jobProductSnapshot: "{" }), "PRODUCT_SNAPSHOT_MALFORMED");
  assert.equal(reason({ ...base, jobProductSnapshot: JSON.stringify({ ...JSON.parse(snapshot), version: 2 }) }), "PRODUCT_SNAPSHOT_UNSUPPORTED_VERSION");
  assert.equal(reason({ ...base, productType: { ...confirmedType, product_type_state: "QUARANTINED" } }), "PRODUCT_TYPE_QUARANTINED");
});

test("classifier tidak memutasi input dan current mengembalikan exact immutable values", () => {
  const input = Object.freeze({ approvedReferenceManifest: manifest, jobProductSnapshot: snapshot, productType: Object.freeze({ ...confirmedType }) });
  const before = JSON.stringify(input);
  const current = classifyLegacyJobEvidence(input);
  assert.equal(current.status, "CURRENT");
  assert.equal(JSON.stringify(input), before);
  if (current.status === "CURRENT") {
    assert.equal(current.manifest.references[0].sha256, "a".repeat(64));
    assert.equal(current.productSnapshot.version, 3);
  }
});

test("require seam mempertahankan kelas error canonical tanpa reason code baru", () => {
  assert.throws(
    () => requireCurrentJobEvidence({ approvedReferenceManifest: null, jobProductSnapshot: snapshot }),
    (error: unknown) => error instanceof UnsafeLegacyReferenceSnapshot && error.message === LEGACY_REFERENCE_REASON,
  );
  assert.throws(
    () => requireCurrentJobEvidence({ approvedReferenceManifest: manifest, jobProductSnapshot: null }),
    (error: unknown) => error instanceof UnsafeLegacyProductSnapshot && error.message === LEGACY_PRODUCT_REASON,
  );
  assert.throws(
    () => requireCurrentJobEvidence({
      approvedReferenceManifest: JSON.stringify({ ...JSON.parse(manifest), version: 1 }),
      jobProductSnapshot: snapshot,
    }),
    (error: unknown) => error instanceof UnsafeLegacyReferenceSnapshot && error.message === LEGACY_REFERENCE_REASON,
  );
  assert.throws(
    () => requireCurrentJobEvidence({
      approvedReferenceManifest: manifest,
      jobProductSnapshot: JSON.stringify({ ...JSON.parse(snapshot), version: 2 }),
    }),
    (error: unknown) => error instanceof UnsafeLegacyProductSnapshot && error.message === LEGACY_PRODUCT_REASON,
  );
  assert.throws(
    () => requireCurrentJobEvidence({ approvedReferenceManifest: manifest, jobProductSnapshot: snapshot, productType: { ...confirmedType, product_type_state: "QUARANTINED" } }),
    (error: unknown) => (error as { body?: { code?: string } }).body?.code === "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
  );
});

test("static guard: workers/A6 memakai classifier dan tidak memiliki live-row manifest backfill", () => {
  const boundaries = [
    "lib/worker.ts",
    "lib/postgres/worker.ts",
    "app/api/dashboard/campaign/job/[jobId]/route.ts",
  ];
  for (const file of boundaries) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /requireCurrentJobEvidence\(/, `${file} tidak memakai classifier shared`);
    assert.match(source, /productType:\s*(?:product|row|job)/, `${file} tidak mengarantina provenance product type`);
    assert.doesNotMatch(source, /loadOrCreateJobReferenceManifest|installReferenceManifestIfSafe|candidateRels:\s*(?:images|row\.product_images)/);
  }
  const allProduction = [
    "lib/job-reference-manifest.ts", "lib/postgres/jobs.ts", "lib/worker.ts", "lib/postgres/worker.ts",
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(allProduction, /loadOrCreateJobReferenceManifest|installReferenceManifestIfSafe/);
});

test("A1/A4 retail+org admissions classify current evidence before job/hold visibility", () => {
  for (const file of ["app/api/jobs/route.ts", "lib/postgres/smoke-runtime.ts", "lib/dashboard/render-cell.ts"]) {
    const source = fs.readFileSync(file, "utf8");
    const gate = source.indexOf("requireCurrentJobEvidence({");
    const insert = source.indexOf("INSERT INTO jobs", gate);
    assert.ok(gate >= 0 && insert > gate, `${file}: classifier terlambat sesudah job INSERT`);
    assert.match(source.slice(gate, insert), /approvedReferenceManifest:\s*preparedReference\.raw/);
    assert.match(source.slice(gate, insert), /jobProductSnapshot:\s*productSnapshotRaw/);
    assert.match(source.slice(gate, insert), /productType:\s*(?:admissionProduct|lockedProduct)/);
  }
});
