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
// sumber. TIGA lubang nyata, dua dari ronde pertama dan satu dari ronde kedua:
//
//   1. HIJAU DARI KOMENTAR. `/\bresolveApprovedReference\s*\(/` cocok pada
//      baris komentar, pada string, bahkan pada blok kode yang sudah dimatikan.
//      Menempelkan satu komentar berisi nama itu di kedua worker cukup untuk
//      memenangkan test tanpa satu baris perilaku pun berubah.
//   2. BUTA TERHADAP `images.at(0)`. Pola `/images\s*\[\s*0\s*\]/` tidak
//      mengenali bentuk lain dari pemilihan posisional yang sama persis
//      salahnya. Menukar `images[0]` jadi `images.at(0)` membuat test hijau
//      sambil mempertahankan cacatnya utuh.
//   3. GERBANG HIAS (temuan Reviewer ronde kedua). Bahkan sesudah pindah ke
//      AST, memeriksa bahwa resolver DIPANGGIL masih tidak memeriksa bahwa
//      HASILNYA DIPAKAI. Counterexample-nya, verbatim:
//
//          await resolveApprovedReference(images);   // hasilnya dibuang
//          const [ref] = images;                     // posisi, bukan bukti
//          await mediaStorage().materialize(ref);    // kirim yang belum sah
//
//      Itu lolos ketiga pemeriksaan sebelumnya: resolver diimpor, dipanggil,
//      dipanggil atas `images`, dan tidak ada `images[0]` maupun
//      `images.at(0)` — destrukturisasi bukan keduanya. W1 tidak punya
//      cakupan runtime, jadi tidak ada satu pun jaring lain di bawahnya.
//
// Sekarang seluruh pemeriksaan struktural berjalan di atas AST TypeScript
// (`ts.createSourceFile`, `typescript` sudah devDependency dan dipakai
// `npx tsc --noEmit`). Komentar dan string literal bukan node sintaksis yang
// diperiksa. Bentuk `.at(n)` DAN destrukturisasi `const [x] = images`
// diperiksa eksplisit. Dan di atas semuanya ada gerbang ALIRAN DATA: setiap
// `materialize(...)` di kedua worker wajib menerima nilai yang turunannya
// berasal dari hasil resolver.
//
// Ketiga lubang itu TIDAK diklaim tertutup — mereka DIBUKTIKAN tertutup oleh
// counterexample yang dijalankan terhadap detektornya sendiri (dua test
// "counterexample detektor" di bawah, lima sumber sintetis). Detektor yang
// patah akan gagal di sana lebih dulu, sebelum sempat memberi vonis palsu
// tentang worker. Salah satu sumber sintetis adalah implementasi yang BENAR,
// jadi detektor yang terlalu ketat pun ketahuan di tempat yang sama.
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
  /** Pemilihan posisional atas daftar foto: `images[n]`, `images.at(n)`, `const [x] = images`. */
  posisional: { baris: number; teks: string }[];
  /** Setiap `materialize(...)` beserta apakah argumennya BERASAL dari hasil resolver. */
  materialize: { baris: number; teks: string; dariResolver: boolean }[];
  /** Seluruh impor bernama — dipakai pemeriksa kewarasan harness. */
  imporBernama: { modul: string; nama: string }[];
}

/** Apakah ekspresi ini menunjuk daftar foto (`images` atau `x.images`)? */
function menunjukDaftarFoto(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return node.text === DAFTAR_FOTO;
  if (ts.isPropertyAccessExpression(node)) return node.name.text === DAFTAR_FOTO;
  return false;
}

/** Apakah subtree ini menyebut identifier bernama X di mana pun? */
function menyebut(node: ts.Node, nama: Set<string> | string): boolean {
  const cocok = (t: string) => (typeof nama === "string" ? t === nama : nama.has(t));
  let ketemu = false;
  jelajah(node, (n) => {
    if (ts.isIdentifier(n) && cocok(n.text)) ketemu = true;
    if (ts.isPropertyAccessExpression(n) && typeof nama === "string" && n.name.text === nama) ketemu = true;
  });
  return ketemu;
}

/** Nama-nama yang diikat oleh satu binding (identifier, {a,b}, atau [a,b]). */
function namaTerikat(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const keluar: string[] = [];
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) continue;
    keluar.push(...namaTerikat(el.name));
  }
  return keluar;
}

