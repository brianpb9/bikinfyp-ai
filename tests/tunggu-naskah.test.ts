// Indikator tunggu saat naskah ditulis — dan janji yang TIDAK boleh dibuatnya.
//
// Catatan Brian 3 Sep 2026: "Ketika proses generate tidak ada progress bar.
// Hanya disable button dan tidak tau progress apakah berjalan atatu tidak."
//
// Yang dijaga tes ini dua hal, dan keduanya pernah salah di produk lain:
//
// 1. Lapisannya BENAR-BENAR dipasang di halaman yang memanggil
//    /api/scripts/generate, dan terikat ke keadaan `loading` yang sama dengan
//    yang mematikan tombolnya. Komponen bagus yang tidak dirender tidak
//    menolong siapa pun.
//
// 2. TIDAK ADA persentase. Rute itu menjawab sekali di akhir; tidak ada aliran
//    kemajuan dari server dan jumlah percobaan baru ketahuan sesudah selesai.
//    Bar yang merangkak ke 90% lalu diam adalah kebohongan kecil yang merusak
//    kepercayaan pada penantian berikutnya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * Buang komentar sebelum memeriksa.
 *
 * Percobaan pertama tes ini merah karena komentar yang MENJELASKAN kenapa tidak
 * ada persentase ikut tercocoki sebagai "ada persentase". Menghukum penjelasan
 * yang benar akan mengajari orang berikutnya menghapus penjelasannya, bukan
 * memperbaiki kodenya.
 */
const kodeSaja = (p: string) =>
  baca(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("halaman buat-skrip benar-benar merender lapisan tunggu, terikat ke loading", () => {
  const halaman = baca("app/bikin/gaya/page.tsx");
  assert.match(halaman, /import \{ TungguNaskah \}/, "komponennya tidak diimpor");
  assert.match(
    halaman, /<TungguNaskah terlihat=\{loading\} \/>/,
    "lapisan tunggu tidak terikat ke keadaan yang sama dengan yang mematikan tombol",
  );
  // Ia harus muncul pada permintaan yang MEMANG lama, yaitu generate().
  assert.match(halaman, /apiFetch<\{ scripts: FlowScript\[\] \}>\("\/api\/scripts\/generate"/);
});

test("indikatornya tidak mengarang persentase", () => {
  const kode = kodeSaja("app/_components/TungguNaskah.tsx");
  const komponen = baca("app/_components/TungguNaskah.tsx");
  assert.doesNotMatch(kode, /\bprogress\s*=|value=\{|aria-valuenow|%\s*selesai/i, "ada yang menyerupai bar determinate");
  assert.doesNotMatch(kode, /setPersen|persen\b/, "ada penghitung persentase karangan");
  // Yang boleh ditampilkan hanyalah yang benar-benar diketahui.
  assert.match(komponen, /Berjalan \{jam\}/, "waktu berjalan yang sungguhan tidak ditampilkan");
  assert.match(komponen, /Biasanya 20–40 detik/, "perkiraan lama tidak disebut");
});

test("waktu dihitung dari selisih jam, bukan dengan menambah sendiri tiap detik", () => {
  // Tab yang dilatarbelakangkan membuat interval dilambatkan browser. Penghitung
  // yang menambah 1 tiap tick akan melaporkan waktu LEBIH PENDEK daripada yang
  // benar-benar dilalui — persis pada orang yang menunggu paling lama, yaitu
  // orang yang paling butuh angkanya benar.
  const komponen = baca("app/_components/TungguNaskah.tsx");
  assert.match(komponen, /Date\.now\(\) - mulai\.current/, "waktu tidak dihitung dari selisih jam");
  assert.doesNotMatch(komponen, /setDetik\(\s*\(?d\)? *=> *d *\+ *1\s*\)/, "penghitung menambah sendiri tiap tick");
});

test("alasan penantian panjang disebut — bukan dibiarkan terasa seperti kerusakan", () => {
  const komponen = baca("app/_components/TungguNaskah.tsx");
  assert.match(komponen, /ditulis ulang/, "tidak menjelaskan kenapa bisa lama");
  assert.match(komponen, /skor viral/i, "tidak menghubungkannya dengan gerbang mutu");
});
