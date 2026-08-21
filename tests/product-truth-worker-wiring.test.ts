// P0-03 RED WAVE R2 (P0-A) — W1 + W2 wajib lewat SATU API pusat.
//
// KONTRAK YANG DIKUNCI DI SINI (bukan tebakan, bukan pencarian nama):
//
//     modul  : lib/product-truth.ts
//     ekspor : resolveApprovedReference
//
// KENAPA BERKAS INI DITULIS ULANG DENGAN AST (temuan Reviewer, 21 Agu).
//
// Versi R1 memeriksa impor, panggilan, dan `images[0]` dengan REGEX atas teks
// sumber. Dua lubang nyata:
//
//   1. HIJAU DARI KOMENTAR. `/\bresolveApprovedReference\s*\(/` cocok pada
//      baris komentar, pada string, bahkan pada blok kode yang sudah dimatikan.
//      Menempelkan satu komentar berisi nama itu di kedua worker cukup untuk
//      memenangkan test tanpa satu baris perilaku pun berubah.
//   2. BUTA TERHADAP `images.at(0)`. Pola `/images\s*\[\s*0\s*\]/` tidak
//      mengenali bentuk lain dari pemilihan posisional yang sama persis
//      salahnya. Menukar `images[0]` jadi `images.at(0)` membuat test hijau
//      sambil mempertahankan cacatnya utuh.
//
// Sekarang seluruh pemeriksaan struktural berjalan di atas AST TypeScript
// (`ts.createSourceFile`, `typescript` sudah devDependency dan dipakai
// `npx tsc --noEmit`). Komentar dan string literal bukan node sintaksis yang
// diperiksa, jadi keduanya tidak bisa lagi memenangkan test. Bentuk `.at(n)`
// diperiksa eksplisit.
//
// Ketiga lubang itu TIDAK diklaim tertutup — mereka DIBUKTIKAN tertutup oleh
// tiga counterexample yang dijalankan terhadap detektornya sendiri (test
// "counterexample detektor" di bawah). Detektor yang patah akan gagal di sana
// lebih dulu, sebelum sempat memberi vonis palsu tentang worker.
//
// API pusatnya sendiri diperiksa lewat RUNTIME BINDING (`await import`), bukan
// regex `export function` atas teksnya: berkas yang isinya hanya komentar
// bernama benar tidak bisa lolos.
//
// KENAPA STRUKTURAL, BUKAN RUNTIME, UNTUK WORKER: W1 hidup di
// lib/postgres/worker.ts dan hanya bisa dijalankan dengan PostgreSQL nyata
// (dilarang di gelombang ini). Test ini TIDAK mengklaim menjalankan W1.
// Runtime W2 diuji terpisah di tests/product-truth-worker-reference.test.ts,
// dan itulah yang menutup celah "resolver palsu yang diimpor lalu dipanggil
// tapi tidak melakukan apa-apa".
//
// LARANGAN YANG DIPATUHI: hanya baca berkas sumber + satu dynamic import atas
// modul pusat. Nol jaringan, nol DB, nol provider, nol build, nol biner.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

/** Kontrak pusat yang harus dibangun perbaikan R2. */
const MODUL_PUSAT = "lib/product-truth";
const EKSPOR_PUSAT = "resolveApprovedReference";

/** Nama daftar foto produk. Pemilihan posisional atas daftar inilah cacatnya. */
const DAFTAR_FOTO = "images";

const SUMBER = {
  W2: "lib/worker.ts",
  W1: "lib/postgres/worker.ts",
} as const;

type Label = keyof typeof SUMBER;

// ---------------------------------------------------------------- AST helper

