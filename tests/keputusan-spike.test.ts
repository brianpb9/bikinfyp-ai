// Keputusan ADR-001 (docs/spike-2026-08-17) dijaga di sini.
//
// Ketiganya diambil dari render BERBAYAR, bukan dari teori — jadi kalau ada
// yang membaliknya nanti, ia harus membalik buktinya dulu, bukan cuma kodenya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

function assertLabelGateBeforePersistence(source: string, context: string, route: "E4" | "E8") {
  const ast = ts.createSourceFile(`${context}.ts`, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const posts = ast.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement)
    && statement.name?.text === "POST"
    && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
  assert.equal(posts.length, 1, `${context}: wajib tepat satu exported POST handler`);
  const post = posts[0];
  assert.ok(post.body, `${context}: exported POST wajib punya body`);

  const functionBoundary = (node: ts.Node) =>
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);
  const gateAwaits: ts.AwaitExpression[] = [];
  const persistenceCalls: ts.CallExpression[] = [];
  // Gate harus berasal dari control-flow POST sendiri; helper nested tidak
  // boleh menjadi decoy gate. Persistence sebaliknya dipindai di SELURUH
  // subtree POST: closure/callback/IIFE yang menyimpan tetap side effect dan
  // harus menggagalkan cardinality, terlepas dari bentuk eksekusinya.
  const collectGates = (node: ts.Node): void => {
    if (node !== post && functionBoundary(node)) return;
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      if (ts.isIdentifier(callee) && callee.text === "periksaLabelFoto") gateAwaits.push(node);
    }
    ts.forEachChild(node, collectGates);
  };
  const collectPersistence = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === "saveUniqueProductImages") persistenceCalls.push(node);
    }
    ts.forEachChild(node, collectPersistence);
  };
  collectGates(post.body);
  collectPersistence(post.body);
  assert.equal(gateAwaits.length, 1, `${context}: wajib tepat satu awaited label gate aktual di POST`);
  assert.equal(persistenceCalls.length, 1, `${context}: wajib tepat satu persistence call total di POST`);
  const persistenceCall = persistenceCalls[0];
  assert.ok(ts.isAwaitExpression(persistenceCall.parent) && persistenceCall.parent.expression === persistenceCall,
    `${context}: satu-satunya persistence call wajib langsung di-await`);

  if (route === "E4") {
    const gate = gateAwaits[0];
    let loop: ts.ForOfStatement | undefined;
    let cursor: ts.Node = gate;
    while (cursor.parent && cursor.parent !== post.body) {
      const parent: ts.Node = cursor.parent;
      assert.ok(!functionBoundary(parent), `${context}: gate tidak boleh berada di fungsi nested`);
      assert.ok(
        !ts.isIfStatement(parent) && !ts.isConditionalExpression(parent)
        && !ts.isSwitchStatement(parent) && !ts.isCaseClause(parent) && !ts.isDefaultClause(parent)
        && !ts.isWhileStatement(parent) && !ts.isDoStatement(parent)
        && !(ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)),
        `${context}: label gate setiap blob wajib unconditional`
      );
      if (ts.isCatchClause(parent)) assert.fail(`${context}: label gate tidak boleh dipulihkan catch`);
      if (ts.isTryStatement(parent)) assert.equal(parent.catchClause, undefined, `${context}: label gate tidak boleh dipulihkan catch`);
      if (ts.isForOfStatement(parent)) { loop = parent; break; }
      cursor = parent;
    }
    assert.ok(loop, `${context}: awaited label gate wajib berada dalam for-of seluruh blobs`);
    assert.match(loop.expression.getText(ast), /^blobs(?:\.entries\(\))?$/,
      `${context}: loop label wajib mengiterasi seluruh blobs`);
    let hasEarlyExit = false;
    const scanEarlyExit = (node: ts.Node): void => {
      if (node !== loop && functionBoundary(node)) return;
      if (ts.isBreakStatement(node) || ts.isContinueStatement(node) || ts.isReturnStatement(node)) hasEarlyExit = true;
      ts.forEachChild(node, scanEarlyExit);
    };
    scanEarlyExit(loop.statement);
    assert.equal(hasEarlyExit, false, `${context}: loop label tidak boleh melewati blob dengan early exit`);

    let firstPhotoBypass = false;
    const scanFirstPhotoBypass = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        && /existing\.length/.test(node.getText(ast)) && /(?:^|\D)0(?:\D|$)/.test(node.getText(ast))) firstPhotoBypass = true;
      ts.forEachChild(node, scanFirstPhotoBypass);
    };
    scanFirstPhotoBypass(post.body);
    assert.equal(firstPhotoBypass, false, `${context}: existing.length===0 tidak boleh membatasi gerbang`);
    assert.ok(loop.getEnd() < persistenceCall.getStart(ast), `${context}: persistence wajib sesudah semua label awaits`);
    const gateCall = gate.expression as ts.CallExpression;
    assert.equal(gateCall.arguments.length, 3, `${context}: brand terdaftar wajib diteruskan ke setiap gate`);
    assert.equal(gateCall.arguments[2].getText(ast), "merekTerdaftar(owned.product)",
      `${context}: gate wajib memakai brand otoritatif produk`);
    return;
  }

  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    return expression;
  };
  const firstBlob = (expression: ts.Expression): boolean => {
    expression = unwrap(expression);
    return ts.isElementAccessExpression(expression)
      && ts.isIdentifier(expression.expression) && expression.expression.text === "blobs"
      && !!expression.argumentExpression && ts.isNumericLiteral(expression.argumentExpression)
      && expression.argumentExpression.text === "0";
  };
  const enterpriseEmpty = (expression: ts.Expression): boolean => {
    expression = unwrap(expression);
    if (!ts.isPrefixUnaryExpression(expression) || expression.operator !== ts.SyntaxKind.ExclamationToken) return false;
    const length = unwrap(expression.operand);
    return ts.isPropertyAccessExpression(length) && length.name.text === "length"
      && ts.isPropertyAccessExpression(length.expression)
      && ts.isIdentifier(length.expression.expression) && length.expression.expression.text === "owned"
      && length.expression.name.text === "images";
  };
  const exactFirstPhotoCondition = (expression: ts.Expression): boolean => {
    expression = unwrap(expression);
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) return false;
    return enterpriseEmpty(expression.left) && firstBlob(expression.right);
  };

  const branches: ts.IfStatement[] = [];
  const collectBranches = (node: ts.Node): void => {
    if (node !== post && functionBoundary(node)) return;
    if (ts.isIfStatement(node) && exactFirstPhotoCondition(node.expression)) branches.push(node);
    ts.forEachChild(node, collectBranches);
  };
  collectBranches(post.body);
  assert.equal(branches.length, 1, `${context}: wajib tepat satu branch foto-pertama dengan kondisi ${route} exact`);
  const branch = branches[0];
  assert.ok(ts.isBlock(branch.thenStatement), `${context}: body branch foto-pertama wajib block`);
  assert.equal(branch.elseStatement, undefined, `${context}: branch foto-pertama tidak boleh punya else bypass`);
  const branchBlock = branch.parent;
  assert.ok(ts.isBlock(branchBlock), `${context}: branch foto-pertama wajib direct statement dalam block POST`);

  const gate = gateAwaits[0];
  const gateCall = gate.expression as ts.CallExpression;
  assert.equal(gateCall.arguments.length, 3, `${context}: brand terdaftar wajib diteruskan ke gate foto pertama`);
  assert.equal(gateCall.arguments[2].getText(ast), "merekTerdaftar(owned.product)",
    `${context}: gate wajib memakai brand otoritatif produk`);
  let current: ts.Node = gate;
  let reachedBranch = false;
  while (current.parent) {
    const parent = current.parent;
    if (parent === branch.thenStatement) { reachedBranch = true; break; }
    assert.ok(!functionBoundary(parent), `${context}: gate tidak boleh berada di fungsi nested`);
    assert.ok(
      !ts.isIfStatement(parent) && !ts.isConditionalExpression(parent)
      && !ts.isSwitchStatement(parent) && !ts.isCaseClause(parent) && !ts.isDefaultClause(parent)
      && !ts.isForStatement(parent) && !ts.isForInStatement(parent) && !ts.isForOfStatement(parent)
      && !ts.isWhileStatement(parent) && !ts.isDoStatement(parent)
      && !(ts.isBinaryExpression(parent) && [ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)),
      `${context}: awaited gate wajib unconditional di dalam branch foto-pertama`
    );
    if (ts.isCatchClause(parent)) assert.fail(`${context}: gate tidak boleh berada di catch`);
    if (ts.isTryStatement(parent)) {
      assert.equal(parent.catchClause, undefined, `${context}: gate failure tidak boleh dipulihkan catch sebelum persistence`);
      assert.ok(gate.getStart(ast) >= parent.tryBlock.getStart(ast) && gate.getEnd() <= parent.tryBlock.getEnd(),
        `${context}: gate wajib berada di try block, bukan finally`);
    }
    current = parent;
  }
  assert.ok(reachedBranch, `${context}: awaited gate wajib berada di branch foto-pertama exact`);
  assert.ok(
    (ts.isVariableDeclaration(gate.parent) && gate.parent.initializer === gate)
      || (ts.isExpressionStatement(gate.parent) && gate.parent.expression === gate),
    `${context}: gate wajib awaited call/initializer langsung, bukan expression bersyarat`
  );

  assert.ok(ts.isVariableDeclaration(gate.parent) && ts.isIdentifier(gate.parent.name),
    `${context}: hasil label wajib ditahan untuk keputusan merek`);
  const labelName = gate.parent.name.text;
  const brandRejects: ts.IfStatement[] = [];
  const collectBrandRejects = (node: ts.Node): void => {
    if (node !== branch.thenStatement && functionBoundary(node)) return;
    if (ts.isIfStatement(node)) {
      const condition = unwrap(node.expression);
      if (ts.isBinaryExpression(condition)
        && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        && condition.right.kind === ts.SyntaxKind.FalseKeyword
        && ts.isPropertyAccessExpression(condition.left)
        && ts.isIdentifier(condition.left.expression)
        && condition.left.expression.text === labelName
        && condition.left.name.text === "cocokMerek") brandRejects.push(node);
    }
    ts.forEachChild(node, collectBrandRejects);
  };
  collectBrandRejects(branch.thenStatement);
  assert.equal(brandRejects.length, 1, `${context}: cocokMerek === false wajib ditolak tepat sekali`);
  const brandReject = brandRejects[0];
  let throws = 0;
  const countThrows = (node: ts.Node): void => {
    if (node !== brandReject.thenStatement && functionBoundary(node)) return;
    if (ts.isThrowStatement(node)) throws += 1;
    ts.forEachChild(node, countThrows);
  };
  countThrows(brandReject.thenStatement);
  assert.ok(throws > 0, `${context}: branch brand-false wajib melempar sebelum persistence`);
  assert.ok(gate.getEnd() < brandReject.getStart(ast), `${context}: keputusan brand wajib memakai hasil gate aktual`);
  assert.ok(brandReject.getEnd() < persistenceCall.getStart(ast), `${context}: brand-false wajib ditolak sebelum persistence`);

  const persistence = persistenceCall.parent;
  let persistenceStatement: ts.Node = persistence;
  while (persistenceStatement.parent && persistenceStatement.parent !== branchBlock) persistenceStatement = persistenceStatement.parent;
  assert.ok(persistenceStatement.parent === branchBlock && ts.isStatement(persistenceStatement),
    `${context}: persistence wajib direct sibling branch foto-pertama`);
  const siblings = branchBlock.statements;
  assert.ok(siblings.indexOf(persistenceStatement as ts.Statement) > siblings.indexOf(branch),
    `${context}: persistence wajib direct sibling sesudah branch foto-pertama`);
  assert.ok(
    (ts.isVariableDeclaration(persistence.parent) && persistence.parent.initializer === persistence)
      || (ts.isExpressionStatement(persistence.parent) && persistence.parent.expression === persistence),
    `${context}: persistence wajib awaited call/initializer langsung`
  );
}