/**
 * ANALISIS ASAL NILAI — hasil resolver harus SAMPAI ke materialize, dan nilai
 * mentah harus TIDAK sampai.
 *
 * Ronde 1 menambahkan pencemaran satu arah: nama yang menyebut hasil resolver
 * dianggap berasal darinya. Reviewer menembusnya dalam satu baris:
 *
 *     const raw = images.find(Boolean)!;
 *     const ref = hasil ? raw : raw;      // menyebut `hasil`, nilainya `raw`
 *     await mediaStorage().materialize(ref);
 *
 * `ref` "menyebut" nama tercemar, jadi ia ikut tercemar — padahal nilainya
 * SELALU datang dari `images` mentah. Menyebut bukan berasal-dari. Dan karena
 * W1 tidak punya cakupan runtime, gerbang inilah satu-satunya penjaganya.
 *
 * Karena itu sekarang DUA himpunan dilacak, dan syaratnya konjungtif:
 *
 *     resolver : nilai yang bisa berasal dari hasil resolveApprovedReference
 *     mentah   : nilai yang bisa berasal dari daftar `images` apa adanya
 *
 * Argumen `materialize()` diterima hanya bila ia menyebut sesuatu dari
 * `resolver` DAN tidak menyebut apa pun dari `mentah`. Contoh di atas menyebut
 * keduanya, jadi ia ditolak — yang benar, karena nilainya memang mentah.
 *
 * Saat menghitung `mentah`, subtree panggilan resolver DIPANGKAS. Tanpa itu
 * `const hasil = await resolveApprovedReference(images)` akan dianggap mentah
 * (ia memang menyebut `images`), dan implementasi yang BENAR justru tertolak.
 * Memangkasnya menyatakan hal yang tepat: menyerahkan daftar mentah KEPADA
 * resolver adalah cara satu-satunya yang sah untuk menyentuhnya.
 *
 * Ini tetap aproksimasi sintaksis, dan batasnya ditulis supaya tidak
 * disalahbaca: alias yang melewati pemanggilan fungsi lain tidak terlacak, dan
 * implementasi yang menamai daftar tersetujui `images` akan tertolak keliru
 * (nama itu memang sudah dipakai untuk daftar mentah di kedua worker).
 * Penjaga runtime yang sesungguhnya untuk W2 ada di
 * tests/product-truth-worker-reference.test.ts; W1 belum punya padanannya
 * karena butuh PostgreSQL.
 */
interface Asal {
  /** Nama yang terikat LANGSUNG ke objek hasil resolver (mis. `hasil`). */
  akar: Set<string>;
  /** Nama yang nilainya berasal dari jalur TERSETUJUI (`utama` / `tersetujui`). */
  tersetujui: Set<string>;
  /** Nama yang nilainya bisa berasal dari daftar `images` apa adanya. */
  mentah: Set<string>;
}

/**
 * Field hasil resolver yang BOLEH jadi sumber payload.
 *
 * `ditolak` SENGAJA tidak ada di sini, dan itu inti temuan Reviewer ronde 3:
 * versi sebelumnya mencemari seluruh binding hasil resolver, jadi
 * `materialize(hasil.ditolak[0].rel)` memenuhi gerbang — memakai persis gambar
 * yang baru saja dinyatakan TIDAK layak. Karena W1 belum punya test runtime,
 * gerbang statis inilah satu-satunya yang berdiri di sana.
 */
const FIELD_TERSETUJUI = new Set(["utama", "tersetujui"]);