function parse(rel: string, isi: string): ts.SourceFile {
  return ts.createSourceFile(rel, isi, ts.ScriptTarget.ESNext, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

function jelajah(node: ts.Node, kunjungi: (n: ts.Node) => void): void {
  kunjungi(node);
  ts.forEachChild(node, (anak) => jelajah(anak, kunjungi));
}

/** Specifier relatif dinormalkan ke path repo-relatif tanpa ekstensi. */
function normalkanModul(relBerkas: string, spesifier: string): string {
  if (!spesifier.startsWith(".")) return spesifier;
  const dir = path.posix.dirname(relBerkas);
  return path.posix.normalize(path.posix.join(dir, spesifier)).replace(/\.(ts|tsx|js|mjs)$/, "");
}

interface Analisis {
  /** Nama lokal yang benar-benar TERIKAT ke EKSPOR_PUSAT dari MODUL_PUSAT. */
  binding: string[];
  /** Panggilan atas binding itu. */
  panggilan: ts.CallExpression[];
  /** Panggilan atas binding itu yang menerima daftar foto sebagai argumen. */
  panggilanDenganDaftarFoto: ts.CallExpression[];
  /** Pemilihan posisional atas daftar foto: `images[n]` DAN `images.at(n)`. */
  posisional: { baris: number; teks: string }[];
  /** Seluruh impor bernama — dipakai pemeriksa kewarasan harness. */
  imporBernama: { modul: string; nama: string }[];
}

/** Apakah ekspresi ini menunjuk daftar foto (`images` atau `x.images`)? */
function menunjukDaftarFoto(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === DAFTAR_FOTO;
  if (ts.isPropertyAccessExpression(node)) return node.name.text === DAFTAR_FOTO;
  return false;
}

/** Apakah subtree ini menyebut daftar foto di mana pun? */
function menyebutDaftarFoto(node: ts.Node): boolean {
  let ketemu = false;
  jelajah(node, (n) => {
    if ((ts.isIdentifier(n) && n.text === DAFTAR_FOTO) || (ts.isPropertyAccessExpression(n) && n.name.text === DAFTAR_FOTO)) {
      ketemu = true;
    }
  });
  return ketemu;
}

function analisis(rel: string, isi: string): Analisis {
  const sf = parse(rel, isi);
  const binding = new Set<string>();
  const namespaceBinding = new Set<string>();
  const imporBernama: { modul: string; nama: string }[] = [];

  // Lewat satu: kumpulkan binding impor yang SUNGGUHAN (node ImportDeclaration).
  jelajah(sf, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const modul = normalkanModul(rel, node.moduleSpecifier.text);
    const clause = node.importClause;
    if (!clause) return;
    // `import type { ... }` tidak menghasilkan nilai runtime — bukan wiring.
    if (clause.isTypeOnly) return;
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const namaEkspor = (el.propertyName ?? el.name).text;
        imporBernama.push({ modul, nama: namaEkspor });
        if (el.isTypeOnly) continue;
        if (modul === MODUL_PUSAT && namaEkspor === EKSPOR_PUSAT) binding.add(el.name.text);
      }
    } else if (ts.isNamespaceImport(bindings) && modul === MODUL_PUSAT) {
      namespaceBinding.add(bindings.name.text);
    }
  });

  const panggilan: ts.CallExpression[] = [];
  const panggilanDenganDaftarFoto: ts.CallExpression[] = [];
  const posisional: { baris: number; teks: string }[] = [];

  const catatPosisional = (node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    posisional.push({ baris: line + 1, teks: node.getText(sf).replace(/\s+/g, " ").trim() });
  };

  jelajah(sf, (node) => {
    // (a) panggilan resolver pusat
    if (ts.isCallExpression(node)) {
      const ekspresi = node.expression;
      const lewatBinding = ts.isIdentifier(ekspresi) && binding.has(ekspresi.text);
      const lewatNamespace =
        ts.isPropertyAccessExpression(ekspresi) &&
        ts.isIdentifier(ekspresi.expression) &&
        namespaceBinding.has(ekspresi.expression.text) &&
        ekspresi.name.text === EKSPOR_PUSAT;
      if (lewatBinding || lewatNamespace) {
        panggilan.push(node);
        if (node.arguments.some((arg) => menyebutDaftarFoto(arg))) panggilanDenganDaftarFoto.push(node);
      }
    }

    // (b) `images[n]` — ElementAccessExpression dengan indeks numerik literal
    if (
      ts.isElementAccessExpression(node) &&
      menunjukDaftarFoto(node.expression) &&
      ts.isNumericLiteral(node.argumentExpression)
    ) {
      catatPosisional(node);
      return;
    }

    // (c) `images.at(n)` dan `images.at(-n)` — bentuk lain dari cacat yang sama
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "at" &&
      menunjukDaftarFoto(node.expression.expression) &&
      node.arguments.length === 1 &&
      (ts.isNumericLiteral(node.arguments[0]) ||
        (ts.isPrefixUnaryExpression(node.arguments[0]) && ts.isNumericLiteral(node.arguments[0].operand)))
    ) {
      catatPosisional(node);
    }
  });

  return { binding: [...binding], panggilan, panggilanDenganDaftarFoto, posisional, imporBernama };
}

