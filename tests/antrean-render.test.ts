// ANTREAN RENDER — pembatas ffmpeg supaya job tidak memakan mesin.
//
// Kenapa ini ada: ffmpeg mengambil CPU sebanyak yang diberikan. Di Render hal
// itu tersembunyi karena plan starter memang kecil dan `-threads 1` mengunci
// ffmpeg ke satu inti. Di server 8 core, kekecilan itu hilang — satu job bisa
// mengambil seluruh mesin, dan yang kalah adalah REQUEST HTTP yang sedang
// berjalan, bukan job berikutnya.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-antrean-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-antrean-storage-${process.pid}`;
process.env.FFMPEG_MAX_CONCURRENT = "2";
process.env.FFMPEG_QUEUE_TIMEOUT_MS = "250";

const A = await import("../lib/media/antrean-render");
const { config } = await import("../lib/config");

beforeEach(() => A.resetAntreanUntukUji());

const tunda = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("BATAS DIPATUHI — tidak pernah lebih dari N ffmpeg bersamaan", async () => {
  let sekarang = 0;
  let puncak = 0;
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      A.denganSlotRender(`job-${i}`, async () => {
        sekarang++;
        puncak = Math.max(puncak, sekarang);
        await tunda(15);
        sekarang--;
      }),
    ),
  );
  assert.equal(puncak, config.ffmpegMaxConcurrent, `puncak ${puncak} melampaui batas ${config.ffmpegMaxConcurrent}`);
  assert.deepEqual(A.statusAntrean(), { berjalan: 0, menunggu: 0, batas: 2 }, "slot bocor setelah semua selesai");
});

test("FIFO — yang datang duluan jalan duluan", async () => {
  // Tanpa urutan, job panjang bisa terus kalah oleh job pendek yang datang
  // belakangan dan tidak pernah selesai.
  const urutan: number[] = [];
  const semua = Array.from({ length: 6 }, (_, i) =>
    A.denganSlotRender(`job-${i}`, async () => { urutan.push(i); await tunda(10); }),
  );
  await Promise.all(semua);
  assert.deepEqual(urutan, [0, 1, 2, 3, 4, 5], `urutan tidak FIFO: ${urutan.join(",")}`);
});

test("SLOT KEMBALI walau ffmpeg GAGAL", async () => {
  // Slot yang bocor sekali saja menyusutkan kapasitas selamanya sampai proses
  // di-restart — kegagalan yang membesar diam-diam.
  await assert.rejects(() => A.denganSlotRender("gagal", async () => { throw new Error("ffmpeg meledak"); }), /meledak/);
  await assert.rejects(() => A.denganSlotRender("gagal-2", async () => { throw new Error("meledak lagi"); }), /meledak/);
  assert.deepEqual(A.statusAntrean(), { berjalan: 0, menunggu: 0, batas: 2 });

  // Dan kapasitas penuh masih tersedia sesudahnya.
  let puncak = 0, sekarang = 0;
  await Promise.all(Array.from({ length: 4 }, () =>
    A.denganSlotRender("sesudah-gagal", async () => { sekarang++; puncak = Math.max(puncak, sekarang); await tunda(10); sekarang--; })));
  assert.equal(puncak, 2, "kapasitas menyusut sesudah kegagalan — berarti slot bocor");
});

test("MENUNGGU ADA BATASNYA — macet jadi galat, bukan menggantung", async () => {
  // Dua slot diisi lama; yang ketiga harus menyerah, bukan menggantung.
  assert.equal(config.ffmpegQueueTimeoutMs, 250, "timeout uji tidak terpasang — config memasang batas bawah lagi?");
  const lama = [0, 1].map(() => A.denganSlotRender("panjang", () => tunda(2000)));
  await assert.rejects(
    () => A.denganSlotRender("kebagian-antre", async () => "tidak akan sampai sini"),
    /menyerah setelah menunggu/,
    "antrean penuh harus melempar galat yang bisa dibaca, bukan menggantung selamanya",
  );
  A.resetAntreanUntukUji();
  await Promise.allSettled(lama);
});

test("PEKERJAAN YANG MENUNGGU TETAP DIJALANKAN, bukan dibuang", async () => {
  const selesai: string[] = [];
  await Promise.all([
    A.denganSlotRender("a", async () => { await tunda(30); selesai.push("a"); }),
    A.denganSlotRender("b", async () => { await tunda(30); selesai.push("b"); }),
    A.denganSlotRender("c", async () => { await tunda(5); selesai.push("c"); }),
    A.denganSlotRender("d", async () => { await tunda(5); selesai.push("d"); }),
  ]);
  assert.equal(selesai.length, 4, `ada pekerjaan yang hilang: ${selesai.join(",")}`);
});

test("ffprobe TIDAK PERNAH diantre — inilah yang menjaga request tetap cepat", () => {
  // Sifat paling penting di modul ini, dan satu-satunya yang tidak bisa
  // dibuktikan lewat perilaku tanpa binary ffmpeg: runFfmpeg lewat antrean,
  // runFfprobe tidak. Kalau ffprobe ikut diantre, satu permintaan API
  // (validasi unggahan, cek durasi) akan menunggu render tiga menit selesai —
  // persis kerusakan yang antrean ini ada untuk mencegah.
  const src = fs.readFileSync(path.join(process.cwd(), "lib/media/ffmpeg.ts"), "utf8");
  const barisFfmpeg = src.match(/export const runFfmpeg =[\s\S]*?;\n/)?.[0] ?? "";
  const barisFfprobe = src.match(/export const runFfprobe =.*\n/)?.[0] ?? "";
  assert.match(barisFfmpeg, /denganSlotRender/, "runFfmpeg tidak lewat antrean");
  assert.doesNotMatch(barisFfprobe, /denganSlotRender/, "runFfprobe ikut diantre — request akan menunggu render");
});

test("THREAD ffmpeg mengikuti config, bukan angka mati", async () => {
  // Di Render `-threads 1` benar karena mesinnya kecil. Di server 8 core angka
  // itu membuang kapasitas. Yang salah bukan nilainya, tapi bahwa ia dipatok.
  const { boundedFfmpegArgs } = await import("../lib/media/ffmpeg");
  const args = boundedFfmpegArgs(["-i", "a.mp4", "out.mp4"]);
  assert.equal(args[0], "-threads");
  assert.equal(args[1], String(config.ffmpegThreads));
  assert.equal(args.filter((a) => a === "-threads").length, 1, "-threads terduplikasi");
});