function sebarAsal(sf: ts.SourceFile, binding: Set<string>, namespaceBinding: Set<string>): Asal {
  const akar = new Set<string>();
  const tersetujui = new Set<string>();
  const mentah = new Set<string>([DAFTAR_FOTO]);

  const dariResolver = (node: ts.Node): boolean => {
    if (!ts.isCallExpression(node)) return false;
    const e = node.expression;
    if (ts.isIdentifier(e) && binding.has(e.text)) return true;
    return (
      ts.isPropertyAccessExpression(e) &&
      ts.isIdentifier(e.expression) &&
      namespaceBinding.has(e.expression.text) &&
      e.name.text === EKSPOR_PUSAT
    );
  };

  const lepasBungkus = (n: ts.Node): ts.Node => {
    let cur = n;
    while (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
      cur = cur.expression;
    }
    return cur;
  };

  /**
   * Akses properti yang berakar pada objek hasil resolver, DAN properti
   * pertamanya adalah field tersetujui. `hasil.utama.rel` -> ya;
   * `hasil.ditolak[0].rel` -> TIDAK.
   */
  const jalurTersetujui = (node: ts.Node): boolean => {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    // Turun ke pangkal rantai, sambil mengingat properti terakhir sebelum akar.
    let cur: ts.Node = node;
    let propertiTerdekat: string | null = null;
    for (let i = 0; i < 32; i++) {
      if (ts.isPropertyAccessExpression(cur)) {
        propertiTerdekat = cur.name.text;
        cur = cur.expression;
      } else if (ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur)) {
        cur = cur.expression;
      } else if (ts.isCallExpression(cur)) {
        cur = cur.expression;
      } else break;
    }
    return ts.isIdentifier(cur) && akar.has(cur.text) && propertiTerdekat !== null && FIELD_TERSETUJUI.has(propertiTerdekat);
  };

  /** Menyebut nama dari himpunan, TANPA menuruni subtree panggilan resolver. */
  const menyebutTanpaResolver = (node: ts.Node, nama: Set<string>): boolean => {
    let ketemu = false;
    const turun = (n: ts.Node) => {
      if (dariResolver(n)) return; // pangkas: daftar mentah memang sah masuk ke sini
      if (ts.isIdentifier(n) && nama.has(n.text)) ketemu = true;
      if (ts.isPropertyAccessExpression(n) && nama.has(n.name.text)) ketemu = true;
      ts.forEachChild(n, turun);
    };
    turun(node);
    return ketemu;
  };

  /** Menyebut nilai yang berasal dari jalur tersetujui. */
  const menyebutTersetujui = (node: ts.Node): boolean => {
    let ketemu = false;
    const turun = (n: ts.Node) => {
      if (jalurTersetujui(n)) {
        ketemu = true;
        return;
      }
      if (ts.isIdentifier(n) && tersetujui.has(n.text)) ketemu = true;
      ts.forEachChild(n, turun);
    };
    turun(node);
    return ketemu;
  };

  // Benih. `const hasil = await resolve(...)` -> akar.
  // `const {utama, tersetujui} = await resolve(...)` -> hanya field tersetujui.
  jelajah(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    if (!dariResolver(lepasBungkus(node.initializer))) return;
    if (ts.isIdentifier(node.name)) {
      akar.add(node.name.text);
      return;
    }
    if (ts.isObjectBindingPattern(node.name)) {
      for (const el of node.name.elements) {
        const field = (el.propertyName ?? el.name) as ts.Node;
        const namaField = ts.isIdentifier(field) ? field.text : null;
        if (namaField && FIELD_TERSETUJUI.has(namaField)) {
          for (const n of namaTerikat(el.name)) tersetujui.add(n);
        }
      }
    }
  });

  // Titik tetap untuk kedua himpunan nilai.
  for (let putaran = 0; putaran < 12; putaran++) {
    const sebelum = tersetujui.size + mentah.size;
    jelajah(sf, (node) => {
      const sebar = (init: ts.Node, tambah: (jenis: "tersetujui" | "mentah") => void) => {
        if (menyebutTersetujui(init)) tambah("tersetujui");
        if (menyebutTanpaResolver(init, mentah)) tambah("mentah");
      };

      if (ts.isVariableDeclaration(node) && node.initializer) {
        const nama = namaTerikat(node.name);
        sebar(node.initializer, (jenis) => {
          for (const n of nama) (jenis === "tersetujui" ? tersetujui : mentah).add(n);
        });
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const nama = node.left.text;
        sebar(node.right, (jenis) => (jenis === "tersetujui" ? tersetujui : mentah).add(nama));
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.arguments.length > 0
      ) {
        const nama = node.expression.expression.text;
        for (const arg of node.arguments) {
          sebar(arg, (jenis) => (jenis === "tersetujui" ? tersetujui : mentah).add(nama));
        }
      }
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const nama: string[] = [];
        for (const d of node.initializer.declarations) nama.push(...namaTerikat(d.name));
        sebar(node.expression, (jenis) => {
          for (const n of nama) (jenis === "tersetujui" ? tersetujui : mentah).add(n);
        });
      }
    });
    if (tersetujui.size + mentah.size === sebelum) break;
  }
  return { akar, tersetujui, mentah };
}

