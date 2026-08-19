// Audit E15 (19 Agu 2026): POLA_KONTEN di scripts/laporan-nsfw.mjs tidak
// menangkap string penolakan BytePlus yang SEBENARNYA — "may contain real
// person" (didokumentasikan verbatim di lib/config.ts, spike 17 Agu). Akibatnya
// KPI penolakan konten melaporkan nol persis di kelas kegagalan yang memotivasi
// seluruh investasi CAST-REF.
//
// Tes ini merah pada pola lama. Ia juga menjaga arah sebaliknya: kegagalan
// INFRASTRUKTUR yang nyata di produksi tidak boleh ikut terhitung sebagai
// penolakan konten — melebih-lebihkan KPI sama buruknya dengan mengecilkannya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync("scripts/laporan-nsfw.mjs", "utf8");
// Deklarasinya boleh multi-baris (komentar panjang + string di baris berikutnya).
const m = src.match(/const POLA_KONTEN\s*=\s*\n?\s*"([^"]+)"/);
assert.ok(m, "POLA_KONTEN tidak ditemukan di scripts/laporan-nsfw.mjs");
const pola = new RegExp(m![1], "i");

/** Penolakan konten NYATA yang pernah/mungkin diterima dari penyedia. */
const PENOLAKAN_KONTEN = [
  // Verbatim dari lib/config.ts (BytePlus, request id 0217869633553829e96f8c80ac47960a454270e9930f95432d99e, 17 Agu 2026)
  "The request failed because the input image 'content[1]' may contain real person.",
  "Semua provider video gagal: byteplus: task abc123 failed: The request failed because the input image 'content[0]' may contain real person.",
  "byteplus: task x failed: sensitive content detected",
  "risk_level high, request rejected",
  "content policy violation",
  "blocked by content filter",
  "output flagged as nsfw",
];

/** Kegagalan INFRASTRUKTUR nyata dari audit_log produksi 19 Agu. */
const KEGAGALAN_INFRA = [
  "pipeline upgrade",
  "Worker gagal setelah 3 percobaan: Job PostgreSQL belum resumable dari state QC_CHECK; retry harus gagal agar refund final berjalan",
  "Worker gagal setelah 3 percobaan: Job PostgreSQL belum resumable dari state COMPOSITING; retry harus gagal agar refund final berjalan",
  "Worker gagal setelah 3 percobaan: QC gagal setelah retry: QC-01:skip, QC-10:fail, QC-06:skip",
  "Prompt akhir tidak lolos gerbang dan tidak dikirim: BAHASA @ shot 0: kunci bahasa tidak lengkap",
];

for (const alasan of PENOLAKAN_KONTEN) {
  test(`POLA_KONTEN menangkap penolakan nyata: ${alasan.slice(0, 60)}...`, () => {
    assert.ok(pola.test(alasan), `tidak tertangkap — KPI penolakan akan melapor nol palsu`);
  });
}

for (const alasan of KEGAGALAN_INFRA) {
  test(`POLA_KONTEN TIDAK menghitung kegagalan infra: ${alasan.slice(0, 50)}...`, () => {
    assert.ok(!pola.test(alasan), `kegagalan infrastruktur ikut terhitung sebagai penolakan konten`);
  });
}
