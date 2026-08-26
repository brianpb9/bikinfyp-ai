import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  acceptEverythingMutation,
  buildReferenceBoundaryInput,
  referenceDecision,
  rejectEverythingMutation,
  type DeclaredTypeSource,
  type TrustedTypeSource,
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
  effects: EffectExpectation[];
};

type EffectExpectation = {
  label: string;
  callName: string;
  textIncludes?: string;
};

const effect = (callName: string, textIncludes?: string, label = callName): EffectExpectation => ({ label, callName, textIncludes });

const boundaryExpectations: BoundaryExpectation[] = [
  { id: "E1", file: "app/api/products/route.ts", handler: "POST", effects: [
    effect("saveProductImages"), effect("smokeCreateProduct"), effect("run", "INSERT INTO products", "SQLite product INSERT"),
    effect("auditProductCreatedOnce"),
  ] },
  { id: "E3", file: "app/api/products/[id]/route.ts", handler: "PATCH", effects: [
    effect("pgUpdateProduct"), effect("run", "UPDATE products SET name", "SQLite category UPDATE"), effect("audit", "product.updated", "SQLite update audit"),
    effect("pgSetProductBrand"), effect("run", "UPDATE products SET raw_meta", "SQLite brand UPDATE"), effect("audit", "product.brand_set", "SQLite brand audit"),
  ] },
  {
    id: "E6",
    file: "app/api/dashboard/campaign/product/route.ts",
    handler: "POST",
    effects: [effect("downloadProductImages"), effect("smokeCreateProduct"), effect("pgAudit", "product.extracted", "URL create audit"), effect("pgAudit", "product.created", "manual create audit")],
  },
  { id: "E7", file: "app/api/dashboard/campaign/product/route.ts", handler: "PATCH", effects: [
    effect("query", "UPDATE products SET", "PostgreSQL product UPDATE"), effect("pgAudit", "product.updated", "organization update audit"),
  ] },
  {
    id: "A1",
    file: "app/api/jobs/route.ts",
    handler: "POST",
    effects: [
      effect("prepareAdmissionReferenceManifest"), effect("smokeCreateJob"), effect("pgSaveFypSnapshot"), effect("pgAudit"),
      effect("smokeCompleteJob"), effect("enqueueManagedStagingTraceJob"), effect("enqueueJob"),
      effect("createJobProductSnapshotRaw"), effect("run", "INSERT INTO jobs", "SQLite job INSERT"), effect("holdCredits"),
      effect("run", "UPDATE scripts SET job_id", "SQLite script claim"), effect("audit", "job.created", "SQLite job audit"), effect("createFypSnapshot"),
      effect("pgFindOrCreatePersona"), effect("run", "INSERT INTO personas", "SQLite persona INSERT"),
      effect("audit", "persona.created", "SQLite persona audit"), effect("claimManagedStagingTraceNonce"),
    ],
  },
  { id: "A2", file: "app/api/dashboard/matrix/route.ts", handler: "POST", effects: [
    effect("acquireAdmissionReferenceEvidence"), effect("pgFindOrCreatePersona"), effect("generateScripts"), effect("smokeCreateScripts"), effect("renderSatuSel"),
  ] },
  { id: "A3", file: "app/api/dashboard/campaign/generate/route.ts", handler: "POST", effects: [
    effect("acquireAdmissionReferenceEvidence"), effect("generateScripts"), effect("smokeCreateScripts"),
  ] },
  { id: "A4", file: "lib/dashboard/render-cell.ts", handler: "renderSatuSel", effects: [
    effect("periksaAdmisi"), effect("createJobProductSnapshotRaw"), effect("prepareAdmissionReferenceManifest"),
    effect("query", "UPDATE scripts", "PostgreSQL script writes"), effect("query", "INSERT INTO audit_log", "PostgreSQL audit writes"),
    effect("query", "INSERT INTO jobs", "PostgreSQL job INSERT"), effect("query", "COMMIT", "PostgreSQL admission COMMIT"),
    effect("holdCredits"), effect("pgSaveFypSnapshot"), effect("pgAudit"), effect("enqueueJob"), effect("failJob"),
  ] },
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
    const input = seam.arguments[0];
    if (!input || !ts.isCallExpression(input) || callName(input) !== "buildAuthoritativeTypeBoundaryInput") {
      violations.push(`${expectation.id}: seam input does not come from the typed source-identity builder`);
    } else if (input.arguments.length !== 2) {
      violations.push(`${expectation.id}: source-identity builder requires declared and trusted inputs`);
    } else if (input.arguments[0].getText(source) === input.arguments[1].getText(source)) {
      violations.push(`${expectation.id}: declared and trusted builder arguments are the same expression`);
    }
    if (!ts.isAwaitExpression(seam.parent) && !ts.isReturnStatement(seam.parent)) {
      violations.push(`${expectation.id}: seam rejection is neither awaited nor returned`);
    }
    const effectCallback = seam.arguments[1];
    if (!effectCallback || (!ts.isArrowFunction(effectCallback) && !ts.isFunctionExpression(effectCallback))) {
      violations.push(`${expectation.id}: seam call does not own an effect callback`);
    }
  }

  for (const expectedEffect of expectation.effects) {
    const effects = calls.filter((call) => callName(call) === expectedEffect.callName
      && (!expectedEffect.textIncludes || call.getText(source).includes(expectedEffect.textIncludes)));
    if (effects.length === 0) {
      violations.push(`${expectation.id}: expected effect ${expectedEffect.label} not found`);
      continue;
    }
    for (const effect of effects) {
      const guarded = seams.some((seam) => {
        const callback = seam.arguments[1];
        return Boolean(callback && isDescendantOf(effect, callback));
      });
      if (!guarded) violations.push(`${expectation.id}: ${expectedEffect.label} is not owned by a seam effect callback`);
    }
  }
  if (seams.length === 0) violations.push(`${expectation.id}: no AST CallExpression to validateAuthoritativeProductType`);
  return violations;
}

