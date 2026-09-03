// PERBAIKAN BERSASARAN: cacat di SATU shot tidak boleh menggagalkan seluruh job.
//
// Kekhawatiran Brian 3 Sep 2026, dan ia benar: "apabila di tengah proses
// terjadi kegagalan berarti ada token yang sudah dikeluarkan dan kerugian."
//
// Terjadi nyata pada job 0ac19aa5: label tercetak "siho" untuk merek "sihoo",
// QC-10 menolak, seluruh job digagalkan, jatah pembeli dikembalikan — sementara
// Rp23.355 SUDAH dibayarkan ke penyedia. Kerugian penuh untuk cacat di satu klip.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

test("QC-10 melaporkan DETIK tempat label salah eja terbaca", () => {
  // Tanpa detiknya, shot penyebabnya tidak bisa ditunjuk — dan yang bisa
  // dilakukan hanya menolak seluruh video.
  const src = baca("lib/media/qc.ts");
  const q10 = src.slice(src.indexOf('const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "racun-qc10-"))'));
  const badan = q10.slice(0, q10.indexOf("/** CADANGAN LOKAL untuk QC-11"));
  assert.match(badan, /detikGagal\.push\(Math\.floor\(duration \* frac\)\)/, "QC-10 tidak mencatat detik kegagalan");
  assert.match(badan, /\.\.\.\(detikGagal\.length \? \{ detikGagal/, "detik kegagalan tidak ikut di hasil QC-10");
});

test("perbaikan bersasaran berlaku untuk QC-10, bukan cuma QC-11", () => {
  const src = baca("lib/postgres/worker.ts");
  assert.match(
    src,
    /check\.code === "QC-11" \|\| check\.code === "QC-10"/,
    "QC-10 tidak ikut jalur perbaikan — cacat satu label tetap menggagalkan seluruh job",
  );
  // Syaratnya tetap: hanya check yang bisa MENUNJUK tempatnya.
  assert.match(src, /check\.status === "fail" && check\.detikGagal\?\.length/);
  // Batas dua shot dipertahankan: lebih dari dua shot cacat berarti arahannya
  // yang salah, dan menggenerate ulang terus membakar margin tanpa memperbaiki.
  assert.match(src, /\.slice\(0, 2\)/, "batas dua shot hilang — regenerasi bisa membakar margin");
});

test("biaya regenerasi TETAP dicatat ke job", () => {
  // Kalau tidak, laporan margin akan menunjukkan job yang lebih untung
  // daripada kenyataannya — persis jenis kesalahan yang paling lama tidak
  // ketahuan.
  const src = baca("lib/postgres/worker.ts");
  assert.match(src, /await jobs\.addCost\(row\.id, ulang\.costIdr\)/, "biaya shot ulang tidak dicatat");
});
