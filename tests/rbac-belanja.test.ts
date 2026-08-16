// Siapa boleh MEMBELANJAKAN saldo organisasi.
//
// Kolom role sudah ada sejak M1, tapi komentarnya sendiri menyatakan ia
// "HANYA label, TIDAK PERNAH dicek untuk otorisasi" — RBAC ditunda ke v2.
// Yang tidak ikut ditunda adalah uangnya: anggota mana pun bisa menekan render
// dan memotong saldo bersama, termasuk orang yang baru diundang lima menit
// lalu. Di Matriks satu klik bisa bernilai jutaan rupiah.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bolehBelanja, bolehSetujuiNaskah, pastikanBolehBelanja } from "../lib/dashboard-rbac";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("hanya owner yang boleh membelanjakan dan menyetujui", () => {
  assert.equal(bolehBelanja("owner"), true);
  assert.equal(bolehBelanja("member"), false);
  assert.equal(bolehSetujuiNaskah("owner"), true);
  assert.equal(bolehSetujuiNaskah("member"), false);
  // Peran yang tidak dikenal TIDAK boleh lolos. Daftar putih, sama alasannya
  // dengan tierMasihDijual: untuk pemeriksaan yang menentukan uang, bawaan
  // yang benar adalah TIDAK.
  assert.equal(bolehBelanja("admin"), false);
  assert.equal(bolehBelanja(""), false);
});

test("penolakannya 403 dan menjelaskan jalan keluarnya", () => {
  assert.doesNotThrow(() => pastikanBolehBelanja("owner"));
  try {
    pastikanBolehBelanja("member");
    assert.fail("member seharusnya ditolak");
  } catch (err) {
    const e = err as { status?: number; body?: { code?: string; message_id?: string } };
    // 403, bukan 401: penggunanya sudah masuk — login ulang tidak akan menolong.
    assert.equal(e.status, 403);
    assert.equal(e.body?.code, "FORBIDDEN");
    assert.match(e.body?.message_id ?? "", /pemilik organisasi/i);
    assert.match(e.body?.message_id ?? "", /masih bisa menyiapkan produk/i,
      "penolakan harus menyebut apa yang MASIH bisa dikerjakan, bukan cuma menutup pintu");
  }
});

test("setiap jalur yang membelanjakan memeriksa perannya", () => {
  const jalurBerbayar = [
    "app/api/dashboard/campaign/confirm/route.ts",   // menahan kredit per video
    "app/api/dashboard/matrix/route.ts",             // sampai 24 video sekali klik
    "app/api/dashboard/campaign/job/[jobId]/route.ts", // regenerate membakar uang provider; approve memfinalkan biaya
  ];
  for (const rel of jalurBerbayar) {
    assert.match(baca(rel), /pastikanBolehBelanja\(membership\.role\)/,
      `${rel} membelanjakan tanpa memeriksa peran`);
  }
});

test("UI memberi tahu di depan, bukan menolak di akhir", () => {
  const klien = baca("app/dashboard/(app)/matrix/MatrixClient.tsx");
  assert.match(klien, /const bolehBelanja = katalog\?\.role === "owner"/);
  assert.match(klien, /render berbayar dijalankan pemilik organisasi/,
    "member harus tahu sebelum menyusun 12 sel, bukan sesudah");
  assert.match(baca("app/api/dashboard/matrix/route.ts"), /role: membership\.role/,
    "peran harus dikirim ke klien supaya UI bisa jujur");
});
