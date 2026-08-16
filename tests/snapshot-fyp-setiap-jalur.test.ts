// Setiap jalur yang MEMBUAT job wajib juga membuat snapshot Skor FYP.
//
// Kegagalan diam yang mahal, ditemukan di produksi 16 Agu 2026: sejak 10
// Agustus, 12 job tidak punya skor FYP sama sekali. Sebabnya bukan mesin
// skoring rusak — ia tidak pernah dipanggil. `createFypSnapshot` hanya ada di
// /api/jobs retail, sementara dashboard brand membuat job lewat jalur sendiri
// yang ditambahkan belakangan (M8) dan tidak pernah ikut memanggilnya.
//
// Enam dari 12 itu talking_head — format yang justru didukung penuh model.
// Tidak ada yang menyadarinya selama enam hari, karena tidak ada yang gagal:
// job tetap jalan, video tetap jadi, cuma prediksinya hilang. Loop
// predicted-vs-actual berhenti mengumpulkan bahan tanpa satu pun alarm.
//
// Tes ini menjaga sifat strukturalnya, bukan satu berkas tertentu: siapa pun
// yang menambah jalur pembuatan job berikutnya akan gagal di sini, bukan enam
// hari kemudian di kueri produksi.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** Telusuri app/api mencari berkas yang membuat baris job. */
function jalurPembuatJob(): string[] {
  const keluar: string[] = [];
  const akar = path.join(process.cwd(), "app", "api");
  const telusuri = (dir: string) => {
    for (const nama of fs.readdirSync(dir)) {
      const p = path.join(dir, nama);
      if (fs.statSync(p).isDirectory()) telusuri(p);
      else if (nama === "route.ts") {
        const isi = fs.readFileSync(p, "utf8");
        // Dua bentuk pembuatan job yang dipakai repo ini: INSERT SQL langsung
        // (jalur Postgres) dan helper smokeCreateJob (jalur retail).
        if (/INSERT INTO jobs\b/.test(isi) || /smokeCreateJob\s*\(/.test(isi)) keluar.push(p);
      }
    }
  };
  telusuri(akar);
  return keluar;
}

test("setiap jalur pembuat job juga membuat snapshot Skor FYP", () => {
  const jalur = jalurPembuatJob();
  assert.ok(jalur.length >= 2, `harus menemukan minimal 2 jalur pembuat job, ketemu ${jalur.length}`);

  const tanpaSnapshot = jalur.filter((p) => {
    const isi = fs.readFileSync(p, "utf8");
    return !/createFypSnapshot|pgSaveFypSnapshot/.test(isi);
  });

  assert.deepEqual(
    tanpaSnapshot.map((p) => path.relative(process.cwd(), p)),
    [],
    "jalur ini membuat job tanpa pernah membuat skor FYP — prediksi pre-render hilang diam-diam"
  );
});

// Skor yang dilewati harus dilewati SECARA SADAR, dengan alasannya tertulis.
// Memetakan TVC ke "other" akan menghasilkan angka yang terlihat sah padahal
// modelnya tidak pernah melihat iklan merek — itu mengarang bukti.
test("format di luar jangkauan model dilewati dengan alasan tertulis, bukan dipetakan paksa", () => {
  const p = path.join(process.cwd(), "app", "api", "dashboard", "campaign", "confirm", "route.ts");
  const isi = fs.readFileSync(p, "utf8");
  assert.match(isi, /FORMAT_BERSKOR/, "daftar format yang boleh diskor hilang");
  assert.match(isi, /SENGAJA dilewati/, "alasan melewati TVC/iklan jasa harus tertulis di kode");
  // Jangkauan model itu sendiri, dari lib/fyp-score/features.ts.
  for (const f of ["hands_only", "vo_broll", "talking_head"]) {
    assert.ok(isi.includes(`"${f}"`), `format ${f} harus ada di daftar berskor`);
  }
  assert.ok(!/FORMAT_BERSKOR[^;]*"tvc"/.test(isi), "TVC tidak boleh masuk daftar berskor");
});
