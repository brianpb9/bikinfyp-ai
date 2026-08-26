import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  acceptEverythingMutation,
  buildReferenceBoundaryInput,
  issueReferenceTrustedTypeCapability,
  referenceDecision,
  rejectEverythingMutation,
  type DeclaredTypeSource,
  type TrustedTypeSource,
  type TypeBoundaryInput,
} from "./fixtures/c2-type-mismatch-contract";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function constantModuleString(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return constantModuleString(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = constantModuleString(node.left);
    const right = constantModuleString(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantModuleString(span.expression);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  return null;
}

function isCentralModuleSpecifier(value: string): boolean {
  const normalized = value.replace(/[?#].*$/, "").replace(/\.(?:[cm]?[jt]sx?)$/, "");
  return normalized === "@/lib/product-type-boundary" || normalized.endsWith("/product-type-boundary");
}

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
    effects: [effect("pgAudit", '"product.extract"', "URL extraction audit"), effect("downloadProductImages"), effect("smokeCreateProduct"), effect("pgAudit", '"product.extracted"', "URL create audit"), effect("pgAudit", '"product.created"', "manual create audit")],
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
      effect("cleanupUnadmittedReferenceKeys"), effect("cleanupSupersededReferenceKeys"),
      effect("audit", '"fyp.snapshot"', "SQLite FYP audit"), effect("failJob"),
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
    effect("cleanupUnadmittedReferenceKeys"),
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

  const allowedCentralImports = new Set(["validateAuthoritativeProductType", "buildAuthoritativeTypeBoundaryInput"]);
  const centralImports = source.statements.filter((statement): statement is ts.ImportDeclaration => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && isCentralModuleSpecifier(statement.moduleSpecifier.text));
  const importedLocalName = (importedName: string): string | null => {
    for (const declaration of centralImports) {
      const bindings = declaration.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const specifier = bindings.elements.find((element) => (element.propertyName?.text ?? element.name.text) === importedName);
      if (specifier) return specifier.name.text;
    }
    return null;
  };
  const validatorLocal = importedLocalName("validateAuthoritativeProductType");
  const builderLocal = importedLocalName("buildAuthoritativeTypeBoundaryInput");

  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(handlerBody);

  const violations: string[] = [];
  if (!validatorLocal || !builderLocal) violations.push(`${expectation.id}: central seam/builder named imports are absent`);
  const hasDynamicCentralAccess = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument && constantModuleString(argument) !== null && isCentralModuleSpecifier(constantModuleString(argument)!)) return true;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
      const argument = node.arguments[0];
      if (argument && constantModuleString(argument) !== null && isCentralModuleSpecifier(constantModuleString(argument)!)) return true;
    }
    return ts.forEachChild(node, hasDynamicCentralAccess) ?? false;
  };
  if (hasDynamicCentralAccess(source)) violations.push(`${expectation.id}: dynamically imports the central module`);
  if (source.statements.some((statement) => ts.isExportDeclaration(statement)
    && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    && isCentralModuleSpecifier(statement.moduleSpecifier.text))) {
    violations.push(`${expectation.id}: re-exports the central module`);
  }
  if (source.statements.some((statement) => ts.isImportEqualsDeclaration(statement)
    && ts.isExternalModuleReference(statement.moduleReference)
    && statement.moduleReference.expression
    && ts.isStringLiteral(statement.moduleReference.expression)
    && isCentralModuleSpecifier(statement.moduleReference.expression.text))) {
    violations.push(`${expectation.id}: uses import-equals access to the central module`);
  }
  for (const declaration of centralImports) {
    if (!declaration.importClause || declaration.importClause.name) {
      violations.push(`${expectation.id}: central module default/side-effect import is forbidden`);
    }
    const bindings = declaration.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const importedName = element.propertyName?.text ?? element.name.text;
        if (!allowedCentralImports.has(importedName)) {
          violations.push(`${expectation.id}: central module import ${importedName} is outside the allowlist`);
        }
      }
    }
  }
  const importsContractIssuer = centralImports.some((declaration) => {
    const bindings = declaration.importClause?.namedBindings;
    return Boolean(bindings && ts.isNamedImports(bindings)
      && bindings.elements.some((element) => (element.propertyName?.text ?? element.name.text) === "__issueTrustedTypeCapabilityForContractTest"));
  });
  if (importsContractIssuer) {
    violations.push(`${expectation.id}: production handler imports the contract-test capability issuer`);
  }
  if (centralImports.some((declaration) => {
    const bindings = declaration.importClause?.namedBindings;
    return Boolean(bindings && ts.isNamespaceImport(bindings));
  })) {
    violations.push(`${expectation.id}: production handler uses namespace access to the central boundary module`);
  }

  const shadowed = new Set<string>();
  const findShadows = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) shadowed.add(node.name.text);
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) shadowed.add(node.name.text);
    if (ts.isFunctionDeclaration(node) && node !== handler && node.name) shadowed.add(node.name.text);
    ts.forEachChild(node, findShadows);
  };
  findShadows(handlerBody);
  if (validatorLocal && shadowed.has(validatorLocal)) violations.push(`${expectation.id}: central validator import is shadowed locally`);
  if (builderLocal && shadowed.has(builderLocal)) violations.push(`${expectation.id}: central builder import is shadowed locally`);

  const seams = calls.filter((call) => ts.isIdentifier(call.expression)
    && validatorLocal !== null
    && call.expression.text === validatorLocal
    && !shadowed.has(validatorLocal));
  for (const seam of seams) {
    const input = seam.arguments[0];
    if (!input || !ts.isCallExpression(input) || !ts.isIdentifier(input.expression)
      || builderLocal === null || input.expression.text !== builderLocal || shadowed.has(builderLocal)) {
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
  let missingEffects = 0;
  const missingDecision = await decide(build(declaredA, null), () => { missingEffects += 1; });
  const violations: string[] = [];
  if (missingDecision !== "UNDETERMINED_POLICY_INPUT") violations.push(`CENTRAL: missing policy returned ${String(missingDecision)}`);
  if (missingEffects !== 0) violations.push(`CENTRAL: missing policy invoked effect ${missingEffects} times`);
  try {
    build(declaredA, Object.freeze({ kind: "TRUSTED_TYPE_SOURCE", sourceId: "reference-ingress:forged", token: declaredA.token, provenance: "forged" }));
    violations.push("CENTRAL: structurally forged frozen capability was accepted");
  } catch { /* required */ }
  violations.push("CENTRAL: approved production ingress capability fixture is not yet authorized");
  return violations;
}

function inspectProductionIssuerAccess(): string[] {
  const violations: string[] = [];
  const allowedCentralImports = new Set(["validateAuthoritativeProductType", "buildAuthoritativeTypeBoundaryInput"]);
  const visitDirectory = (directory: string) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visitDirectory(relative);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || relative === "lib/product-type-boundary.ts") continue;
      const text = read(relative);
      if (text.includes("__issueTrustedTypeCapabilityForContractTest")) {
        violations.push(`ISSUER_ACCESS: ${relative} references the contract-test issuer`);
      }
      const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)
          || !ts.isStringLiteral(statement.moduleSpecifier)
          || !isCentralModuleSpecifier(statement.moduleSpecifier.text)) continue;
        if (!statement.importClause || statement.importClause.name) {
          violations.push(`ISSUER_ACCESS: ${relative} has forbidden central default/side-effect import`);
        }
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          violations.push(`ISSUER_ACCESS: ${relative} has forbidden namespace access to the central module`);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            if (!allowedCentralImports.has(importedName)) {
              violations.push(`ISSUER_ACCESS: ${relative} imports non-allowlisted central export ${importedName}`);
            }
          }
        }
      }
      for (const statement of source.statements) {
        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier
          && ts.isStringLiteral(statement.moduleSpecifier)
          && isCentralModuleSpecifier(statement.moduleSpecifier.text)) {
          violations.push(`ISSUER_ACCESS: ${relative} re-exports the central module`);
        }
        if (ts.isImportEqualsDeclaration(statement) && ts.isExternalModuleReference(statement.moduleReference)
          && statement.moduleReference.expression && ts.isStringLiteral(statement.moduleReference.expression)
          && isCentralModuleSpecifier(statement.moduleReference.expression.text)) {
          violations.push(`ISSUER_ACCESS: ${relative} uses import-equals access to the central module`);
        }
      }
      const dynamicCentralAccess = (node: ts.Node): boolean => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const argument = node.arguments[0];
          const value = argument ? constantModuleString(argument) : null;
          if (value !== null && isCentralModuleSpecifier(value)) return true;
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require") {
          const argument = node.arguments[0];
          const value = argument ? constantModuleString(argument) : null;
          if (value !== null && isCentralModuleSpecifier(value)) return true;
        }
        return ts.forEachChild(node, dynamicCentralAccess) ?? false;
      };
      if (dynamicCentralAccess(source)) violations.push(`ISSUER_ACCESS: ${relative} dynamically imports the central module`);
    }
  };
  visitDirectory("app");
  visitDirectory("lib");
  return violations;
}

