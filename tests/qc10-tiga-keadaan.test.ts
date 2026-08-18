// QC-10 punya TIGA keadaan sejak render nyata 18 Agu.
//
// Yang ditemukan: klip TVC lolos QC-10 dengan detail "token merek mosseru
// terbaca", sementara labelnya benar-benar tercetak "moseru". Lulusnya datang
// dari kecocokan substring 4 huruf ("seru"), bukan dari membaca mereknya.
//
// Dan pada dua klip lain OCR tidak membaca APA PUN dari label — jadi "gagal"
// pun akan salah: tidak ada bukti labelnya rusak, yang ada cuma ketiadaan
// bukti. Dua hal itu sekarang dibedakan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DB_PATH = `/tmp/racun-test-qc10-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-qc10-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

test("aturan cocok merek: kelebihan huruf boleh, kekurangan TIDAK", async () => {
  const { merekCocok } = await import("../lib/media/qc-frame");
  assert.equal(merekCocok("mosseru", "mosseru"), true);
  assert.equal(merekCocok("mosserus", "mosseru"), true, "ekor OCR boleh");
  assert.equal(merekCocok("moseru", "mosseru"), false, "huruf hilang = merek lain");
  assert.equal(merekCocok("mossrou", "mosseru"), false);
});

test("QC-10 tidak lagi lulus lewat kecocokan substring", () => {
  const src = fs.readFileSync("lib/media/qc.ts", "utf8");
  assert.ok(!/norm\.includes\(token\.slice\(i, i \+ 4\)\)/.test(src),
    "kecocokan substring 4 huruf inilah yang meloloskan merek salah eja");
  assert.match(src, /merekCocok\(norm, token\)/);
  // Lulus hanya bila MEREK UTAMA terbaca — bukan kata umum seperti "shower".
  assert.match(src, /found\.has\(merekUtama\)/);
  // Dan tidak terbaca sama sekali BUKAN "fail" — itu ketiadaan bukti.
  assert.match(src, /TIDAK TERBUKTI/);
});
