// Foto produk yang tidak layak ditolak SEBELUM jatah kredit terpotong, dan
// acuan yang tidak tegak ditegakkan sebelum dikirim ke mesin.
//
// ─────────────────────────────────────────────────────────────────────────────
// KEGAGALAN YANG DIJAGA (job be16d8f3, 4 Sep 2026)
// ─────────────────────────────────────────────────────────────────────────────
// Foto yang dipakai adalah banner promosi marketplace 320x320: "advance
// Digitals · BLUETOOTH SPEAKER · +2 Wireless Mic · K-1812-C · 1 YEAR WARRANTY".
// Dua akibatnya terlihat langsung di video jadi:
//   1. Model MENYALIN tulisan banner dan menempelkannya setengah transparan
//      sepanjang video — "bayangan" yang dilaporkan Brian.
//   2. Videonya keluar 960x960 PERSEGI karena mesin mengikuti rasio acuan dan
//      mengabaikan parameter aspect_ratio yang kami kirim.
// Rp13.500 keluar untuk tiga percobaan yang semuanya ditolak QC.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AMBANG_IDEAL_PX, AMBANG_TOLAK_PX, periksaFotoProduk, perluDitegakkan } from "../lib/media/foto-produk";
import { acuanTegak } from "../lib/media/acuan-tegak";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fotouji-"));

async function buatGambar(nama: string, lebar: number, tinggi: number): Promise<string> {
  const f = path.join(dir, nama);
  await sharp({ create: { width: lebar, height: tinggi, channels: 3, background: { r: 200, g: 200, b: 210 } } })
    .png().toFile(f);
  return f;
}

test("foto seukuran job be16d8f3 (320x320) DITOLAK, dengan alasan yang bisa ditindaklanjuti", async () => {
  const f = await buatGambar("kecil.png", 320, 320);
  const p = await periksaFotoProduk(f);
  assert.equal(p.ditolak, true, "foto 320px masih diterima — biayanya sudah pernah dibayar");
  // Alasannya harus menyebut APA yang salah dan APA yang harus dilakukan.
  // "Foto tidak valid" mengirim orang menebak-nebak.
  assert.match(p.alasanTolak ?? "", /320x320/, "ukurannya tidak disebut");
  assert.match(p.alasanTolak ?? "", /lebih besar|minimal/i, "tindakannya tidak disebut");
});

test("foto layak DITERIMA — gerbang tidak boleh asal ketat", async () => {
  const f = await buatGambar("bagus.png", 1200, 1200);
  const p = await periksaFotoProduk(f);
  assert.equal(p.ditolak, false, `foto 1200px ditolak: ${p.alasanTolak}`);
});

test("antara ambang tolak dan ideal: LOLOS dengan peringatan, bukan diblokir", async () => {
  // Memblokir semua di bawah 1000 px akan menolak sebagian besar tautan
  // marketplace yang sah — obat yang lebih buruk daripada penyakitnya.
  assert.ok(AMBANG_TOLAK_PX < AMBANG_IDEAL_PX, "dua ambang harus berbeda");
  const f = await buatGambar("sedang.png", 700, 700);
  const p = await periksaFotoProduk(f);
  assert.equal(p.ditolak, false, "foto 700px seharusnya lolos");
  assert.ok(p.peringatan.some((x) => /piksel/.test(x)), "tidak ada peringatan ukuran");
});

test("foto persegi dikenali perlu ditegakkan, foto 9:16 tidak disentuh", () => {
  assert.equal(perluDitegakkan(320, 320), true, "persegi harus ditegakkan");
  assert.equal(perluDitegakkan(720, 1280), false, "9:16 tidak boleh diproses ulang");
  assert.equal(perluDitegakkan(1080, 1920), false, "9:16 ukuran lain juga tidak");
});

test("penegakan menghasilkan 9:16 dan TIDAK memotong produknya", async () => {
  const f = await buatGambar("persegi.png", 800, 800);
  const keluar = await acuanTegak(f, path.join(dir, "kerja"));
  assert.notEqual(keluar, f, "foto persegi tidak ditegakkan");
  const meta = await sharp(keluar).metadata();
  assert.equal(meta.width, 720);
  assert.equal(meta.height, 1280);
});

test("foto yang sudah tegak dikembalikan APA ADANYA", async () => {
  // Memproses ulang gambar yang sudah benar hanya menambah langkah yang bisa
  // gagal, tanpa menghasilkan apa pun.
  const f = await buatGambar("tegak.png", 720, 1280);
  assert.equal(await acuanTegak(f, path.join(dir, "kerja2")), f);
});

test("kegagalan penegakan TIDAK menjatuhkan render", async () => {
  // Video persegi jauh lebih baik daripada tidak ada video.
  const hilang = path.join(dir, "tidak-ada.png");
  assert.equal(await acuanTegak(hilang, path.join(dir, "kerja3")), hilang);
});

test("rute job memeriksa foto SEBELUM jatah terpotong", () => {
  const rute = fs.readFileSync(path.join(process.cwd(), "app/api/jobs/route.ts"), "utf8");
  const posPeriksa = rute.indexOf("periksaFotoProduk");
  // Yang dicari PEMANGGILANNYA, bukan baris impor di kepala berkas — impor
  // selalu lebih dulu, dan tes yang membandingkannya akan selalu merah.
  const posPotong = rute.indexOf("await smokeCreateJob(");
  assert.ok(posPeriksa > 0, "pemeriksaan foto tidak dipasang di rute job");
  assert.ok(posPotong > 0, "pemanggilan pembuat job tidak ketemu");
  assert.ok(
    posPeriksa < posPotong,
    "foto diperiksa SESUDAH jatah terpotong — berarti mengembalikan kredit untuk sesuatu yang bisa ditolak lebih dulu",
  );
});