function inspectCentralExportSurface(sourceText?: string): string[] {
  const centralPath = path.join(root, "lib/product-type-boundary.ts");
  if (sourceText === undefined && !fs.existsSync(centralPath)) return [];
  const source = ts.createSourceFile("lib/product-type-boundary.ts", sourceText ?? fs.readFileSync(centralPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowedRuntimeExports = new Set(["validateAuthoritativeProductType", "buildAuthoritativeTypeBoundaryInput"]);
  const violations: string[] = [];
  const exported = (node: { modifiers?: ts.NodeArray<ts.ModifierLike> }) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) violations.push("CENTRAL_EXPORT: default/export-assignment surface is forbidden");
    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        violations.push("CENTRAL_EXPORT: wildcard/re-export surface is forbidden");
      } else {
        for (const element of statement.exportClause.elements) {
          const exportedName = element.name.text;
          if (!element.isTypeOnly && !statement.isTypeOnly && !allowedRuntimeExports.has(exportedName)) {
            violations.push(`CENTRAL_EXPORT: runtime export ${exportedName} is outside the allowlist`);
          }
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && exported(statement)) {
      const name = statement.name?.text ?? "default";
      if (!allowedRuntimeExports.has(name)) violations.push(`CENTRAL_EXPORT: runtime export ${name} is outside the allowlist`);
    }
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "destructured";
        if (!allowedRuntimeExports.has(name)) violations.push(`CENTRAL_EXPORT: runtime export ${name} is outside the allowlist`);
      }
    }
    if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && exported(statement)) {
      violations.push(`CENTRAL_EXPORT: runtime export ${statement.name?.text ?? "default"} is outside the allowlist`);
    }
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
  const centralImport = `import { validateAuthoritativeProductType, buildAuthoritativeTypeBoundaryInput } from "@/lib/product-type-boundary";`;
  const commentOnly = `${centralImport} async function POST(){ /* validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => persist()) */ persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, commentOnly).some((violation) => violation.includes("persist is not owned")), "comment mutant survived");
  const ignoredPrior = `${centralImport} async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => {}); persist(); hold(); }`;
  assert.ok(inspectBoundary(fixture, ignoredPrior).some((violation) => violation.includes("persist is not owned")), "ignored-prior-call mutant survived");
  const oneBoundaryOnly = `${centralImport} async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => persist()); hold(); }`;
  assert.ok(inspectBoundary(fixture, oneBoundaryOnly).some((violation) => violation.includes("hold is not owned")), "single-effect mutant survived");
  const ownedEffects = `${centralImport} async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.deepEqual(inspectBoundary(fixture, ownedEffects), [], "correct callback-owned effects did not satisfy the structural contract");
  const rawObjectInputs = `${centralImport} async function POST(){ await validateAuthoritativeProductType({ declaredToken, trustedSignal }, () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, rawObjectInputs).some((violation) => violation.includes("typed source-identity builder")), "raw-object input mutant survived");
  const sameExpressionInputs = `${centralImport} async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(alias, alias), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, sameExpressionInputs).some((violation) => violation.includes("same expression")), "same-expression alias mutant survived");

  const shadowedLocalSeam = `${centralImport} async function POST(){ const validateAuthoritativeProductType = async (_i: unknown, cb: () => void) => cb(); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, shadowedLocalSeam).some((violation) => violation.includes("shadowed locally")), "shadowed local-seam mutant survived");
  const receiverLocalSeam = `${centralImport} async function POST(){ await local.validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, receiverLocalSeam).some((violation) => violation.includes("not owned")), "local receiver-seam mutant survived");
  const splitIssuerImport = `${centralImport} import { __issueTrustedTypeCapabilityForContractTest } from "@/lib/product-type-boundary"; async function POST(){ const trusted = __issueTrustedTypeCapabilityForContractTest(declared.token, "forged"); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, splitIssuerImport).some((violation) => violation.includes("imports the contract-test capability issuer")), "split-import issuer mutant survived");
  const namespaceIssuerImport = `${centralImport} import * as boundary from "@/lib/product-type-boundary"; async function POST(){ const trusted = boundary.__issueTrustedTypeCapabilityForContractTest(declared.token, "forged"); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, namespaceIssuerImport).some((violation) => violation.includes("namespace access")), "namespace issuer mutant survived");
  const aliasedIssuerImport = `${centralImport} import { issueTrusted as mint } from "@/lib/product-type-boundary"; async function POST(){ const trusted = mint(declared.token); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, aliasedIssuerImport).some((violation) => violation.includes("outside the allowlist")), "aliased issuer export mutant survived");
  const dynamicIssuerAccess = `${centralImport} async function POST(){ const boundary = await import("@/lib/product-type-boundary"); const trusted = boundary.issueTrusted(declared.token); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, dynamicIssuerAccess).some((violation) => violation.includes("dynamically imports")), "dynamic issuer access mutant survived");
  const computedIssuerAccess = `${centralImport} async function POST(){ const boundary = await import("@/lib/" + "product-type-boundary.ts"); const trusted = boundary["issueTrusted" + "ForContractTest"](declared.token); await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, computedIssuerAccess).some((violation) => violation.includes("dynamically imports")), "computed issuer access mutant survived");
  const reExportIssuerAccess = `${centralImport} export { issueTrusted as mint } from "@/lib/product-type-boundary.js"; async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); }`;
  assert.ok(inspectBoundary(fixture, reExportIssuerAccess).some((violation) => violation.includes("re-exports")), "re-export issuer mutant survived");
  const maliciousCentralAlias = `export function validateAuthoritativeProductType(){} export function buildAuthoritativeTypeBoundaryInput(){} export const issueTrusted = () => ({ token: "forged" });`;
  assert.ok(inspectCentralExportSurface(maliciousCentralAlias).some((violation) => violation.includes("issueTrusted")), "central export-alias mutant survived");

  const declaredSource: DeclaredTypeSource = { kind: "DECLARED_TYPE_SOURCE", sourceId: "category", token: "same" };
  const forgedTrusted: TrustedTypeSource = { kind: "TRUSTED_TYPE_SOURCE", sourceId: "different-id", token: declaredSource.token, provenance: "forged" };
  assert.throws(() => buildReferenceBoundaryInput(declaredSource, forgedTrusted), /C2_UNTRUSTED_CAPABILITY/);
  const similarlyNamedTrusted = issueReferenceTrustedTypeCapability("same", "categorySignal");
  assert.equal(referenceDecision(buildReferenceBoundaryInput(declaredSource, similarlyNamedTrusted)), "ADMIT");
  const clonedIssuedFields: TrustedTypeSource = Object.freeze({ ...similarlyNamedTrusted });
  assert.match(clonedIssuedFields.sourceId, /^reference-ingress:/, "clone fixture lacks the issuer-looking prefix needed to kill prefix mutants");
  assert.equal(Object.isFrozen(clonedIssuedFields), true, "clone fixture must kill frozen-object authenticity mutants");
  assert.throws(() => buildReferenceBoundaryInput(declaredSource, clonedIssuedFields), /C2_UNTRUSTED_CAPABILITY/);
  const prefixOnlyMutantAccepts = (candidate: TrustedTypeSource) => candidate.sourceId.startsWith("reference-ingress:");
  assert.equal(prefixOnlyMutantAccepts(clonedIssuedFields), true, "prefix-only mutant fixture did not demonstrate its false acceptance");
  const frozenOnlyMutantAccepts = (candidate: TrustedTypeSource) => Object.isFrozen(candidate);
  assert.equal(frozenOnlyMutantAccepts(clonedIssuedFields), true, "frozen-only mutant fixture did not demonstrate its false acceptance");

  const missingAdmitMutant = async (input: TypeBoundaryInput, onAdmit: () => void) => {
    if (!input.trustedSignal) { onAdmit(); return "UNDETERMINED_POLICY_INPUT"; }
    return "ADMIT";
  };
  let missingMutantEffects = 0;
  assert.equal(await missingAdmitMutant(buildReferenceBoundaryInput(declaredSource, null), () => { missingMutantEffects += 1; }), "UNDETERMINED_POLICY_INPUT");
  assert.equal(missingMutantEffects, 1, "missing-policy admission mutant fixture did not execute its forbidden effect");

  const expandedFixture: BoundaryExpectation = { ...fixture, effects: [...fixture.effects, effect("storageCleanup")] };
  const unguardedNewSink = `${centralImport} async function POST(){ await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(declared, trusted), () => { persist(); hold(); }); storageCleanup(); }`;
  assert.ok(inspectBoundary(expandedFixture, unguardedNewSink).some((violation) => violation.includes("storageCleanup is not owned")), "newly enumerated sink mutant survived");

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
    ...inspectProductionIssuerAccess(),
    ...inspectCentralExportSurface(),
  ];
  assert.deepEqual(violations, [], `C2_MISSING_INVARIANT:\n${violations.join("\n")}`);
});
