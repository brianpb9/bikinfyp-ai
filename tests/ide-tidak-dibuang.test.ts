// Audit D13/D14 + E15 (19 Agu 2026): hasil kerja termahal di pipeline dibuang.
//   - top-3 ide saat FYP Gate gagal dibuat di index.ts lalu DIHAPUS rute
//     dashboard dan tidak dibaca komponen mana pun,
//   - job_prompts.ide_id/ide_skor selalu NULL walau kolomnya sudah ada,
//     karena skornya berhenti di memori proses web.
//
// Tes ini merah pada kode lama.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-ide-jejak-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-ide-jejak-storage-${process.pid}`;

const { bacaJejakIde } = await import("../lib/postgres/worker");
const { amplopValidasi } = await import("../lib/script-engine/admisi");

test("jejak ide diselamatkan dari snapshot admisi ke arsip prompt", () => {
  const amplop = amplopValidasi(
    { passed: true, errors: [], warnings: [], checked_at: new Date().toISOString() },
    { script_source: "llm", admisi: { contentType: "ads", ideSkor: 82, ideId: "anomaly_pov/unboxing_asmr" } as never }
  );
  const jejak = bacaJejakIde(JSON.stringify(amplop));
  assert.equal(jejak.ideSkor, 82);
  assert.equal(jejak.ideId, "anomaly_pov/unboxing_asmr");
});

test("snapshot lama / korup tidak menggagalkan arsip (catatan, bukan produk)", () => {
  assert.deepEqual(bacaJejakIde(null), { ideId: null, ideSkor: null });
  assert.deepEqual(bacaJejakIde("{bukan json"), { ideId: null, ideSkor: null });
  assert.deepEqual(bacaJejakIde(JSON.stringify({ passed: true })), { ideId: null, ideSkor: null });
});

test("worker mengirim jejak ide ke pgSimpanArsipPrompt — kolom 0032 tidak lagi NULL", () => {
  const src = fs.readFileSync("lib/postgres/worker.ts", "utf8");
  assert.match(src, /s\.validation_result AS script_validation_result/, "worker harus ikut mengambil snapshot admisi");
  assert.match(src, /ideId: jejakIde\.ideId/, "ideId harus diteruskan ke arsip");
  assert.match(src, /ideSkor: jejakIde\.ideSkor/, "ideSkor harus diteruskan ke arsip");
});

test("rute dashboard TIDAK lagi membuang top-3 ide saat gate gagal", () => {
  const src = fs.readFileSync("app/api/dashboard/campaign/generate/route.ts", "utf8");
  assert.match(src, /ide_kandidat/, "top-3 ide harus ikut di respons");
  assert.match(src, /ide_skor/, "skor ide harus ikut di respons");
});

test("UI campaign merender top-3 ide, skor, dan gema mode/format", () => {
  const src = fs.readFileSync("app/dashboard/(app)/campaign/page.tsx", "utf8");
  assert.match(src, /ide_kandidat/, "UI harus membaca kandidat ide");
  assert.match(src, /why_stop|sebab_gagal|sebabGagal/, "alasan gagal harus terlihat, bukan cuma skor");
  assert.match(src, /Skor ide|skor ide/, "skor ide harus tampil");
});

test("ada pembaca fyp-gate-log — catatan riset tidak boleh write-only", () => {
  assert.ok(fs.existsSync("scripts/laporan-fyp-gate.mjs"), "pembaca fyp-gate-log belum ada");
  const src = fs.readFileSync("scripts/laporan-fyp-gate.mjs", "utf8");
  assert.match(src, /fyp-gate-log\.jsonl/);
});
