// Keputusan Brian 20 Agu: template adalah JALUR WARISAN — jangan pernah
// disajikan. Kalau penulis LLM gagal setelah percobaan ulang, TOLAK dengan
// alasan yang jelas; jangan diam-diam mengirim naskah template.
//
// Sebelum ini template yang kebetulan lolos gate keluar sebagai
// script_source="template" dan tidak ada yang membedakannya dari naskah LLM
// selain satu badge kecil. Itu persis cara "benar tapi datar" bertahan
// berbulan-bulan: naskah cadangan yang lolos aturan tapi tidak pernah
// menjawab "kenapa orang berhenti scroll".
//
// Tes ini merah pada kode lama.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.SCRIPT_LLM = "0"; // paksa jalur tanpa LLM = template
process.env.DB_PATH = `/tmp/racun-test-no-template-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-no-template-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { generateScripts, TemplateTidakDisajikan } = await import("../lib/script-engine");

const PRODUK = {
  id: "uji-template", name: "Serum Glow Bening", category: "beauty",
  description: "Serum wajah 30ml", price_idr: 89000,
} as never;

test("LLM mati -> generateScripts MENOLAK, bukan menyajikan template", async () => {
  await assert.rejects(
    () => generateScripts({ product: PRODUK, register: "netral", qualityTier: "high_quality", durationSec: 15 }),
    (err: unknown) => {
      assert.ok(err instanceof TemplateTidakDisajikan, `harus TemplateTidakDisajikan, dapat ${(err as Error).name}`);
      // Alasannya harus BISA DIBACA pengguna, bukan kode internal saja.
      assert.match((err as Error).message, /naskah/i);
      return true;
    }
  );
});

test("penolakan menyebut sebab teknis untuk operator (bukan hanya pesan ramah)", async () => {
  const err = await generateScripts({ product: PRODUK, register: "netral", qualityTier: "super_hq", durationSec: 15 })
    .then(() => null)
    .catch((e: Error) => e);
  assert.ok(err, "harus melempar");
  assert.match(err!.message, /LLM|penulis|kunci|API/i, `sebab teknis hilang: ${err!.message}`);
});

test("jalur anonim (tanpaLlm) TETAP boleh memakai template — ia tidak pernah dirender", async () => {
  // /api/try sengaja tidak memanggil model berbayar. Ia menampilkan CONTOH
  // naskah, tidak pernah masuk antrean render, jadi larangan di atas tidak
  // berlaku untuknya — dan mematikannya akan membunuh magic moment tanpa
  // login tanpa alasan.
  const hasil = await generateScripts({
    product: PRODUK, register: "netral", qualityTier: "high_quality", durationSec: 15, tanpaLlm: true,
  });
  assert.ok(hasil.length > 0, "jalur anonim harus tetap menghasilkan contoh");
  assert.ok(hasil.every((v) => v.script_source !== "llm"), "jalur anonim memang template/degraded");
});
