import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  acceptEverythingMutation,
  referenceDecision,
  rejectEverythingMutation,
  type TypeBoundaryInput,
} from "./fixtures/c2-type-mismatch-contract";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const sources = {
  e1: read("app/api/products/route.ts"),
  e3: read("app/api/products/[id]/route.ts"),
  e6e7: read("app/api/dashboard/campaign/product/route.ts"),
  a1: read("app/api/jobs/route.ts"),
  a2: read("app/api/dashboard/matrix/route.ts"),
  a3: read("app/api/dashboard/campaign/generate/route.ts"),
  a4: read("lib/dashboard/render-cell.ts"),
  sqliteSchema: read("lib/db.ts"),
};

const trusted: TypeBoundaryInput = {
  declaredToken: "opaque-type-a",
  trustedSignal: { token: "opaque-type-a", provenance: "future-policy-fixture" },
};
const mismatch: TypeBoundaryInput = {
  declaredToken: "opaque-type-a",
  trustedSignal: { token: "opaque-type-b", provenance: "future-policy-fixture" },
};

test("discovery: current Product Truth persistence has category but no authoritative type signal", () => {
  const productionInputs = [sources.e1, sources.e3, sources.e6e7, sources.sqliteSchema].join("\n");
  assert.match(productionInputs, /category/);
  assert.doesNotMatch(productionInputs, /\b(product_type|productType|jenis_produk|authoritative_type|trusted_type)\b/);
  assert.match(read("lib/category-guess.ts"), /guessCategory/);
  assert.match(read("lib/category-guess.ts"), /return "default"/);
});
test("discovery: E1 E3 E6 E7 carry unchecked category into persistence", () => {
  assert.match(sources.e1, /category = String\(body\.category \?\? "default"\)\.trim\(\)/);
  assert.match(sources.e1, /priceIdr, category, productVisualDesc/);
  assert.match(sources.e3, /const category = body\.category !== undefined/);
  assert.match(sources.e3, /UPDATE products SET name = \?, price_idr = \?, category = \?/);
  assert.match(sources.e6e7, /category: result\.categoryGuess \?\? "default"/);
  assert.match(sources.e6e7, /category: typeof body\.category === "string" && body\.category \? body\.category : "default"/);
  assert.match(sources.e6e7, /const category = typeof body\.category === "string" && body\.category \? body\.category : existing\.category/);
  assert.match(sources.e6e7, /UPDATE products SET name=\$1, price_idr=\$2, category=\$3/);
});

test("discovery: A1-A4 carry stored category to snapshot, generation, job, or hold boundaries", () => {
  assert.match(sources.a1, /createJobProductSnapshotRaw\(admissionProduct\)/);
  assert.match(sources.a1, /INSERT INTO jobs/);
  assert.match(sources.a1, /holdCredits\(user\.id, preparedJobId, priceIdr\)/);
  assert.match(sources.a2, /const product = await routeDeps\.smokeGetOrgProduct/);
  assert.match(sources.a2, /renderSatuSel/);
  assert.match(sources.a3, /category: product\.category/);
  assert.match(sources.a3, /routeDeps\.generateScripts/);
  assert.match(sources.a4, /productCategory: lockedProduct\.category/);
  assert.match(sources.a4, /createJobProductSnapshotRaw\(lockedProduct\)/);
  assert.match(sources.a4, /INSERT INTO jobs/);
  assert.match(sources.a4, /creditsRepo\.holdCredits/);
});

test("mutation controls: comparator rejects mismatch without rejecting valid positive or inventing missing policy", () => {
  assert.equal(referenceDecision(trusted), "ADMIT");
  assert.equal(referenceDecision(mismatch), "REJECT_MISMATCH");
  assert.equal(referenceDecision({ declaredToken: "opaque-type-a", trustedSignal: null }), "UNDETERMINED_POLICY_INPUT");
  assert.notEqual(acceptEverythingMutation(mismatch), "REJECT_MISMATCH", "accept-all mutant must be killed");
  assert.notEqual(rejectEverythingMutation(trusted), "ADMIT", "reject-all mutant must be killed by the valid control");
});

test("RED: production boundaries reject a supplied authoritative mismatch before persistence/admission/spend", () => {
  const productionBoundarySources = Object.values(sources).join("\n");
  const centralSeamIsCalled = /validateAuthoritativeProductType\s*\(/.test(productionBoundarySources);
  assert.equal(
    centralSeamIsCalled,
    true,
    "C2_MISSING_INVARIANT: no production boundary calls the proposed authoritative-type validation seam",
  );
});
