// KREDIT HANYA DIFINALKAN KALAU VIDEONYA ADA (temuan produksi 6 Sep 2026).
//
// runProviderPipeline() punya banyak jalan keluar normal yang bukan "selesai" —
// yang paling sering: job berhenti di AWAITING_APPROVAL menunggu brand
// menyetujui adegannya. Sebelumnya capture dipanggil tanpa syarat sesudah
// pipeline kembali, jadi kredit difinalkan saat persetujuan, sebelum
// penggabungan dan QC. Ketika QC menolak, refund tidak bisa menulis apa pun
// (credit_ledger menolak entri terminal kedua): job berstatus REFUNDED,
// uangnya tetap terpotong.
//
// Terbukti di produksi: job 371bf679 -> hold -14000, capture, QC gagal,
// REFUNDED, saldo tidak kembali.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("capture dijaga syarat state READY, bukan dipanggil tanpa syarat", () => {
  const src = kode("lib/postgres/worker.ts");
  assert.match(
    src,
    /state === "READY"\)\s*\{\s*const credits = new PgCreditPaymentRepository/,
    "captureCredits tidak dijaga syarat READY",
  );
});

test("state job dibaca ULANG sesudah pipeline, bukan memakai baris lama", () => {
  // row.state dibaca SEBELUM pipeline jalan; memakainya berarti memeriksa
  // keadaan yang sudah basi dan capture tetap lolos.
  const src = kode("lib/postgres/worker.ts");
  assert.match(src, /await jobs\.getJob\(jobId\)/, "state tidak dibaca ulang sesudah pipeline");
  assert.doesNotMatch(src, /row\.state === "READY"\)\s*\{\s*const credits/, "memakai state yang sudah basi");
});

test("jalur retail tetap memegang aturan yang sama", () => {
  // Aturannya sudah tertulis di sana sejak lama; kalau ia hilang, kedua jalur
  // menyimpang lagi ke arah yang berlawanan.
  assert.match(kode("lib/worker.ts"), /captureCredits\(job\.user_id, job\.id\)/);
});

test("penyapu hold menggantung tetap ada sebagai jaring pengaman", () => {
  // Job READY yang capture-nya gagal harus tetap tertagih belakangan, kalau
  // tidak videonya diberikan gratis.
  assert.match(kode("lib/postgres/worker.ts"), /di-capture susulan \(hold menggantung\)/);
});
