// P0-03 RED WAVE R1 (diamandemen) — W1 + W2 wajib lewat SATU API pusat.
//
// STATUS YANG DIHARAPKAN: MERAH pada 6623c4f.
//
// KONTRAK YANG DIKUNCI DI SINI (bukan tebakan, bukan pencarian nama):
//
//     modul  : lib/product-truth.ts
//     ekspor : resolveApprovedReference
//
// Kedua worker WAJIB mengimpor DAN memanggil fungsi itu dari modul itu. Test
// versi sebelumnya berburu kandidat lewat regex nama generik (/referensi|
// reference/i) — cara itu bisa lulus-palsu (fungsi lain yang kebetulan bernama
// mirip, seperti `bolehJadiReferensi` milik QC frame) DAN gagal-palsu (resolver
// yang benar tapi dinamai lain). Sekarang nama modul dan nama ekspornya
// ditetapkan, jadi test hanya bisa hijau kalau API pusatnya benar-benar ada dan
// benar-benar dipakai di KEDUA worker.
//
// KENAPA STRUKTURAL, BUKAN RUNTIME: W1 hidup di lib/postgres/worker.ts dan
// hanya bisa dijalankan dengan PostgreSQL nyata (dilarang di gelombang ini).
// Test ini TIDAK mengklaim menjalankan W1. Runtime W2 diuji terpisah di
// tests/product-truth-worker-reference.test.ts.
//
// LARANGAN YANG DIPATUHI: hanya baca berkas sumber. Nol jaringan, nol DB,
// nol provider, nol build, nol biner.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

/** Kontrak pusat yang harus dibangun perbaikan R2. */
const MODUL_PUSAT = "lib/product-truth";
const EKSPOR_PUSAT = "resolveApprovedReference";

const SUMBER = {
  W2: "lib/worker.ts",
  W1: "lib/postgres/worker.ts",
} as const;

const baca = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const teks = { W1: baca(SUMBER.W1), W2: baca(SUMBER.W2) };

type Impor = { modul: string; nama: string };

/** Impor bernama, dengan specifier relatif dinormalkan ke path repo-relatif. */
function importsDari(rel: string, isi: string): Impor[] {
  const dir = path.posix.dirname(rel);
  const hasil: Impor[] = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of isi.matchAll(re)) {
    const spesifier = m[2];
    const modul = spesifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(dir, spesifier)).replace(/\.(ts|tsx|js)$/, "")
      : spesifier;
    for (const potong of m[1].split(",")) {
      const nama = potong.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, "");
      if (nama) hasil.push({ modul, nama });
    }
  }
  return hasil;
}

test("harness: kedua sumber worker terbaca dan parser impor benar-benar bekerja", () => {
  for (const [label, rel] of Object.entries(SUMBER)) {
    assert.ok(teks[label as keyof typeof teks].length > 1000, `${rel} tidak terbaca / terlalu pendek`);
  }
  // Tanpa dua asersi ini, "tidak ada impor resolveApprovedReference" bisa
  // berarti "regexnya patah", bukan "kontraknya belum ada".
  const w1 = importsDari(SUMBER.W1, teks.W1);
  const w2 = importsDari(SUMBER.W2, teks.W2);
  assert.ok(w1.length + w2.length > 20, `parser impor hanya menemukan ${w1.length + w2.length} impor — regexnya patah`);
  for (const [label, daftar] of [["W1", w1], ["W2", w2]] as const) {
    assert.ok(
      daftar.some((i) => i.modul === "lib/media/person-safe-refs" && i.nama === "personSafeReferencePhotos"),
      `parser tidak menemukan impor personSafeReferencePhotos di ${label} padahal jelas-jelas ada — regexnya patah`
    );
  }
});

test(`API pusat ${MODUL_PUSAT}.ts ada dan mengekspor ${EKSPOR_PUSAT}`, () => {
  const abs = path.join(ROOT, `${MODUL_PUSAT}.ts`);
  assert.ok(
    fs.existsSync(abs),
    `Modul pusat ${MODUL_PUSAT}.ts BELUM ADA. Pemilihan referensi tersetujui tidak punya satu ` +
      "rumah pun, jadi setiap pemanggil terpaksa menyusun aturannya sendiri — dan itulah kenapa " +
      "W1 dan W2 bisa berbeda."
  );
  const isi = fs.readFileSync(abs, "utf8");
  assert.ok(
    new RegExp(`export\\s+(async\\s+)?function\\s+${EKSPOR_PUSAT}\\b`).test(isi) ||
      new RegExp(`export\\s+(const|let)\\s+${EKSPOR_PUSAT}\\b`).test(isi) ||
      new RegExp(`export\\s*\\{[^}]*\\b${EKSPOR_PUSAT}\\b`).test(isi),
    `${MODUL_PUSAT}.ts ada tapi tidak mengekspor ${EKSPOR_PUSAT}`
  );
});

test(`W1+W2: kedua worker mengimpor ${EKSPOR_PUSAT} dari ${MODUL_PUSAT}`, () => {
  const kurang: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER)) {
    const isi = teks[label as keyof typeof teks];
    const punya = importsDari(rel, isi).some((i) => i.modul === MODUL_PUSAT && i.nama === EKSPOR_PUSAT);
    if (!punya) kurang.push(`${rel} (${label})`);
  }
  assert.deepEqual(
    kurang,
    [],
    `Worker berikut TIDAK mengimpor ${EKSPOR_PUSAT} dari ${MODUL_PUSAT}:\n  ${kurang.join("\n  ")}\n` +
      "Selama pemilihan referensi tidak lewat satu API pusat, gerbang bukti yang dipasang di satu " +
      "worker tidak pernah berlaku di worker yang lain."
  );
});

test(`W1+W2: kedua worker benar-benar MEMANGGIL ${EKSPOR_PUSAT}`, () => {
  // Mengimpor tanpa memanggil adalah gerbang hias. Dipisah dari test impor
  // supaya pesan gagalnya menunjuk masalah yang tepat.
  const kurang: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER)) {
    const isi = teks[label as keyof typeof teks];
    if (!new RegExp(`\\b${EKSPOR_PUSAT}\\s*\\(`).test(isi)) kurang.push(`${rel} (${label})`);
  }
  assert.deepEqual(
    kurang,
    [],
    `Worker berikut tidak pernah MEMANGGIL ${EKSPOR_PUSAT}():\n  ${kurang.join("\n  ")}\n` +
      "Referensi utamanya masih dipilih dengan cara lain."
  );
});

test("W1+W2: tidak ada pengindeksan images[0] mentah di kedua worker", () => {
  const pola = /\bimages\s*\[\s*0\s*\]/g;
  const pelanggaran: string[] = [];
  for (const [label, rel] of Object.entries(SUMBER)) {
    const isi = teks[label as keyof typeof teks];
    isi.split("\n").forEach((baris, i) => {
      if (pola.test(baris)) pelanggaran.push(`${rel}:${i + 1}: ${baris.trim()}`);
      pola.lastIndex = 0;
    });
  }
  assert.deepEqual(
    pelanggaran,
    [],
    "Referensi utama masih dipilih dengan indeks array mentah — urutan unggah, bukan bukti:\n  " +
      pelanggaran.join("\n  ") +
      `\nPemilihan referensi harus lewat ${MODUL_PUSAT}.${EKSPOR_PUSAT}(), yang membaca sidecar, ` +
      "memverifikasi sha256 terhadap bytes tersimpan, memeriksa versiBukti, dan gagal-tertutup " +
      "kalau buktinya tidak sah."
  );
});