async function inspectProductionSeamBehavior(): Promise<string[]> {
  const seamPath = path.join(root, "lib/product-type-boundary.ts");
  if (!fs.existsSync(seamPath)) return ["CENTRAL: lib/product-type-boundary.ts is absent"];
  const module = await import(pathToFileURL(seamPath).href) as {
    buildAuthoritativeTypeBoundaryInput?: (
      declared: DeclaredTypeSource,
      trusted: TrustedTypeSource | null,
    ) => TypeBoundaryInput;
    validateAuthoritativeProductType?: (
      input: TypeBoundaryInput,
      onAdmit?: () => unknown | Promise<unknown>,
    ) => unknown | Promise<unknown>;
  };
  if (typeof module.validateAuthoritativeProductType !== "function") {
    return ["CENTRAL: validateAuthoritativeProductType export is absent"];
  }
  if (typeof module.buildAuthoritativeTypeBoundaryInput !== "function") {
    return ["CENTRAL: buildAuthoritativeTypeBoundaryInput export is absent"];
  }
  const build = module.buildAuthoritativeTypeBoundaryInput;
  const decide = module.validateAuthoritativeProductType;
  const declaredA: DeclaredTypeSource = { kind: "DECLARED_TYPE_SOURCE", sourceId: "request-category", token: "opaque-type-a" };
  const trustedA: TrustedTypeSource = { kind: "TRUSTED_TYPE_SOURCE", sourceId: "catalogue-type", token: "opaque-type-a", provenance: "future-policy-fixture" };
  const trustedB: TrustedTypeSource = { ...trustedA, token: "opaque-type-b" };
  const builtMismatch = build(declaredA, trustedB);
  const builtValid = build(declaredA, trustedA);
  let mismatchEffects = 0;
  let validEffects = 0;
  let mismatchRejected = false;
  try {
    await decide(builtMismatch, () => { mismatchEffects += 1; });
  } catch {
    mismatchRejected = true;
  }
  const validDecision = await decide(builtValid, () => { validEffects += 1; });
  const missingDecision = await decide(build(declaredA, null));
  const violations: string[] = [];
  if (!mismatchRejected) violations.push("CENTRAL: mismatch returned instead of rejecting");
  if (validDecision !== "ADMIT") violations.push(`CENTRAL: trusted match returned ${String(validDecision)}`);
  if (missingDecision !== "UNDETERMINED_POLICY_INPUT") violations.push(`CENTRAL: missing policy returned ${String(missingDecision)}`);
  if (mismatchEffects !== 0) violations.push("CENTRAL: mismatch invoked its effect callback");
  if (validEffects !== 1) violations.push(`CENTRAL: trusted match invoked effect ${validEffects} times`);
  try {
    build(declaredA, { ...trustedA, sourceId: declaredA.sourceId });
    violations.push("CENTRAL: aliased declared/trusted source identity was accepted");
  } catch { /* required */ }
  try {
    build(
      { ...declaredA, sourceId: "category" },
      { ...trustedA, sourceId: "categorySignal" },
    );
  } catch {
    violations.push("CENTRAL: similarly named but independent source identities were rejected");
  }
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

test("mutation controls: comparator rejects mismatch without rejecting valid positive or inventing missing policy", async () => {
  assert.equal(referenceDecision(trusted), "ADMIT");
  assert.equal(referenceDecision(mismatch), "REJECT_MISMATCH");
  assert.equal(referenceDecision({ declaredToken: "opaque-type-a", trustedSignal: null }), "UNDETERMINED_POLICY_INPUT");
  assert.notEqual(acceptEverythingMutation(mismatch), "REJECT_MISMATCH", "accept-all mutant must be killed");
  assert.notEqual(rejectEverythingMutation(trusted), "ADMIT", "reject-all mutant must be killed by the valid control");

  const fixture: BoundaryExpectation = { id: "MUTANT", file: "test-only.ts", handler: "POST", effects: [effect("persist"), effect("hold")] };
  const commentOnly = `async function POST(){ /* validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => persist()) */ persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, commentOnly).some((violation) => violation.includes("persist is not owned")), "comment mutant survived");
  const ignoredPrior = `async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => {}); persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, ignoredPrior).some((violation) => violation.includes("persist is not owned")), "ignored-prior-call mutant survived");
  const oneBoundaryOnly = `async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => persist()); hold(); }`;
  assert.ok(inspectBoundary(fixture, oneBoundaryOnly).some((violation) => violation.includes("hold is not owned")), "single-effect mutant survived");
  const ownedEffects = `async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.deepEqual(inspectBoundary(fixture, ownedEffects), [], "correct callback-owned effects did not satisfy the structural contract");
  const rawObjectInputs = `async function POST(){ await validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, rawObjectInputs).some((violation) => violation.includes("typed source-identity builder")), "raw-object input mutant survived");
  const sameExpressionInputs = `async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(alias, alias), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, sameExpressionInputs).some((violation) => violation.includes("same expression")), "same-expression alias mutant survived");

  const declaredSource: DeclaredTypeSource = { kind: "DECLARED_TYPE_SOURCE", sourceId: "category", token: "same" };
  const aliasedTrusted: TrustedTypeSource = { kind: "TRUSTED_TYPE_SOURCE", sourceId: "category", token: "same", provenance: "alias fixture" };
  assert.throws(() => buildReferenceBoundaryInput(declaredSource, aliasedTrusted), /C2_SOURCE_ALIAS/);
  const similarlyNamedTrusted: TrustedTypeSource = { ...aliasedTrusted, sourceId: "categorySignal" };
  assert.equal(referenceDecision(buildReferenceBoundaryInput(declaredSource, similarlyNamedTrusted)), "ADMIT");

  const probeHandler = async (
    seam: (input: TypeBoundaryInput, onAdmit: () => void) => unknown | Promise<unknown>,
    input: TypeBoundaryInput,
  ) => {
    let effects = 0;
    try {
      await seam(input, () => { effects += 1; });
      return { status: 201, effects };
    } catch {
      return { status: 422, effects };
    }
  };
  const ignoredResultMutant = async () => "REJECT_MISMATCH";
  const falseGreen = await probeHandler(ignoredResultMutant, mismatch);
  assert.equal(falseGreen.status, 201, "ignored-result mutant fixture did not demonstrate false success");
  const rejectingSeam = async (input: TypeBoundaryInput, onAdmit: () => void) => {
    if (referenceDecision(input) === "REJECT_MISMATCH") throw new Error("test-only mismatch rejection");
    onAdmit();
    return "ADMIT";
  };
  assert.deepEqual(await probeHandler(rejectingSeam, mismatch), { status: 422, effects: 0 });
  assert.deepEqual(await probeHandler(rejectingSeam, trusted), { status: 201, effects: 1 });
});

test("RED: every production boundary rejects supplied mismatch before its own effects", async () => {
  const violations = [
    ...boundaryExpectations.flatMap((expectation) => inspectBoundary(expectation)),
    ...await inspectProductionSeamBehavior(),
  ];
  assert.deepEqual(violations, [], `C2_MISSING_INVARIANT:\n${violations.join("\n")}`);
});