/** Apakah ekspresi ini berasal dari jalur tersetujui hasil resolver? */
function dariJalurTersetujui(node: ts.Node, asal: Asal): boolean {
  let ketemu = false;
  const jalur = (n: ts.Node): boolean => {
    if (!ts.isPropertyAccessExpression(n) && !ts.isElementAccessExpression(n)) return false;
    let cur: ts.Node = n;
    let propertiTerdekat: string | null = null;
    for (let i = 0; i < 32; i++) {
      if (ts.isPropertyAccessExpression(cur)) {
        propertiTerdekat = cur.name.text;
        cur = cur.expression;
      } else if (ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur)) {
        cur = cur.expression;
      } else if (ts.isCallExpression(cur)) {
        cur = cur.expression;
      } else break;
    }
    return (
      ts.isIdentifier(cur) && asal.akar.has(cur.text) && propertiTerdekat !== null && FIELD_TERSETUJUI.has(propertiTerdekat)
    );
  };
  const turun = (n: ts.Node) => {
    if (jalur(n)) {
      ketemu = true;
      return;
    }
    if (ts.isIdentifier(n) && asal.tersetujui.has(n.text)) ketemu = true;
    ts.forEachChild(n, turun);
  };
  turun(node);
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

  const asal = sebarAsal(sf, binding, namespaceBinding);

  const panggilan: ts.CallExpression[] = [];
  const panggilanDenganDaftarFoto: ts.CallExpression[] = [];
  const posisional: { baris: number; teks: string }[] = [];
  const materialize: { baris: number; teks: string; dariResolver: boolean }[] = [];

  const posisi = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const ringkas = (node: ts.Node) => node.getText(sf).replace(/\s+/g, " ").trim();
  const catatPosisional = (node: ts.Node) => posisional.push({ baris: posisi(node), teks: ringkas(node) });

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
        if (node.arguments.some((arg) => menyebut(arg, DAFTAR_FOTO))) panggilanDenganDaftarFoto.push(node);
      }
      // (d) setiap materialize(): argumennya wajib turunan hasil resolver
      if (ts.isPropertyAccessExpression(ekspresi) && ekspresi.name.text === "materialize") {
        materialize.push({
          baris: posisi(node),
          teks: ringkas(node),
          // KONJUNGTIF: menyebut hasil resolver DAN tidak menyebut apa pun yang
          // bisa berasal dari daftar mentah. Syarat kedua itulah yang menutup
          // pencucian nilai lewat `hasil ? raw : raw`.
          // KONJUNGTIF, dan sisi kirinya kini SPESIFIK: nilainya harus datang
          // dari jalur TERSETUJUI (`utama`/`tersetujui`) — bukan sekadar dari
          // objek hasil resolver, karena `hasil.ditolak[0].rel` juga datang
          // dari objek itu dan justru gambar yang baru saja ditolak.
          dariResolver:
            node.arguments.length > 0 &&
            node.arguments.some((a) => dariJalurTersetujui(a, asal)) &&
            !node.arguments.some((a) => menyebut(a, asal.mentah)),
        });
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
      return;
    }

    // (e) `const [ref] = images` — destrukturisasi posisional. Bentuk KETIGA
    // dari cacat yang sama, dan yang lolos dari kedua detektor di atas.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      menunjukDaftarFoto(node.initializer as ts.Expression)
    ) {
      catatPosisional(node);
    }
  });

  return { binding: [...binding], panggilan, panggilanDenganDaftarFoto, posisional, materialize, imporBernama };
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
declare const mediaStorage: () => { materialize: (k: string) => Promise<string | null> };
const hasil = await resolveApprovedReference(images);
if (!hasil.utama) throw new Error("EVIDENCE_INVALID");
const imageRef = await mediaStorage().materialize(hasil.utama.rel);
for (const r of hasil.tersetujui.slice(1)) {
  await mediaStorage().materialize(r.rel);
}
// images[0] hanya di komentar, dan itu tidak boleh dihitung pelanggaran
`;

// COUNTEREXAMPLE YANG DIMINTA REVIEWER, verbatim dari temuannya:
// "await resolveApprovedReference(images); const [ref] = images; materialize(ref)"
// lolos call check dan lolos detektor posisional, sambil tetap memilih gambar
// pertama yang belum tersetujui. Dua cacat sekaligus, dan keduanya harus
// tertangkap: destrukturisasi posisional, DAN hasil resolver yang diabaikan.
const CONTOH_ABAI = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
declare const mediaStorage: () => { materialize: (k: string) => Promise<string | null> };
await resolveApprovedReference(images);
const [ref] = images;
const imageRef = await mediaStorage().materialize(ref);
`;

