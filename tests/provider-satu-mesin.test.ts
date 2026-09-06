// GROK HANYA DI KIE.AI — TANPA CADANGAN LINTAS MESIN (keputusan Brian 6 Sep 2026).
//
// Sebelumnya paket yang dipetakan ke kie-grok mendaftarkan byteplus dan
// dashscope sebagai cadangan. Keduanya tidak pernah bisa berhasil: spec membawa
// nama model milik kie, dan BytePlus menjawab
//   HTTP 404: The model or endpoint grok-imagine/image-to-video does not exist
// Terlihat di produksi pada setiap kegagalan Standard.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("paket kie-grok mendaftarkan kie SAJA", () => {
  const src = kode("lib/providers/registry.ts");
  const m = src.match(/=== "kie-grok"\) \{\s*list\.push\(([^)]*)\)/);
  assert.ok(m, "cabang kie-grok tidak ditemukan");
  const isi = m[1]!.split(",").map((x) => x.trim()).filter(Boolean);
  assert.deepEqual(isi, ["kieGrokVideo"], `cadangan lintas mesin kembali: ${isi.join(", ")}`);
});

test("BytePlus tidak pernah dipakai sebagai cadangan Grok", () => {
  const src = kode("lib/providers/registry.ts");
  const i = src.indexOf('=== "kie-grok"');
  const j = src.indexOf("} else if", i);
  const cabang = src.slice(i, j);
  for (const asing of ["byteplusVideo", "dashscopeVideo"]) {
    assert.ok(!cabang.includes(asing), `${asing} masih terdaftar di cabang Grok`);
  }
});

test("penjaga jumlah provider tidak memaksa mendaftarkan yang pasti gagal", () => {
  const src = kode("lib/providers/registry.ts");
  assert.match(src, /mesinTunggal \? 1 : 2/, "penjaga masih menuntut dua provider untuk mesin tunggal");
  // Paket multi-mesin TETAP menuntut dua: di sana redundansinya nyata.
  assert.match(src, /providers\.length < \(mesinTunggal \? 1 : 2\)/);
});
