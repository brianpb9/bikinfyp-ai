// PENULIS NASKAH TIDAK TERSEDIA — pesan yang benar untuk sebab yang berbeda.
//
// 3 Sep 2026: /api/scripts/generate menjawab 503. Sebabnya bukan satu, tapi
// dua bertumpuk — dan yang kedua hanya terlihat setelah yang pertama diperbaiki:
//
//   1. ANTHROPIC_API_KEY tidak pernah dipasang di server setelah migrasi dari
//      Render. Kunci itu ada di .env.local mesin pengembang, tidak pernah ikut.
//   2. Sesudah kuncinya dipasang: HTTP 400 "Your credit balance is too low" —
//      kuncinya SAH, akunnya yang kehabisan saldo.
//
// Log lama selalu menyarankan "pasang ANTHROPIC_API_KEY", termasuk untuk sebab
// kedua. Petunjuk yang salah lebih buruk daripada tanpa petunjuk: ia mengirim
// orang ke arah yang keliru, dan mereka akan memasang kunci yang sudah ada.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DB_PATH = `/tmp/racun-test-naskahllm-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-naskahllm-storage-${process.pid}`;

const { laporJatuhKeTemplate } = await import("../lib/script-engine/llm");

function tangkap(sebab: string): string {
  const pesan: string[] = [];
  const asli = console.error;
  console.error = (m: unknown) => { pesan.push(String(m)); };
  try { laporJatuhKeTemplate(sebab, { productName: "Serum Uji" }); } finally { console.error = asli; }
  return pesan.join("\n");
}

test("saldo habis TIDAK disuruh memasang kunci", () => {
  const nyata = 'HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
  const log = tangkap(nyata);
  assert.match(log, /SALDO AKUN ANTHROPIC HABIS/, "sebab saldo tidak dikenali");
  assert.ok(!/pasang ANTHROPIC_API_KEY/i.test(log), "masih menyuruh memasang kunci yang sudah ada");
  // Sebab aslinya tetap ikut — petunjuk tidak boleh menggantikan bukti.
  assert.match(log, /credit balance is too low/);
});

test("kunci ditolak dan kunci belum dipasang punya saran yang berbeda", () => {
  assert.match(tangkap("HTTP 401 invalid x-api-key"), /Kunci Anthropic DITOLAK/);
  assert.match(tangkap("kunci API penulis LLM belum di-set di server"), /Pasang ANTHROPIC_API_KEY/);
  // Sebab yang tidak dikenali tidak boleh menebak-nebak.
  const lain = tangkap("HTTP 529 overloaded");
  assert.match(lain, /Periksa jawaban Anthropic di atas/);
  assert.ok(!/SALDO|DITOLAK/.test(lain), "sebab tak dikenal disamakan dengan sebab lain");
});

test("kegagalan penulis selalu dinyatakan, tidak pernah disamarkan jadi naskah biasa", () => {
  const log = tangkap("apa pun");
  assert.match(log, /JATUH KE TEMPLATE/, "kejatuhan ke template tidak diumumkan");
  assert.match(log, /BUKAN tulisan LLM/, "log tidak menyatakan naskahnya bukan tulisan LLM");
  assert.match(log, /Serum Uji/, "produk yang terdampak tidak disebut");
});

test("rute yang memakai kredensial partner menyegarkannya lebih dulu", () => {
  // Kredensial bisa diganti dari /admin/kredensial tanpa restart — itu seluruh
  // gunanya halaman itu. Rute yang tidak memanggil pastikanSegar() akan tetap
  // memakai nilai lama sampai container dimuat ulang, sementara halamannya
  // bilang "tersimpan". Kegagalan diam yang paling membingungkan.
  const baca = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  for (const rute of [
    "app/api/scripts/generate/route.ts",
    "app/api/try/route.ts",
    "app/api/dashboard/campaign/generate/route.ts",
    "app/api/dashboard/matrix/route.ts",
  ]) {
    assert.match(baca(rute), /await pastikanSegar\(\)/, `${rute} tidak menyegarkan kredensial`);
  }
});
