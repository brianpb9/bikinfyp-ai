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
  const persistenceAwaits: ts.AwaitExpression[] = [];
  const collectCalls = (node: ts.Node): void => {
    if (node !== post && functionBoundary(node)) return;
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      const callee = node.expression.expression;
      if (ts.isIdentifier(callee) && callee.text === "periksaLabelFoto") gateAwaits.push(node);
      if (ts.isIdentifier(callee) && callee.text === "saveUniqueProductImages") persistenceAwaits.push(node);
    }
    ts.forEachChild(node, collectCalls);
  };
  collectCalls(post.body);
  assert.equal(gateAwaits.length, 1, `${context}: wajib tepat satu awaited label gate aktual di POST`);
  assert.equal(persistenceAwaits.length, 1, `${context}: wajib tepat satu awaited persistence aktual di POST`);

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
  const retailEmpty = (expression: ts.Expression): boolean => {
    expression = unwrap(expression);
    if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
    const left = unwrap(expression.left); const right = unwrap(expression.right);
    return ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.expression)
      && left.expression.text === "existing" && left.name.text === "length"
      && ts.isNumericLiteral(right) && right.text === "0";
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
    return (route === "E4" ? retailEmpty(expression.left) : enterpriseEmpty(expression.left))
      && firstBlob(expression.right);
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

  const persistence = persistenceAwaits[0];
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

test("presenter yang terlihat benar-benar bicara, bukan dibungkam", () => {
  const w = baca("lib/postgres/worker.ts");
  assert.match(w, /const isPresenterLipsync = format === "talking_head" \|\| format === "tvc"/,
    "audio native jadi bawaan untuk format berpresenter");
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
  // Gerbangnya dipasang SEBELUM foto disimpan di kedua mutation boundary:
  // E4 Retail dan E8 Enterprise. Persistence production kini memakai helper
  // dedupe, bukan saveProductImages lama.
  const retail = baca("app/api/products/[id]/photos/route.ts");
  assert.match(retail, /periksaLabelFoto\(tmpFile, owned\.product\.name[,)]/);
  assertLabelGateBeforePersistence(retail, "E4 Retail", "E4");

  const enterprise = baca("app/api/dashboard/campaign/product/[id]/photos/route.ts");
  assert.match(enterprise, /periksaLabelFoto\(tmpFile, owned\.product\.name\)/);
  assertLabelGateBeforePersistence(enterprise, "E8 Enterprise", "E8");

  const ditolak = [
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
      /label gate aktual|kondisi E4 exact|unconditional|dipulihkan catch|direct sibling|sesudah branch/,
      `${judul} tidak boleh memenangkan structural guard`
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