const baca = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const teks: Record<Label, string> = { W1: baca(SUMBER.W1), W2: baca(SUMBER.W2) };
const hasil: Record<Label, Analisis> = {
  W1: analisis(SUMBER.W1, teks.W1),
  W2: analisis(SUMBER.W2, teks.W2),
};

// ------------------------------------------------- counterexample: detektornya

// Tiga contoh sintetis yang menjawab persis tiga cara test ini bisa berbohong.
// Kalau detektornya patah, dia gagal DI SINI — bukan diam-diam meloloskan
// worker yang masih cacat.

const CONTOH_BURUK = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
declare const produk: { images: string[] };
const a = images[0];
const b = images.at(0);
const c = produk.images[1];
const d = produk.images.at(-1);
`;

const CONTOH_PALSU = `
// import { resolveApprovedReference } from "./product-truth";
// const r = resolveApprovedReference(images);
const s = "resolveApprovedReference(images)";
const t = \`images[0] di dalam template string\`;
/* images.at(0) di dalam blok komentar */
declare const images: string[];
`;

const CONTOH_BAIK = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
const hasil = await resolveApprovedReference(images);
const rel = hasil.utama?.rel;
// images[0] hanya di komentar, dan itu tidak boleh dihitung pelanggaran
`;

test("counterexample detektor: images.at(0) tertangkap, komentar/string TIDAK dihitung", () => {
  const buruk = analisis("lib/contoh-buruk.ts", CONTOH_BURUK);
  assert.deepEqual(
    buruk.posisional.map((p) => p.teks),
    ["images[0]", "images.at(0)", "produk.images[1]", "produk.images.at(-1)"],
    "detektor posisional tidak menangkap keempat bentuk — termasuk .at(0) yang jadi lubang regex R1"
  );

  const palsu = analisis("lib/contoh-palsu.ts", CONTOH_PALSU);
  assert.deepEqual(palsu.binding, [], "impor DI DALAM KOMENTAR dihitung sebagai binding — persis lubang regex R1");
  assert.equal(palsu.panggilan.length, 0, "panggilan di komentar/string dihitung — test bisa hijau tanpa perilaku berubah");
  assert.deepEqual(palsu.posisional, [], "images[0]/images.at(0) di komentar & string dihitung sebagai pelanggaran");

  const baik = analisis("lib/contoh-baik.ts", CONTOH_BAIK);
  assert.deepEqual(baik.binding, [EKSPOR_PUSAT], "impor sungguhan tidak terdeteksi — detektor gagal-palsu");
  assert.equal(baik.panggilan.length, 1, "panggilan sungguhan tidak terdeteksi — detektor gagal-palsu");
  assert.equal(baik.panggilanDenganDaftarFoto.length, 1, "argumen daftar foto tidak terdeteksi");
  assert.deepEqual(baik.posisional, [], "komentar di sumber yang benar dihitung sebagai pelanggaran");
});

test("harness: kedua sumber worker terbaca dan AST-nya benar-benar terurai", () => {
  for (const [label, rel] of Object.entries(SUMBER) as [Label, string][]) {
    assert.ok(teks[label].length > 1000, `${rel} tidak terbaca / terlalu pendek`);
  }
  // Tanpa dua asersi ini, "tidak ada impor resolveApprovedReference" bisa
  // berarti "AST walker-nya patah", bukan "kontraknya belum ada".
  const total = hasil.W1.imporBernama.length + hasil.W2.imporBernama.length;
  assert.ok(total > 20, `AST hanya menemukan ${total} impor bernama di kedua worker — walker-nya patah`);
  for (const label of ["W1", "W2"] as const) {
    assert.ok(
      hasil[label].imporBernama.some(
        (i) => i.modul === "lib/media/person-safe-refs" && i.nama === "personSafeReferencePhotos"
      ),
      `AST tidak menemukan impor personSafeReferencePhotos di ${label} padahal jelas-jelas ada — walker-nya patah`
    );
  }
});

// ------------------------------------------------------------- kontrak pusat

test(`API pusat ${MODUL_PUSAT}.ts ada dan BENAR-BENAR mengekspor ${EKSPOR_PUSAT} (runtime binding)`, async () => {
  const abs = path.join(ROOT, `${MODUL_PUSAT}.ts`);
  assert.ok(
    fs.existsSync(abs),
    `Modul pusat ${MODUL_PUSAT}.ts BELUM ADA. Pemilihan referensi tersetujui tidak punya satu ` +
      "rumah pun, jadi setiap pemanggil terpaksa menyusun aturannya sendiri — dan itulah kenapa " +
      "W1 dan W2 bisa berbeda."
  );
  // Runtime binding, bukan regex atas teks: berkas berisi komentar bernama
  // benar tidak bisa memenangkan test ini.
  let modul: Record<string, unknown>;
  try {
    modul = (await import(`../${MODUL_PUSAT}`)) as Record<string, unknown>;
  } catch (err) {
    assert.fail(`${MODUL_PUSAT}.ts ada tapi tidak bisa di-import: ${(err as Error).message}`);
  }
  assert.equal(
    typeof modul[EKSPOR_PUSAT],
    "function",
    `${MODUL_PUSAT}.ts ada tapi ${EKSPOR_PUSAT} bukan fungsi yang bisa dipanggil saat runtime`
  );
});

// --------------------------------------------------------------- wiring W1+W2

test(`W1+W2: kedua worker mengimpor ${EKSPOR_PUSAT} dari ${MODUL_PUSAT} (AST, bukan teks)`, () => {
  const kurang: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER) as [Label, string][]) {
    if (hasil[label].binding.length === 0) kurang.push(`${rel} (${label})`);
  }
  assert.deepEqual(
    kurang,
    [],
    `Worker berikut TIDAK mengimpor ${EKSPOR_PUSAT} dari ${MODUL_PUSAT}:\n  ${kurang.join("\n  ")}\n` +
      "Selama pemilihan referensi tidak lewat satu API pusat, gerbang bukti yang dipasang di satu " +
      "worker tidak pernah berlaku di worker yang lain."
  );
});

test(`W1+W2: kedua worker MEMANGGIL ${EKSPOR_PUSAT} atas daftar ${DAFTAR_FOTO}`, () => {
  // Mengimpor tanpa memanggil adalah gerbang hias; memanggil atas daftar LAIN
  // adalah gerbang yang salah alamat. Keduanya diperiksa di satu tempat karena
  // keduanya berarti hal yang sama: referensi utama masih dipilih dengan cara
  // lain.
  const kurang: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER) as [Label, string][]) {
    const a = hasil[label];
    if (a.panggilan.length === 0) kurang.push(`${rel} (${label}): tidak pernah memanggil ${EKSPOR_PUSAT}()`);
    else if (a.panggilanDenganDaftarFoto.length === 0)
      kurang.push(`${rel} (${label}): memanggil ${EKSPOR_PUSAT}() tapi tidak pernah atas daftar \`${DAFTAR_FOTO}\``);
  }
  assert.deepEqual(
    kurang,
    [],
    `Wiring resolver belum benar:\n  ${kurang.join("\n  ")}\n` +
      "Referensi utamanya masih dipilih dengan cara lain."
  );
});

test(`W1+W2: tidak ada pemilihan posisional atas \`${DAFTAR_FOTO}\` (${DAFTAR_FOTO}[n] MAUPUN ${DAFTAR_FOTO}.at(n))`, () => {
  const pelanggaran: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER) as [Label, string][]) {
    for (const p of hasil[label].posisional) pelanggaran.push(`${rel}:${p.baris}: ${p.teks}`);
  }
  assert.deepEqual(
    pelanggaran,
    [],
    "Referensi utama masih dipilih dengan posisi — urutan unggah, bukan bukti:\n  " +
      pelanggaran.join("\n  ") +
      `\nPemilihan referensi harus lewat ${MODUL_PUSAT}.${EKSPOR_PUSAT}(), yang membaca sidecar, ` +
      "memverifikasi sha256 terhadap bytes tersimpan, memeriksa versiBukti, dan gagal-tertutup " +
      "kalau buktinya tidak sah."
  );
});