function parseSource(source: string, context: string) {
  return ts.createSourceFile(`${context}.ts`, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

function namedFunction(ast: ts.SourceFile, name: string) {
  return ast.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
}

function callName(call: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}

function callsNamed(root: ts.Node, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callName(node) === name) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function ancestor<T extends ts.Node>(node: ts.Node, predicate: (candidate: ts.Node) => candidate is T): T | undefined {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function assertReferenceRollbackHelper(source: string, context: string) {
  const ast = parseSource(source, context);
  const helper = namedFunction(ast, "rejectAfterReferenceCheck");
  assert.ok(helper?.body, `${context}: helper rollback exact wajib ada`);

  const deletes = callsNamed(helper.body, "deleteStoredProductImages");
  assert.equal(deletes.length, 1, `${context}: helper wajib tepat satu cleanup storage`);
  const deletion = deletes[0];
  assert.ok(ts.isAwaitExpression(deletion.parent) && deletion.parent.expression === deletion,
    `${context}: cleanup exact wajib di-await`);
  assert.equal(deletion.arguments.length, 1, `${context}: cleanup menerima tepat satu daftar`);
  assert.equal(deletion.arguments[0].getText(ast), "added", `${context}: cleanup hanya boleh menyasar added`);
  const cleanupTry = ancestor(deletion, ts.isTryStatement);
  assert.ok(cleanupTry?.catchClause, `${context}: kegagalan cleanup wajib ditangani secara observable`);
  assert.ok(deletion.getStart(ast) >= cleanupTry.tryBlock.getStart(ast) && deletion.getEnd() <= cleanupTry.tryBlock.getEnd(),
    `${context}: cleanup wajib berada di try block`);
  const cleanupCatch = cleanupTry.catchClause.getText(ast);
  assert.match(cleanupCatch, /throw new Error/, `${context}: cleanup failure tidak boleh dipulihkan atau disamarkan`);
  assert.match(cleanupCatch, /residual storage objects may remain/, `${context}: risiko residual wajib eksplisit`);
  const helperTail = helper.body.statements[helper.body.statements.length - 1];
  assert.ok(ts.isThrowStatement(helperTail) && ts.isIdentifier(helperTail.expression)
    && helperTail.expression.text === "referenceError", `${context}: cleanup sukses wajib melempar ulang error referensi asli`);
}

function assertReferenceRollbackBeforePublication(source: string, context: string, boundary: "E4" | "E8") {
  const ast = parseSource(source, context);
  const post = namedFunction(ast, "POST");
  assert.ok(post?.body && post.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    `${context}: exported POST wajib ada`);
  const appendName = boundary === "E4" ? "appendRetailProductImages" : "pgAppendOrgProductImages";
  const auditName = boundary === "E4" ? "auditBoth" : "pgAudit";
  const expectedCombined = boundary === "E4" ? "[...existing,...added]" : "[...owned.images,...added]";
  const save = callsNamed(post.body, "saveUniqueProductImages");
  const resolve = callsNamed(post.body, "referensiLayak");
  const allRollbacks = callsNamed(post.body, "rejectAfterReferenceCheck");
  const rollback = allRollbacks.filter((call) => call.arguments[2]?.getText(ast) === "referenceError");
  const append = callsNamed(post.body, appendName);
  const audit = callsNamed(post.body, auditName);
  assert.equal(save.length, 1, `${context}: wajib satu save ingestion`);
  assert.equal(resolve.length, 1, `${context}: wajib satu resolver referensi`);
  assert.equal(rollback.length, 1, `${context}: wajib satu rollback resolver`);
  assert.equal(allRollbacks.length, boundary === "E8" ? 2 : 1,
    `${context}: E8 wajib punya rollback resolver dan CAS miss saja`);
  assert.equal(append.length, 1, `${context}: wajib satu append list`);
  assert.equal(audit.length, 1, `${context}: wajib satu audit sukses`);
  if (boundary === "E8") {
    assert.equal(append[0].arguments.length, 5, `${context}: append E8 wajib menerima kontrak CAS lengkap`);
    assert.equal(append[0].arguments.slice(2).map((arg) => arg.getText(ast)).join(","),
      "owned.images,added,MAX_IMAGES",
      `${context}: append E8 wajib memakai exact snapshot yang dinilai`);
    const casRollback = allRollbacks.find((call) => call !== rollback[0]);
    assert.ok(casRollback, `${context}: CAS miss wajib membersihkan added`);
    assert.equal(casRollback.arguments[0]?.getText(ast), '"E8"', `${context}: CAS cleanup wajib boundary E8`);
    assert.equal(casRollback.arguments[1]?.getText(ast), "added", `${context}: CAS cleanup hanya menyasar added`);
    assert.ok(append[0].getEnd() < casRollback.getStart(ast), `${context}: CAS cleanup wajib sesudah append miss`);
    assert.ok(casRollback.getEnd() < audit[0].getStart(ast), `${context}: audit wajib sesudah CAS success boundary`);
  }
  assert.ok(ts.isAwaitExpression(rollback[0].parent) && rollback[0].parent.expression === rollback[0],
    `${context}: rollback failure boundary wajib di-await`);
  assert.equal(rollback[0].arguments.map((arg) => arg.getText(ast)).join(","), `"${boundary}",added,referenceError`,
    `${context}: rollback wajib menerima boundary, exact added, dan error resolver`);
  const referenceTry = ancestor(resolve[0], ts.isTryStatement);
  assert.ok(referenceTry?.catchClause, `${context}: resolver/no-reference wajib punya catch rollback`);
  const combined = referenceTry.tryBlock.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.filter((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === "semua"
    );
  });
  assert.equal(combined.length, 1, `${context}: daftar otoritatif existing+added wajib eksplisit`);
  assert.equal(combined[0].initializer?.getText(ast).replace(/\s/g, ""), expectedCombined,
    `${context}: resolver wajib memakai existing lalu exact added`);
  assert.ok(rollback[0].getStart(ast) >= referenceTry.catchClause.getStart(ast)
    && rollback[0].getEnd() <= referenceTry.catchClause.getEnd(), `${context}: rollback wajib berada di catch resolver`);
  assert.ok(save[0].getEnd() < resolve[0].getStart(ast), `${context}: resolver wajib sesudah ingestion`);
  assert.ok(resolve[0].getEnd() < rollback[0].getStart(ast), `${context}: rollback wajib menangani hasil/error resolver`);
  assert.ok(referenceTry.getEnd() < append[0].getStart(ast), `${context}: append list wajib sesudah failure boundary selesai`);
  assert.ok(append[0].getEnd() < audit[0].getStart(ast), `${context}: audit wajib sesudah append sukses`);
}

test("bawaan mode referensi adalah r2v, i2v hanya cadangan eksplisit", async () => {
  const { modeReferensi } = await import("../lib/providers/stubs/byteplus");
  const retail = { qualityTier: "high_quality", shots: [] } as never;
  // i2v merusak nama merek ("SCARLETT" -> "SCARLFTT") DAN memaksa pack shot di
  // detik pertama — yang kedua mustahil diperbaiki lewat prompt.
  // Jalur retail = SATU foto produk, tanpa referensi tambahan. Justru di situ
  // dulu selalu jatuh ke i2v.
  assert.equal(modeReferensi(retail, "dreamina-seedance-2-0-mini-260615"), "reference_image (r2v)");
  assert.equal(
    modeReferensi({ ...(retail as object), preferI2v: true } as never, "dreamina-seedance-2-0-mini-260615"),
    "first_frame (i2v)",
    "cadangan i2v harus bisa dipilih secara eksplisit"
  );
  // Model 1.0 tidak mendukung r2v sama sekali.
  assert.equal(modeReferensi(retail, "seedance-1-0-lite-i2v-250428"), "first_frame (i2v)");
  assert.match(baca("lib/providers/types.ts"), /preferI2v\?: boolean/, "cadangan i2v harus eksplisit");
});

test("arsip prompt mencatat mode yang BENAR-BENAR dikirim, bukan menurunkannya sendiri", async () => {
  // Jalankan STEP 2 (17 Agu) mencatat "first_frame (i2v)" untuk ketiga segmen
  // padahal provider mengirim r2v: arsip menyalin aturan lama. Arsip yang salah
  // mengarahkan pembedahan video jelek ke mode yang tidak pernah dipakai.
  const { ringkasSpec } = await import("../lib/arsip-prompt");
  const { modeReferensi } = await import("../lib/providers/stubs/byteplus");
  const model = "dreamina-seedance-2-0-mini-260615";
  const spec = {
    qualityTier: "high_quality",
    shots: [{ durationSec: 5, prompt: "p", imageRefPath: "a.png" }, { durationSec: 5, prompt: "q" }],
  } as never;
  const r = ringkasSpec(spec, model);
  assert.equal(r.model, model, "model harus ikut tercatat supaya modenya bisa diverifikasi ulang");
  assert.equal(r.shots[0].referenceMode, modeReferensi(spec, model), "harus SAMA dengan keputusan provider");
  assert.equal(r.shots[0].referenceMode, "reference_image (r2v)");
  assert.equal(r.shots[1].referenceMode, "text_to_video", "tanpa foto tetap text_to_video");
  // Aturannya hanya boleh punya satu salinan.
  assert.ok(!/extraReferenceImagePaths\?\.length \?\? 0\) > 0/.test(baca("lib/arsip-prompt.ts")),
    "arsip tidak boleh menurunkan ulang mode referensi");
});

test("presenter biasa memakai audio native; Story Ads senyap-provider dikecualikan", () => {
  const w = baca("lib/postgres/worker.ts");
  assert.match(w, /const isPresenterLipsync = shouldPreserveEmbeddedLipsync\(/,
    "worker tidak memakai keputusan audio presenter bersama");
  assert.match(w, /input\.format === "talking_head" \|\| input\.format === "tvc"/,
    "audio native bukan bawaan untuk format berpresenter");
  assert.match(w, /&& !isStructuredStoryAds\(input\.storyIdentity\)/,
    "Story Ads dengan dialog provider yang sengaja kosong masih memakai audio embedded");
  const p = baca("lib/media/shot-planner.ts");
  assert.match(p, /const lipSyncPresenter = format === "talking_head" \|\| format === "tvc"/);
  // Larangan itu dulu ada SEMATA karena VO-nya diganti Gemini TTS.
  assert.ok(!/no lip-sync to any specific words/.test(p) || /lipSyncPresenter/.test(p),
    "larangan lip-sync tidak boleh dipasang untuk presenter yang bicara sungguhan");
});

test("gerbang label intake memakai keyakinan OCR, bukan panjang huruf", () => {
  const s = baca("lib/media/label-terbaca.ts");
  // Percobaan pertama memakai panjang >=4 dan LOLOS pada foto AI-slop:
  // tesseract membaca "Sdadpgeer" dan "NNSONGO" sebagai kata.
  assert.match(s, /const MIN_CONF = 60/, "ambang keyakinan diturunkan dari sebaran terukur");
  assert.match(s, /"tsv"/, "butuh TSV untuk mendapat kolom keyakinan");
  assert.match(s, /Sdadpgeer/, "kenapa panjang huruf tidak cukup harus tertulis di kode");
  // Gerbangnya dipasang SEBELUM foto disimpan di kedua mutation boundary.
  // E4 wajib memeriksa SETIAP blob; E8 tetap kontrak foto-pertama task lain.
  const retail = baca("app/api/products/[id]/photos/route.ts");
  assert.match(retail, /periksaLabelFoto\(tmpFile, owned\.product\.name[,)]/);
  assertLabelGateBeforePersistence(retail, "E4 Retail", "E4");

  const enterprise = baca("app/api/dashboard/campaign/product/[id]/photos/route.ts");
  assert.match(enterprise, /periksaLabelFoto\(tmpFile, owned\.product\.name, merekTerdaftar\(owned\.product\)\)/);
  assertLabelGateBeforePersistence(enterprise, "E8 Enterprise", "E8");

  const e8Ditolak = [
    ["brand arg hilang", `export async function POST() {
      if (!owned.images.length && blobs[0]) {
        const label = await periksaLabelFoto(tmpFile, owned.product.name);
        if (label.cocokMerek === false) throw new Error("brand");
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["hasil brand dibuang", `export async function POST() {
      if (!owned.images.length && blobs[0]) {
        const label = await periksaLabelFoto(tmpFile, owned.product.name, merekTerdaftar(owned.product));
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["brand false tidak melempar", `export async function POST() {
      if (!owned.images.length && blobs[0]) {
        const label = await periksaLabelFoto(tmpFile, owned.product.name, merekTerdaftar(owned.product));
        if (label.cocokMerek === false) log(label);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["brand diperiksa setelah persistence", `export async function POST() {
      if (!owned.images.length && blobs[0]) {
        const label = await periksaLabelFoto(tmpFile, owned.product.name, merekTerdaftar(owned.product));
        await saveUniqueProductImages(id, blobs);
        if (label.cocokMerek === false) throw new Error("brand");
      }
    }`],
  ] as const;
  for (const [judul, source] of e8Ditolak) {
    assert.throws(
      () => assertLabelGateBeforePersistence(source, `counterexample E8 ${judul}`, "E8"),
      /brand terdaftar|brand otoritatif|cocokMerek|wajib melempar|sebelum persistence|direct sibling/,
      `${judul} tidak boleh memenangkan structural guard E8`
    );
  }

  const ditolak = [
    ["persistence sebelum label blob selesai", `export async function POST() {
      for (const blob of blobs) {
        await saveUniqueProductImages(id, blobs);
        await periksaLabelFoto(tmpFile, product.name);
      }
    }`],
    ["loop tetap dibatasi foto pertama", `export async function POST() {
      if (existing.length === 0) {
        for (const blob of blobs) await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["comment", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        // await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["string", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        const decoy = "await periksaLabelFoto(tmpFile, product.name)";
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["unrelated function", `async function helper() { await periksaLabelFoto(tmpFile, product.name); }
    export async function POST() {
      if (existing.length === 0 && blobs[0]) {}
      await saveUniqueProductImages(id, blobs);
    }`],
    ["unreachable block", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        if (false) { await periksaLabelFoto(tmpFile, product.name); }
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["persistence first", `export async function POST() {
      await saveUniqueProductImages(id, blobs);
      if (existing.length === 0 && blobs[0]) {
        await periksaLabelFoto(tmpFile, product.name);
      }
    }`],
    ["unawaited persistence first", `export async function POST() {
      saveUniqueProductImages(id, blobs);
      if (existing.length === 0 && blobs[0]) {
        await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["IIFE persistence first", `export async function POST() {
      (() => { saveUniqueProductImages(id, blobs); })();
      if (existing.length === 0 && blobs[0]) {
        await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["synchronous callback persistence first", `export async function POST() {
      [blobs[0]].forEach(() => { saveUniqueProductImages(id, blobs); });
      if (existing.length === 0 && blobs[0]) {
        await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["mutually exclusive if/else", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        if (flag) await periksaLabelFoto(tmpFile, product.name);
        else doSomethingElse();
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["catch persists after gate failure", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        try { await periksaLabelFoto(tmpFile, product.name); }
        catch { recover(); }
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["conditional short-circuit gate", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        skip || await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["do-loop break bypass", `export async function POST() {
      if (existing.length === 0 && blobs[0]) {
        do {
          if (skip) break;
          await periksaLabelFoto(tmpFile, product.name);
        } while (false);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
    ["decoy length", `export async function POST() {
      if (existing.length > 0 && decoy.length === 0 && blobs[0]) {
        await periksaLabelFoto(tmpFile, product.name);
      }
      await saveUniqueProductImages(id, blobs);
    }`],
  ] as const;
  for (const [judul, source] of ditolak) {
    assert.throws(
      () => assertLabelGateBeforePersistence(source, `counterexample ${judul}`, "E4"),
      /label gate aktual|persistence call total|langsung di-await|brand terdaftar|brand otoritatif|seluruh blobs|unconditional|dipulihkan catch|existing\.length|sesudah semua label awaits/,
      `${judul} tidak boleh memenangkan structural guard`
    );
  }
});

test("E4 dan E8 menjaga rollback exact setelah resolver dan sebelum append/audit", () => {
  const helper = baca("lib/reference-rejection-rollback.ts");
  const retail = baca("app/api/products/[id]/photos/route.ts");
  const org = baca("app/api/dashboard/campaign/product/[id]/photos/route.ts");
  assertReferenceRollbackHelper(helper, "shared production rollback helper");
  assertReferenceRollbackBeforePublication(retail, "E4 production rollback", "E4");
  assertReferenceRollbackBeforePublication(org, "E8 production rollback", "E8");

  const helperSah = `export async function rejectAfterReferenceCheck(boundary, added, referenceError) {
    try { await deleteStoredProductImages(added); }
    catch (cleanupError) { throw new Error("residual storage objects may remain"); }
    throw referenceError;
  }`;
  const postE8Sah = `export async function POST() {
    const added = await saveUniqueProductImages(id, blobs);
    try {
      const semua = [...owned.images, ...added];
      const layak = await referensiLayak(semua);
      if (!layak.length) throw referenceError;
    } catch (referenceError) {
      await rejectAfterReferenceCheck("E8", added, referenceError);
    }
    const images = await dependencies.pgAppendOrgProductImages(user.id, id, owned.images, added, MAX_IMAGES);
    if (!images) return await rejectAfterReferenceCheck("E8", added, staleError);
    dependencies.pgAudit(user.id, "product.photos_added", id, {});
  }`;
  assertReferenceRollbackHelper(helperSah, "shared structural control");
  assertReferenceRollbackBeforePublication(postE8Sah, "E8 structural control", "E8");

  const helperCounterexamples = [
    ["menghapus existing", `async function rejectAfterReferenceCheck(boundary, added, referenceError) {
      try { await deleteStoredProductImages(existing); }
      catch (cleanupError) { throw new Error("residual storage objects may remain"); }
      throw referenceError;
    }`],
    ["cleanup tidak awaited", `async function rejectAfterReferenceCheck(boundary, added, referenceError) {
      try { deleteStoredProductImages(added); }
      catch (cleanupError) { throw new Error("residual storage objects may remain"); }
      throw referenceError;
    }`],
    ["cleanup failure disamarkan", `async function rejectAfterReferenceCheck(boundary, added, referenceError) {
      try { await deleteStoredProductImages(added); }
      catch (cleanupError) { throw referenceError; }
      throw referenceError;
    }`],
  ] as const;
  for (const [name, source] of helperCounterexamples) {
    assert.throws(
      () => assertReferenceRollbackHelper(source, `counterexample shared rollback ${name}`),
      /cleanup exact wajib di-await|cleanup hanya boleh menyasar added|cleanup failure|risiko residual/,
      `${name} tidak boleh memenangkan structural guard helper rollback`
    );
  }

  const routeCounterexamples = [
    ["urutan daftar dibalik", postE8Sah.replace("[...owned.images, ...added]", "[...added, ...owned.images]")],
    ["boundary salah", postE8Sah.replace('"E8", added, referenceError', '"E4", added, referenceError')],
    ["append tanpa snapshot yang dinilai", postE8Sah.replace("owned.images, added, MAX_IMAGES", "added, MAX_IMAGES")],
    ["append masih di dalam failure boundary", `export async function POST() {
      const added = await saveUniqueProductImages(id, blobs);
      try {
        const semua = [...owned.images, ...added];
        const layak = await referensiLayak(semua);
        const images = await dependencies.pgAppendOrgProductImages(user.id, id, owned.images, added, MAX_IMAGES);
      } catch (referenceError) {
        await rejectAfterReferenceCheck("E8", added, referenceError);
      }
      dependencies.pgAudit(user.id, "product.photos_added", id, {});
    }`],
    ["rollback di luar catch", `export async function POST() {
      const added = await saveUniqueProductImages(id, blobs);
      const semua = [...owned.images, ...added];
      const layak = await referensiLayak(semua);
      await rejectAfterReferenceCheck("E8", added, referenceError);
      const images = await dependencies.pgAppendOrgProductImages(user.id, id, owned.images, added, MAX_IMAGES);
      dependencies.pgAudit(user.id, "product.photos_added", id, {});
    }`],
    ["resolver hilang", postE8Sah.replace("const layak = await referensiLayak(semua);", "const layak = semua;")],
  ] as const;
  for (const [name, source] of routeCounterexamples) {
    assert.throws(
      () => assertReferenceRollbackBeforePublication(source, `counterexample E8 rollback ${name}`, "E8"),
      /resolver referensi|boundary, exact added|existing lalu exact added|kontrak CAS lengkap|exact snapshot yang dinilai|rollback resolver dan CAS miss|CAS miss wajib|catch rollback|rollback wajib berada di catch|append list wajib sesudah failure boundary/,
      `${name} tidak boleh memenangkan structural guard route rollback`
    );
  }
});

test("ketidakcocokan nama adalah peringatan, bukan penolakan", () => {
  const s = baca("lib/media/label-terbaca.ts");
  // Menolak karena nama tak cocok akan menghukum penamaan yang wajar
  // (pengguna sering menulis nama lebih pendek daripada yang tercetak).
  assert.match(s, /cocokNama/, "ketidakcocokan dilaporkan");
  const blokir = s.slice(s.indexOf("if (kata.length < MIN_KATA)"), s.indexOf("const tokens"));
  assert.ok(!/cocokNama/.test(blokir.replace(/cocokNama: false/, "")),
    "hanya keterbacaan yang memblokir, bukan kecocokan nama");
});

test("ADR mencatat BUKTI, bukan kesimpulan", () => {
  const adr = baca("docs/spike-2026-08-17/ADR-001-referensi-audio-identitas.md");
  // Tes ini dulu menuntut kata "belum terbukti" — benar saat spike C belum
  // pernah jalan. Sekarang C SUDAH dijalankan dan jawabannya tegas, jadi yang
  // dijaga bergeser: responsnya harus dikutip apa adanya supaya siapa pun bisa
  // membantahnya dengan uji baru, bukan dengan pendapat.
  assert.match(adr, /may contain real person/, "respons penolakan dikutip persis");
  assert.match(adr, /Request id: 0217869633553829/, "request id bisa ditelusuri");
  assert.match(adr, /429/, "kenapa C sempat tertunda tetap tercatat");
  // Batas yang ditemukan sendiri tidak boleh hilang dari catatan.
  assert.match(adr, /perlu diperiksa sebelum dipakai/, "batas frame turunan harus tertulis");
});

test("referensi berwajah MATI secara bawaan, dengan alasan terukur", () => {
  const cfg = baca("lib/config.ts");
  assert.match(cfg, /seedanceFaceRef: env\("SEEDANCE_FACE_REF", "false"\)/, "bawaannya harus false");
  // Alasannya bukan kehati-hatian, tapi respons API yang tercatat.
  assert.match(cfg, /may contain real person/, "respons penolakan harus tertulis di kode");
  assert.match(cfg, /0217869633553829/, "request id disimpan supaya bisa ditelusuri");
  const adr = baca("docs/spike-2026-08-17/ADR-001-referensi-audio-identitas.md");
  assert.match(adr, /Seedance MENOLAK frame berwajah/);
  assert.match(adr, /Seedance MENERIMA frame tanpa wajah/);
  // Batas yang ditemukan sendiri harus ikut tercatat, bukan cuma keberhasilan.
  assert.match(adr, /dropper jadi pump/, "pergeseran bentuk produk di tahap turunan harus dicatat");
});

test("QC-F1 wajib: frame turunan diperiksa terhadap foto ASLI, bukan turunan sebelumnya", () => {
  const s = baca("lib/media/qc-frame.ts");
  const c = baca("lib/media/cast-ref.ts");
  // Menurunkan produk dari frame turunan membuat pergeseran menumpuk: percobaan
  // kedua akan setia pada botol yang sudah salah di percobaan pertama.
  assert.match(c, /productPhotoPath: input\.productPhotoPath/,
    "foto ASLI dikirim ulang tiap percobaan");
  assert.match(c, /const MAKS_ULANG = 2/, "gulung ulang dibatasi dua");
  // Dua pemeriksa, karena menangkap kegagalan yang berbeda.
  assert.match(s, /gemini-flash-latest/, "vision untuk bentuk/tutup/warna/tata letak");
  assert.match(s, /tesseract/, "OCR untuk huruf mereknya sendiri");
  assert.match(s, /tutup_sama/, "jenis tutup diperiksa — dropper bukan pump");
  // DIBALIK setelah temuan reviewer A10 (18 Agu).
  //
  // Aturan lama di sini berbunyi "gagal MEMERIKSA bukan gagal kesetiaan", dan
  // itu terdengar masuk akal sampai akibatnya terlihat: frame yang tidak pernah
  // diperiksa diteruskan sebagai referensi ke Seedance, dan gerbangnya jadi
  // hiasan justru saat paling dibutuhkan. Sekarang ada keadaan KETIGA.
  assert.match(s, /UNVERIFIED/, "tidak-bisa-diperiksa punya keadaan sendiri");
  assert.match(s, /TIDAK dipakai sebagai referensi|TIDAK boleh dipakai/,
    "frame yang tidak diperiksa tidak boleh jadi referensi");
  // Dicocokkan ke DEKLARASI PROPERTI, bukan ke teks mana pun: versi pertama
  // assertion ini menangkap komentar yang justru mendokumentasikan cacat
  // lamanya, lalu gagal karena dokumentasinya benar.
  assert.ok(!/^\s*lulus\??:/m.test(s), "field `lulus` harus hilang supaya UNVERIFIED tidak bisa dibaca sebagai lolos");
  assert.match(s, /export function bolehJadiReferensi/, "satu pintu untuk menanyakan boleh-tidaknya");
  // Ketat OCR mengikuti peran: hanya hero yang wajib.
  // Dinamai ulang jadi `hero` saat A10 diperbaiki; yang dijaga tetap sama —
  // hanya frame hero yang wajib mereknya terbaca OCR.
  assert.match(s, /const hero = \(input\.productState \?\? "hero"\) === "hero"/);
  assert.match(s, /ocr\.terbaca === false && hero/, "OCR hanya memblokir di frame hero");
});
