// Reviewer ronde 4, sisa terakhir QC-07: ia memeriksa SEGMEN NASKAH, bukan
// apa yang benar-benar terdengar. Segmen adalah yang kita MINTA diucapkan;
// transkrip adalah yang keluar. Untuk tier bersuara lewat provider keduanya
// bisa berbeda — dan yang menanggung risiko hukum adalah yang terdengar.
//
// Transkripsinya sudah ada sejak QC-12 (lib/media/qc-suara.ts). Yang hilang
// cuma sambungannya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DB_PATH = `/tmp/racun-test-qc07t-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qc07t-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { periksaQc07 } = await import("../lib/media/qc");

test("kata terlarang yang HANYA muncul di transkrip tetap menjatuhkan QC-07", () => {
  const v = periksaQc07(
    ["teksturnya ringan banget", "cek keranjang kuning ya"],
    "serum ini menyembuhkan jerawat dalam semalam"
  );
  assert.equal(v.status, "fail", v.detail);
  assert.match(v.detail, /klaim kesehatan/);
  assert.match(v.detail, /transkrip audio \+ segmen/);
});

test("transkrip bersih lulus, dan sumbernya disebut apa adanya", () => {
  const v = periksaQc07(["teksturnya ringan banget"], "teksturnya ringan banget");
  assert.equal(v.status, "pass");
  assert.match(v.detail, /transkrip audio \+ segmen/);
});

test("tanpa transkrip, QC-07 tetap jalan atas segmen dan MENGAKUINYA", () => {
  const jatuh = periksaQc07(["dijamin paling bagus"], null);
  assert.equal(jatuh.status, "fail");
  assert.match(jatuh.detail, /transkrip tidak tersedia/);

  const lolos = periksaQc07(["teksturnya ringan banget"], null);
  assert.equal(lolos.status, "pass");
  assert.match(lolos.detail, /transkrip tidak tersedia/,
    "kalau transkrip mati, hasilnya tidak boleh mengaku sudah memeriksa ucapan");
});

test("transkrip diambil SEKALI dan dipakai QC-07 sebelum QC-12", () => {
  const src = fs.readFileSync("lib/media/qc.ts", "utf8");
  // Satu panggilan qcSuara saja: dua panggilan = dua biaya untuk jawaban sama.
  assert.equal((src.match(/await qcSuara\(/g) ?? []).length, 1, "qcSuara dipanggil lebih dari sekali");
  const transkripIdx = src.indexOf("const transkripUcapan");
  const qc07Idx = src.indexOf('code: "QC-07"');
  assert.ok(transkripIdx > 0 && transkripIdx < qc07Idx, "transkrip harus siap sebelum QC-07 memutuskan");
});