// Varian KETIGA, dan yang paling halus — dari temuan Reviewer ronde 2, verbatim:
// nilai selalu mentah, tapi ia "menyebut" hasil resolver dalam perjalanannya.
// Pencemaran satu arah menyatakan ini bersih; pelacakan asal dua arah tidak.
const CONTOH_ALIAS = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
declare const mediaStorage: () => { materialize: (k: string) => Promise<string | null> };
const hasil = await resolveApprovedReference(images);
const raw = images.find(Boolean)!;
const ref = hasil ? raw : raw;
const imageRef = await mediaStorage().materialize(ref);
`;

// Varian KEEMPAT — temuan Reviewer ronde 3. Nilainya BENAR-BENAR datang dari
// hasil resolver, tapi dari field `ditolak`: gambar yang baru saja dinyatakan
// TIDAK layak. Pelacakan asal yang hanya tahu "berasal dari objek hasil"
// meloloskannya; yang tahu FIELD MANA tidak.
const CONTOH_DITOLAK = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
declare const mediaStorage: () => { materialize: (k: string) => Promise<string | null> };
const hasil = await resolveApprovedReference(images);
const imageRef = await mediaStorage().materialize(hasil.ditolak[0].rel);
`;

// Varian kedua: hasil resolver DIPAKAI untuk sesuatu, tapi bukan untuk
// referensi yang dikirim. Gerbang yang hanya memeriksa "hasilnya dipakai di
// suatu tempat" akan lolos di sini.
const CONTOH_SALAH_ALAMAT = `
import { resolveApprovedReference } from "./product-truth";
declare const images: string[];
declare const mediaStorage: () => { materialize: (k: string) => Promise<string | null> };
const hasil = await resolveApprovedReference(images);
console.log(hasil.ditolak.length);
const imageRef = await mediaStorage().materialize(images[0]);
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
  assert.equal(baik.materialize.length, 2, "detektor materialize tidak menemukan kedua panggilan");
  assert.deepEqual(
    baik.materialize.map((m) => m.dariResolver),
    [true, true],
    "aliran data dari hasil resolver ke materialize tidak terdeteksi — detektor akan menolak " +
      "implementasi yang BENAR, dan itu lebih berbahaya daripada meloloskan yang salah"
  );
});

test("counterexample detektor: hasil resolver yang DIABAIKAN tertangkap (destrukturisasi + salah alamat)", () => {
  // Inilah counterexample Reviewer. Kalau test ini hijau lewat asersi di bawah,
  // gerbang wiring tidak bisa lagi dipuaskan oleh panggilan hiasan.
  const abai = analisis("lib/contoh-abai.ts", CONTOH_ABAI);
  assert.deepEqual(abai.binding, [EKSPOR_PUSAT], "prasyarat: impornya memang sungguhan");
  assert.equal(abai.panggilan.length, 1, "prasyarat: resolver memang DIPANGGIL");
  assert.equal(abai.panggilanDenganDaftarFoto.length, 1, "prasyarat: dipanggil atas daftar images");
  assert.deepEqual(
    abai.posisional.map((p) => p.teks),
    ["[ref] = images"],
    "destrukturisasi posisional `const [ref] = images` tidak tertangkap — ia bukan images[0] " +
      "dan bukan images.at(0), jadi kedua detektor lama buta terhadapnya"
  );
  assert.deepEqual(
    abai.materialize.map((m) => m.dariResolver),
    [false],
    "materialize(ref) dianggap berasal dari resolver padahal hasilnya dibuang — analisis " +
      "aliran datanya tidak bekerja"
  );

  // Counterexample Reviewer ronde 2: nilainya SELALU mentah, tapi ia menyebut
  // `hasil` dalam perjalanannya. Ini yang menembus pencemaran satu arah.
  const alias = analisis("lib/contoh-alias.ts", CONTOH_ALIAS);
  assert.equal(alias.panggilan.length, 1, "prasyarat: resolver dipanggil");
  assert.deepEqual(alias.posisional, [], "prasyarat: tidak ada indeks/destrukturisasi terlarang");
  assert.deepEqual(
    alias.materialize.map((m) => m.dariResolver),
    [false],
    "`const ref = hasil ? raw : raw` dinyatakan berasal dari resolver padahal nilainya SELALU " +
      "dari images mentah. Menyebut bukan berasal-dari — dan karena ini satu-satunya penjaga W1, " +
      "kekeliruan itu tidak tertangkap siapa pun di bawahnya."
  );

  // Counterexample Reviewer ronde 3: nilainya memang dari hasil resolver, tapi
  // dari field `ditolak`. Ini material untuk W1, yang belum punya test runtime.
  const ditolak = analisis("lib/contoh-ditolak.ts", CONTOH_DITOLAK);
  assert.equal(ditolak.panggilan.length, 1, "prasyarat: resolver dipanggil");
  assert.deepEqual(ditolak.posisional, [], "prasyarat: tidak ada pemilihan posisional");
  assert.deepEqual(
    ditolak.materialize.map((m) => m.dariResolver),
    [false],
    "materialize(hasil.ditolak[0].rel) dianggap sah. Itu memakai persis gambar yang baru saja " +
      "dinyatakan TIDAK layak — dan karena W1 belum punya test runtime, gerbang statis inilah " +
      "satu-satunya yang berdiri di sana."
  );

  const salahAlamat = analisis("lib/contoh-salah-alamat.ts", CONTOH_SALAH_ALAMAT);
  assert.equal(salahAlamat.panggilan.length, 1, "prasyarat: resolver dipanggil");
  assert.deepEqual(
    salahAlamat.materialize.map((m) => m.dariResolver),
    [false],
    "hasil resolver dipakai untuk logging lalu materialize tetap memakai images[0]; " +
      "gerbang yang hanya memeriksa \"hasilnya dipakai di suatu tempat\" lolos di sini"
  );
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

test("W1+W2: setiap materialize() memakai hasil resolver, bukan daftar mentah", () => {
  // Gerbang penentu. Impor + panggilan + tidak ada indeks mentah masih bisa
  // dipenuhi oleh resolver yang hasilnya dibuang; yang tidak bisa dipalsukan
  // adalah ALIRAN DATA-nya sampai ke pengambilan payload.
  //
  // Berlaku untuk SELURUH materialize di kedua worker, bukan hanya referensi
  // utama: foto ke-2 dst juga dikirim ke model sebagai referensi identitas,
  // jadi keduanya sama-sama harus berasal dari daftar tersetujui.
  const pelanggaran: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER) as [Label, string][]) {
    const a = hasil[label];
    if (a.materialize.length === 0) {
      pelanggaran.push(`${rel} (${label}): tidak ada materialize() sama sekali — fixture/parser salah`);
      continue;
    }
    for (const m of a.materialize) {
      if (!m.dariResolver) pelanggaran.push(`${rel}:${m.baris}: ${m.teks}`);
    }
  }
  assert.deepEqual(
    pelanggaran,
    [],
    "Payload referensi diambil dari nilai yang TIDAK berasal dari hasil resolver:\n  " +
      pelanggaran.join("\n  ") +
      `\nMemanggil ${EKSPOR_PUSAT}() lalu membuang hasilnya adalah gerbang hias. Nilai yang ` +
      "di-materialize wajib turunan dari daftar tersetujui yang dikembalikan resolver."
  );
});

test(`W1+W2: tidak ada pemilihan posisional atas \`${DAFTAR_FOTO}\` (${DAFTAR_FOTO}[n], ${DAFTAR_FOTO}.at(n), MAUPUN destrukturisasi)`, () => {
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
