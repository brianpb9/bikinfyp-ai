// DURASI KLIP HARUS MENGIKUTI BATAS MESINNYA (temuan 6 Sep 2026).
//
// Ditemukan dengan menjalankan kampanye brand dari ujung ke ujung, bukan oleh
// tes: perencana memecah 15 detik jadi 3 shot @5 detik — sah menurut
// MIN_SHOT_SEC = 4 — tapi Grok Imagine lewat kie.ai, mesin paket STANDARD,
// menolak durasi di bawah 6 detik. Diuji langsung ke API-nya:
//
//   duration=5 -> {"code":500,"msg":"Value must be within the specified range"}
//   duration=6 -> {"code":200,...,"taskId":"..."}
//
// Setiap shot ditolak, tiga percobaan habis, paket Standard mati total — dan
// biayanya sudah keluar di frame yang terlanjur dibuat.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("batas minimum durasi ditentukan MESIN, bukan satu angka untuk semua", () => {
  const src = kode("lib/media/shot-planner.ts");
  assert.match(src, /MIN_DETIK_MESIN/, "tidak ada tabel batas per mesin");
  assert.match(src, /"kie-grok": 6/, "batas kie-grok bukan 6 detik");
  assert.match(src, /mesinBerlaku/, "batas tidak dibaca dari pemetaan mesin");
});

test("perencana memakai batas mesin di KEDUA tempat yang menghitung shot", () => {
  const src = kode("lib/media/shot-planner.ts");
  // Satu tempat saja tidak cukup: maxShotsForDuration membatasi override
  // pengguna, modulRapi memilih jumlah shot bawaan. Yang terlewat akan
  // menghasilkan durasi di bawah batas lewat jalur yang lain.
  assert.match(src, /Math\.floor\(input\.durationSec \/ minDetik\)/, "batas atas jumlah shot tidak pakai minDetik");
  assert.match(src, /durasi \/ n >= minDetik/, "pemilihan jumlah shot tidak pakai minDetik");
  assert.doesNotMatch(src, /durasi \/ n >= MIN_SHOT_SEC/, "masih ada jalur yang memakai batas lama");
});

test("mesin yang tidak dikenal jatuh ke batas lama, bukan ke nol", () => {
  const src = kode("lib/media/shot-planner.ts");
  // Jatuh ke 0 berarti pembagian tak terbatas dan klip 1 detik yang ditolak
  // semua mesin.
  assert.match(src, /\?\? MIN_SHOT_SEC/, "tidak ada nilai jatuh yang aman");
  assert.match(src, /if \(!tier \|\| !kualitasDikenal\(tier\)\) return MIN_SHOT_SEC;/, "tier tak dikenal tidak dijaga");
});

test("provider kie tetap menolak klip di atas batas atasnya", () => {
  // Penjagaan yang sudah ada tidak boleh ikut hilang saat batas bawah
  // ditambahkan.
  assert.match(kode("lib/providers/stubs/kie-grok.ts"), /MAKS_DETIK_PER_KLIP/);
});
