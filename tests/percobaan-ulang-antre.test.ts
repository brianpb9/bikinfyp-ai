// Job yang MENGANTRE untuk percobaan ulang bukan job yang MACET.
//
// ─────────────────────────────────────────────────────────────────────────────
// KEGAGALAN NYATA YANG DIJAGA TES INI (job 000de02e, 3 Sep 2026)
// ─────────────────────────────────────────────────────────────────────────────
// Job standard gagal QC. BullMQ menjadwalkan percobaan ke-2 dari 3, dan barisnya
// di database dibiarkan di QC_CHECK. Worker berjalan concurrency=1, dan job
// berikutnya (ultra) memakai mesin selama 617 detik — percobaan ulang itu
// mengantre di belakangnya.
//
// Penyapu lalu menghitung "sudah 10 menit di QC_CHECK", memvonisnya macet, dan
// menjatuhkannya ke FAILED -> REFUNDED dengan DUA percobaan masih tersisa.
// Pembeli melihat "Gagal"; kami menanggung Rp6.750 render yang sudah dibayar.
// Penyebabnya bukan rendernya, melainkan pembukuan kami sendiri.
//
// Diukur sesudahnya: Grok lolos 8 dari 9 render (QC-03 antar_shot 3,6-44,6 vs
// ambang 60) — jadi yang menjatuhkan paket Standard memang bukan mutu mesinnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const worker = fs.readFileSync(path.join(process.cwd(), "scripts/worker.ts"), "utf8");

test("percobaan yang BELUM habis mengembalikan job ke QUEUED", () => {
  assert.match(
    worker, /if \(job\.attemptsMade < attempts && postgresRuntimeEnabled\(\)\)/,
    "tidak ada cabang untuk percobaan yang masih tersisa",
  );
  assert.match(
    worker, /transition\(job\.data\.jobId, "QUEUED"/,
    "job tidak dikembalikan ke QUEUED — penyapu akan memvonisnya macet",
  );
});

test("cabang percobaan-tersisa TIDAK ikut me-refund", () => {
  // Refund hanya milik kegagalan TERAKHIR. Kalau cabang ini ikut memanggil
  // failJob, satu kegagalan sementara akan mengembalikan kredit lalu job-nya
  // tetap berjalan — pembeli mendapat jatah gratis, atau lebih buruk, jatahnya
  // dikembalikan dua kali.
  const potong = worker.slice(
    worker.indexOf("if (job.attemptsMade < attempts"),
    worker.indexOf("// BullMQ increments attemptsMade"),
  );
  assert.ok(potong.length > 0, "cabang percobaan-tersisa tidak ditemukan");
  assert.doesNotMatch(potong, /failJob/, "cabang percobaan-tersisa ikut me-refund");
});

test("kegagalan TERAKHIR tetap lewat jalur FAILED -> REFUNDED yang sudah ada", () => {
  assert.match(worker, /if \(job\.attemptsMade >= attempts\)/, "jalur kegagalan terakhir hilang");
  const potong = worker.slice(worker.indexOf("if (job.attemptsMade >= attempts)"));
  assert.match(potong, /failJob\(job\.data\.jobId/, "kegagalan terakhir berhenti me-refund");
});
