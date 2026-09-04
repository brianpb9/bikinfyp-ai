// Dua perintah "berhenti" yang dituruti model secara harfiah — dan satu gerbang
// mutu yang mati bersama pihak ketiga.
//
// ─────────────────────────────────────────────────────────────────────────────
// 1. EKOR HIDUP
// ─────────────────────────────────────────────────────────────────────────────
// Shot CTA dulu meminta produk "held still for the final second". Model
// menurutinya dan membekukan ujung video. Ini keluarga yang sama dengan
// "natural pauses" yang dibuang dari arahan bicara 4 Sep 2026, dan terukur di
// sana: perintah berhenti selalu dituruti. Yang sebenarnya dikejar kalimat itu
// adalah LABEL TERBACA — dan label terbaca tidak menuntut kebekuan.
//
// ─────────────────────────────────────────────────────────────────────────────
// 2. TRANSKRIPSI DIULANG
// ─────────────────────────────────────────────────────────────────────────────
// QC-12 memeriksa apakah yang diucapkan cocok dengan naskah — satu-satunya cek
// yang menangkap harga salah sebut. Ia memanggil Gemini sekali dan menyerah
// pada 503. Diukur di produksi 4 Sep 2026: 3 dari 10 job READY gagal begitu,
// jadi 30% video keluar tanpa ucapannya pernah diperiksa — dan di layar itu
// terlihat sebagai "skip", bukan sebagai kegagalan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("shot CTA tidak lagi menyuruh produk DIAM di detik terakhir", () => {
  const planner = baca("lib/media/shot-planner.ts");
  // Yang dicari di KODE, bukan di komentar yang menjelaskan kenapa dibuang.
  const kode = planner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(kode, /held still for the final second/, "perintah pembeku masih dikirim ke model");
  assert.match(kode, /micro-movement and her breathing continues right through the final frame/,
    "ekor hidup tidak diminta — model akan mengarang sendiri akhirannya");
  // Yang dijaga kalimat lama TETAP dijaga: label harus terbaca.
  assert.match(kode, /label squarely readable to camera/, "syarat label terbaca ikut hilang");
});

test("aturan tertulis ikut dibatalkan, bukan hanya kodenya", () => {
  // Berkas rujukan yang masih mengajarkan aturan yang dibatalkan akan
  // mengembalikannya lewat orang berikutnya yang membacanya.
  const aturan = baca("knowledge/rules/prompt-language.md");
  assert.match(aturan, /ekor hidup/i, "aturan tertulis belum diperbarui");
  assert.match(aturan, /Dibatalkan 4 Sep 2026/, "pembatalan tidak bertanggal — jejaknya hilang");
});

test("transkripsi QC-12 diulang pada kegagalan SEMENTARA saja", () => {
  const qc = baca("lib/media/qc-suara.ts");
  assert.match(qc, /MAKS_PERCOBAAN_TRANSKRIP = 3/, "tidak ada percobaan ulang");
  // 503/429 diulang; 401/400 tidak — mengulang kegagalan yang tidak akan
  // membaik hanya menunda kabar buruk dan membakar waktu worker.
  assert.match(qc, /status === 429 \|\| status === 500 \|\| status === 502 \|\| status === 503 \|\| status === 504/);
  const bolehDiulang = (status: number) => [429, 500, 502, 503, 504].includes(status);
  for (const s of [429, 500, 502, 503, 504]) assert.equal(bolehDiulang(s), true, `${s} harus diulang`);
  for (const s of [400, 401, 403, 404]) assert.equal(bolehDiulang(s), false, `${s} TIDAK boleh diulang`);
});

test("pesan gagal menyebut bahwa sudah diulang — bukan menyamar kegagalan sekali coba", () => {
  const qc = baca("lib/media/qc-suara.ts");
  assert.match(qc, /transkripsi gagal setelah \$\{MAKS_PERCOBAAN_TRANSKRIP\} percobaan/,
    "pesan lama tidak membedakan gagal sekali dari gagal tiga kali — operator tidak tahu apakah perlu menaikkan batasnya");
});
