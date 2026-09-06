// ANTREAN PRIORITAS: brand didahulukan atas retail (permintaan Brian 6 Sep 2026).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PRIORITAS } from "../lib/prioritas-antrean";

const kode = (rel: string) =>
  fs
    .readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((b) => !/^\s*\/\//.test(b))
    .join("\n");

test("brand punya angka LEBIH KECIL dari retail — di BullMQ itu artinya duluan", () => {
  assert.ok(PRIORITAS.brand < PRIORITAS.retail, "brand tidak didahulukan");
  // 0 di BullMQ berarti "tanpa prioritas" dan masuk himpunan yang berbeda.
  // Keduanya harus benar-benar berprioritas supaya urutannya ditentukan angka
  // ini, bukan detail internal pustaka yang bisa berubah saat upgrade.
  assert.ok(PRIORITAS.brand >= 1 && PRIORITAS.retail >= 1, "0 = tanpa prioritas, bukan itu yang dimaksud");
});

test("SETIAP job yang masuk antrean membawa prioritas, tidak ada yang polos", () => {
  const q = kode("lib/job-queue.ts");
  const jumlahAdd = (q.match(/\.add\("render"/g) ?? []).length;
  const jumlahPrioritas = (q.match(/priority: PRIORITAS\[asal\]/g) ?? []).length;
  assert.ok(jumlahAdd > 0, "tidak ada job yang di-enqueue — pembacaan rusak");
  assert.equal(jumlahPrioritas, jumlahAdd, `${jumlahAdd} enqueue tapi cuma ${jumlahPrioritas} yang berprioritas`);
});

test("jalur brand dan jalur retail menyebut asalnya masing-masing", () => {
  // Dashboard enterprise = brand.
  assert.match(kode("lib/dashboard/render-cell.ts"), /enqueueJob\([^)]*"brand"\)/, "jalur brand tidak menandai dirinya");
  // /api/jobs = retail.
  const retail = kode("app/api/jobs/route.ts");
  assert.match(retail, /enqueueJob\([^)]*"retail"\)/, "jalur retail tidak menandai dirinya");
  assert.doesNotMatch(retail, /enqueueJob\([^)]*"brand"\)/, "jalur retail tidak boleh mengaku brand");
});

test("bawaan enqueueJob adalah retail — lupa menyebut asal tidak menaikkan kelas", () => {
  assert.match(kode("lib/job-queue.ts"), /enqueueJob\(jobId: string, asal: AsalJob = "retail"\)/);
});
