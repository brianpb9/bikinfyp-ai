// P0-03 RED WAVE R1 — W1 + W2 harus melewati SATU resolver referensi bersama.
//
// STATUS YANG DIHARAPKAN: MERAH pada 66b4b33.
//
// KENAPA STRUKTURAL, BUKAN RUNTIME: W1 hidup di lib/postgres/worker.ts dan
// hanya bisa dijalankan dengan PostgreSQL nyata (dilarang di gelombang ini).
// Test ini TIDAK mengklaim menjalankan W1. Yang ia buktikan adalah bentuk
// kodenya: dua worker yang masing-masing punya logika pemilihan referensi
// sendiri akan selalu berbeda pelan-pelan, dan gerbang yang hanya dipasang di
// satu worker bukan gerbang. Runtime W2 diuji terpisah di
// tests/product-truth-worker-reference.test.ts.
//
// LARANGAN YANG DIPATUHI: hanya baca berkas sumber. Nol jaringan, nol DB,
// nol provider, nol build.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SUMBER = {
  W2: "lib/worker.ts",
  W1: "lib/postgres/worker.ts",
} as const;

const baca = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const teks = { W1: baca(SUMBER.W1), W2: baca(SUMBER.W2) };

/**
 * Dua modul SENGAJA dikecualikan. Namanya mengandung "reference"/"referensi",
 * tapi keduanya menjawab pertanyaan lain — tanpa pengecualian ini test akan
 * lulus HAMPA:
 *
 * - `lib/media/person-safe-refs` (`personSafeReferencePhotos`): soal WAJAH
 *   ORANG di dalam gambar (moderasi provider), bukan soal apakah gambar itu
 *   bukti produk yang disetujui. Matriks P0-03 menyebutnya eksplisit di baris
 *   W1: "hanya soal orang".
 * - `lib/media/qc-frame` (`bolehJadiReferensi`): menilai FRAME HASIL GENERASI
 *   yang mau dipakai ulang sebagai acuan shot berikutnya (QC-F1), jadi ia
 *   bekerja pada keluaran model — jauh sesudah foto produk dipilih. Ia juga
 *   hanya ada di W1.
 */
const BUKAN_RESOLVER = new Set(["lib/media/person-safe-refs", "lib/media/qc-frame"]);

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

/** Kandidat resolver: impor bernama yang benar-benar soal pemilihan referensi. */
function kandidatResolver(rel: string, isi: string): Impor[] {
  return importsDari(rel, isi).filter(
    (i) =>
      !BUKAN_RESOLVER.has(i.modul) &&
      /referensi|reference|approvedref/i.test(i.nama) &&
      new RegExp(`\\b${i.nama}\\s*\\(`).test(isi) // benar-benar DIPANGGIL, bukan hanya diimpor
  );
}

test("harness: kedua sumber worker terbaca dan tidak kosong", () => {
  for (const [label, rel] of Object.entries(SUMBER)) {
    assert.ok(teks[label as keyof typeof teks].length > 1000, `${rel} tidak terbaca / terlalu pendek`);
  }
  // Bukti bahwa parser impor benar-benar bekerja pada berkas ini — tanpa ini,
  // "tidak ada resolver bersama" bisa berarti "regex-nya patah".
  const semua = [...importsDari(SUMBER.W1, teks.W1), ...importsDari(SUMBER.W2, teks.W2)];
  assert.ok(semua.length > 20, `parser impor hanya menemukan ${semua.length} impor — regexnya patah`);
  assert.ok(
    semua.some((i) => i.modul === "lib/media/person-safe-refs"),
    "parser tidak menemukan impor person-safe-refs yang jelas-jelas ada — regexnya patah"
  );
});

test("W1+W2: kedua worker memakai SATU resolver referensi tersetujui yang sama", () => {
  const w1 = kandidatResolver(SUMBER.W1, teks.W1);
  const w2 = kandidatResolver(SUMBER.W2, teks.W2);
  const bersama = w1.filter((a) => w2.some((b) => b.modul === a.modul && b.nama === a.nama));

  assert.ok(
    bersama.length > 0,
    "TIDAK ADA resolver referensi tersetujui yang dipakai bersama oleh kedua worker.\n" +
      `  ${SUMBER.W1} (W1) -> ${w1.length ? JSON.stringify(w1) : "tidak ada kandidat"}\n` +
      `  ${SUMBER.W2} (W2) -> ${w2.length ? JSON.stringify(w2) : "tidak ada kandidat"}\n` +
      `  (dikecualikan, dan alasannya di ${"BUKAN_RESOLVER"}: ${[...BUKAN_RESOLVER].join(", ")})\n` +
      "Masing-masing worker memilih referensinya sendiri, jadi gerbang bukti yang dipasang di " +
      "salah satunya tidak pernah berlaku di yang lain."
  );
  assert.equal(
    new Set(bersama.map((i) => `${i.modul}#${i.nama}`)).size,
    1,
    `harus TEPAT SATU resolver bersama, ditemukan: ${JSON.stringify(bersama)}`
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
      "\nPemilihan referensi harus lewat resolver bersama yang membaca sidecar, memverifikasi " +
      "sha256 terhadap bytes tersimpan, dan gagal-tertutup kalau buktinya tidak sah."
  );
});
