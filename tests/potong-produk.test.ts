// Poster dipotong ke produknya sebelum dirender.
//
// ─────────────────────────────────────────────────────────────────────────────
// PERMINTAAN BRIAN, 4 SEP 2026
// ─────────────────────────────────────────────────────────────────────────────
//   "kebanyakan product image terdiri dari poster dan banyak tulisan, dapatkah
//    system ai anda mendeteksi object-object selain image yang ingin dibuatkan
//    iklan? ... dapatkah di buatkan khusus speaker yang dikenali?"
//
// Jawabannya sengaja BUKAN "khusus speaker". Mengkodekan satu jenis benda akan
// mengulang persis cacat yang dibereskan hari yang sama: prompt yang dipaku ke
// botol serum lalu dikirim untuk semua produk. Yang ditanyakan ke model
// penglihatan adalah "benda fisik yang dijual", dengan nama produk sebagai
// petunjuk — jadi ia bekerja untuk speaker, meja, keripik, dan apa pun
// berikutnya tanpa daftar yang harus dirawat.
//
// Terbukti pada foto asli job be16d8f3 (banner 320x320 dengan "BLUETOOTH
// SPEAKER", "+2 Wireless Mic", "1 YEAR WARRANTY", deretan ikon): kotak produk
// terdeteksi dan dipotong ke 210x281 — judul besar dan ikon hilang.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bacaKotak, kotakDenganMargin, kotakMasukAkal } from "../lib/media/potong-produk";

test("jawaban model dibaca, apa pun bungkusnya", () => {
  assert.deepEqual(bacaKotak('{"x0":0.1,"y0":0.2,"x1":0.8,"y1":0.9}'), { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 });
  // Model sering membungkus JSON dalam pagar kode atau kalimat pengantar.
  assert.deepEqual(bacaKotak('```json\n{"x0":0,"y0":0,"x1":1,"y1":1}\n```'), { x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.equal(bacaKotak("maaf, saya tidak bisa"), null);
  assert.equal(bacaKotak('{"x0":0.1}'), null, "kotak tidak lengkap harus ditolak");
});

test("koordinat 0..1000 ikut dimengerti", () => {
  // Sebagian model menjawab dalam skala 0..1000. Menganggapnya 0..1 akan
  // menghasilkan kotak raksasa yang lalu ditolak sebagai tidak masuk akal —
  // dan kita kehilangan pemotongan yang sebenarnya benar.
  assert.deepEqual(bacaKotak('{"x0":100,"y0":200,"x1":800,"y1":900}'), { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 });
});

test("kotak yang tidak masuk akal DITOLAK — foto utuh lebih baik", () => {
  // Hampir seluruh gambar: memotongnya tidak membuang poster, hanya
  // menyingkirkan margin yang berguna.
  assert.equal(kotakMasukAkal({ x0: 0, y0: 0, x1: 1, y1: 1 }), false);
  // Sangat kecil: hampir pasti salah tangkap — ikon, logo, atau badge.
  assert.equal(kotakMasukAkal({ x0: 0.4, y0: 0.4, x1: 0.45, y1: 0.45 }), false);
  // Terbalik / kosong.
  assert.equal(kotakMasukAkal({ x0: 0.8, y0: 0.1, x1: 0.2, y1: 0.9 }), false);
  // Kotak seperti yang benar-benar dikembalikan untuk speaker (210x281 dari
  // 320x320 = sekitar 58% luas).
  assert.equal(kotakMasukAkal({ x0: 0.05, y0: 0.05, x1: 0.7, y1: 0.93 }), true);
});

test("margin diberikan tapi tidak pernah keluar dari gambar", () => {
  // Memotong PAS di tepi benda membuat frame sesak dan memotong bayangan jatuh
  // yang justru membuatnya terlihat nyata.
  const k = kotakDenganMargin({ x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 });
  assert.ok(k.x0 < 0.3 && k.y0 < 0.3 && k.x1 > 0.7 && k.y1 > 0.7, "margin tidak diberikan");
  const tepi = kotakDenganMargin({ x0: 0, y0: 0, x1: 1, y1: 1 });
  assert.deepEqual(tepi, { x0: 0, y0: 0, x1: 1, y1: 1 }, "margin keluar dari gambar");
});

test("TIDAK dipaku ke satu jenis benda", () => {
  // Brian menanyakan "khusus speaker". Kalau nama benda apa pun muncul di
  // permintaan, fitur ini akan berhenti bekerja untuk kategori berikutnya —
  // dan kita baru saja membayar cacat berbentuk sama pada prompt skincare.
  const src = fs.readFileSync(path.join(process.cwd(), "lib/media/potong-produk.ts"), "utf8");
  const kode = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const benda of ["speaker", "bottle", "serum", "shoe", "phone"]) {
    assert.ok(!new RegExp(`\\b${benda}\\b`, "i").test(kode), `permintaan dipaku ke "${benda}"`);
  }
  assert.match(kode, /\$\{namaProduk\}/, "nama produk tidak dipakai sebagai petunjuk");
});

test("pemotongan hanya dijalankan untuk foto yang MEMANG poster", () => {
  // Foto produk polos tidak perlu dipotong, dan memanggil model penglihatan
  // untuknya hanya membakar waktu dan kuota — terutama saat Gemini sedang
  // penuh, yang terjadi 4 Sep 2026 ("experiencing high demand").
  const worker = fs.readFileSync(path.join(process.cwd(), "lib/postgres/worker.ts"), "utf8");
  assert.match(worker, /if \(periksa\.kataTerbaca < AMBANG_KATA_BANNER\) return berkas;/,
    "pemotongan dijalankan untuk semua foto, bukan hanya poster");
  // Dipotong SEBELUM ditegakkan: menegakkan poster utuh lalu memotongnya
  // berarti isian buram dihitung dari tulisan yang akan dibuang.
  assert.match(worker, /acuanTegak\(await potongDulu\(sh\.imageRefPath\)/,
    "urutan potong-lalu-tegakkan terbalik");
});

test("kegagalan deteksi TIDAK menjatuhkan render", () => {
  // Gemini menolak seluruh permintaan bergambar pada 4 Sep 2026. Video dari
  // poster utuh kurang bersih, tapi jauh lebih baik daripada tidak ada video.
  const src = fs.readFileSync(path.join(process.cwd(), "lib/media/potong-produk.ts"), "utf8");
  assert.match(src, /return \{ path: berkas, dipotong: false, alasan: `deteksi gagal/);
  // Dan sabarnya dibatasi: penyempurnaan tidak boleh menambah menit ke job.
  assert.match(src, /maksPercobaan: 2/);
});
