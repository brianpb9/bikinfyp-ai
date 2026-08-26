import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
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

type BoundaryExpectation = {
  id: string;
  file: string;
  handler: string;
  effects: string[];
};

const boundaryExpectations: BoundaryExpectation[] = [
  { id: "E1", file: "app/api/products/route.ts", handler: "POST", effects: ["saveProductImages"] },
  { id: "E3", file: "app/api/products/[id]/route.ts", handler: "PATCH", effects: ["pgUpdateProduct", "run"] },
  {
    id: "E6",
    file: "app/api/dashboard/campaign/product/route.ts",
    handler: "POST",
    effects: ["smokeCreateProduct"],
  },
  { id: "E7", file: "app/api/dashboard/campaign/product/route.ts", handler: "PATCH", effects: ["query"] },
  {
    id: "A1",
    file: "app/api/jobs/route.ts",
    handler: "POST",
    effects: ["smokeCreateJob", "createJobProductSnapshotRaw", "holdCredits", "enqueueJob"],
  },
  { id: "A2", file: "app/api/dashboard/matrix/route.ts", handler: "POST", effects: ["renderSatuSel"] },
  { id: "A3", file: "app/api/dashboard/campaign/generate/route.ts", handler: "POST", effects: ["generateScripts"] },
  { id: "A4", file: "lib/dashboard/render-cell.ts", handler: "renderSatuSel", effects: ["periksaAdmisi", "createJobProductSnapshotRaw", "holdCredits"] },
];

function callName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return null;
}

function isDescendantOf(node: ts.Node, ancestor: ts.Node): boolean {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

function inspectBoundary(expectation: BoundaryExpectation, suppliedSourceText?: string): string[] {
  const sourceText = suppliedSourceText ?? read(expectation.file);
  const source = ts.createSourceFile(expectation.file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const handler = source.statements.find(
    (statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement)
      && statement.name?.text === expectation.handler,
  );
  if (!handler?.body) return [`${expectation.id}: handler ${expectation.handler} not found`];
  const handlerBody = handler.body;

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(handlerBody);

  const seams = calls.filter((call) => callName(call) === "validateAuthoritativeProductType");
  const violations: string[] = [];
  for (const seam of seams) {
    const inputText = seam.arguments[0]?.getText(source) ?? "";
    if (!/declaredToken/.test(inputText) || !/trustedSignal/.test(inputText)) {
      violations.push(`${expectation.id}: seam call lacks declaredToken/trustedSignal`);
    }
    const effectCallback = seam.arguments[1];
    if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
      violations.push(`${expectation.id}: seam call does not own an effect callback`);
    }
  }

  for (const effectName of expectation.effects) {
    const effects = calls.filter((call) => callName(call) === effectName);
    if (effects.length === 0) {
      violations.push(`${expectation.id}: expected effect ${effectName} not found`);
      continue;
    }
    for (const effect of effects) {
      const guarded = seams.some((seam) => {
        const callback = seam.arguments[1];
        return Boolean(callback && isDescendantOf(effect, callback));
      });
      if (!guarded) violations.push(`${expectation.id}: ${effectName} is not owned by a seam effect callback`);
    }
  }
  if (seams.length === 0) violations.push(`${expectation.id}: no AST CallExpression to validateAuthoritativeProductType`);
  return violations;
}

async function inspectProductionSeamBehavior(): Promise<string[]> {
  const seamPath = path.join(root, "lib/product-type-boundary.ts");
  if (!fs.existsSync(seamPath)) return ["CENTRAL: lib/product-type-boundary.ts is absent"];
  const module = await import(pathToFileURL(seamPath).href) as {
    validateAuthoritativeProductType?: (
      input: TypeBoundaryInput,
      onAdmit?: () => unknown | Promise<unknown>,
    ) => unknown | Promise<unknown>;
  };
  if (typeof module.validateAuthoritativeProductType !== "function") {
    return ["CENTRAL: validateAuthoritativeProductType export is absent"];
  }
  const decide = module.validateAuthoritativeProductType;
  let mismatchEffects = 0;
  let validEffects = 0;
  const mismatchDecision = await decide(mismatch, () => { mismatchEffects += 1; });
  const validDecision = await decide(trusted, () => { validEffects += 1; });
  const missingDecision = await decide({ declaredToken: "opaque-type-a", trustedSignal: null });
  const violations: string[] = [];
  if (mismatchDecision !== "REJECT_MISMATCH") violations.push(`CENTRAL: mismatch returned ${String(mismatchDecision)}`);
  if (validDecision !== "ADMIT") violations.push(`CENTRAL: trusted match returned ${String(validDecision)}`);
  if (missingDecision !== "UNDETERMINED_POLICY_INPUT") violations.push(`CENTRAL: missing policy returned ${String(missingDecision)}`);
  if (mismatchEffects !== 0) violations.push("CENTRAL: mismatch invoked its effect callback");
  if (validEffects !== 1) violations.push(`CENTRAL: trusted match invoked effect ${validEffects} times`);
  return violations;
}

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

  const fixture: BoundaryExpectation = { id: "MUTANT", file: "test-only.ts", handler: "POST", effects: ["persist", "hold"] };
  const commentOnly = `function POST(){ /* validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => persist()) */ persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, commentOnly).some((violation) => violation.includes("persist is not owned")), "comment mutant survived");
  const ignoredPrior = `function POST(){ validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => {}); persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, ignoredPrior).some((violation) => violation.includes("persist is not owned")), "ignored-prior-call mutant survived");
  const oneBoundaryOnly = `function POST(){ validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => persist()); hold(); }`;
  assert.ok(inspectBoundary(fixture, oneBoundaryOnly).some((violation) => violation.includes("hold is not owned")), "single-effect mutant survived");
  const ownedEffects = `function POST(){ validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => { persist(); hold(); }); }`;
  assert.deepEqual(inspectBoundary(fixture, ownedEffects), [], "correct callback-owned effects did not satisfy the structural contract");
});

test("RED: every production boundary rejects supplied mismatch before its own effects", async () => {
  const violations = [
    ...boundaryExpectations.flatMap((expectation) => inspectBoundary(expectation)),
    ...await inspectProductionSeamBehavior(),
  ];
  assert.deepEqual(violations, [], `C2_MISSING_INVARIANT:\n${violations.join("\n")}`);
});
