// Provider xAI Grok Imagine — kontrak yang menentukan UANG dan BENTUK KELUARAN.
//
// NOL PANGGILAN BERBAYAR: `fetch` dijebak dan dihitung. Satu render Grok 15
// detik berharga ~Rp19.560; test yang "kebetulan" memanggil API sungguhan
// membakar uang tiap kali suite dijalankan.
//
// Empat sifat yang dijaga, dan semuanya soal kegagalan yang baru terlihat
// SESUDAH dibayar:
//
//   1. Tanpa gambar awal, Grok mengeluarkan 848x480 LANDSCAPE. Untuk feed 9:16
//      itu barang rusak — dan baru ketahuan setelah render selesai.
//   2. Tier bisu tidak bisa dilayani: audio Grok selalu menyala.
//   3. Tarif model tak dikenal tidak boleh ditebak — menebak tarif = menebak
//      margin, dan margin itulah alasan mesin ini dipilih.
//   4. Percobaan ulang wajib melanjutkan task yang sudah dibayar.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.XAI_API_KEY = "kunci-uji";

const { xaiGrokVideo, biayaIdr, MAKS_DETIK_PER_KLIP } = await import("../lib/providers/stubs/xai-grok");
const { setTaskMemo, taskMemo } = await import("../lib/providers/task-memo");
// Impl bawaan disimpan supaya bisa DIKEMBALIKAN. `setTaskMemo(undefined)` tidak
// sah — tipenya menuntut TaskMemo, dan menyetel undefined membuat memo meledak
// di test berikutnya dengan galat yang menyamar sebagai cacat provider.
const memoBawaan = taskMemo();
const { config } = await import("../lib/config");

const fetchAsli = globalThis.fetch;
let panggilanFetch = 0;
beforeEach(() => {
  panggilanFetch = 0;
  globalThis.fetch = (async (...a: unknown[]) => {
    panggilanFetch++;
    throw new Error(`fetch TIDAK boleh dipanggil di test ini: ${String(a[0])}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = fetchAsli;
  setTaskMemo(memoBawaan);
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-uji-"));
const fotoPotret = path.join(dir, "potret.jpg");
fs.writeFileSync(fotoPotret, Buffer.from("BYTES-FOTO"));

function spec(ubah: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    width: 1080,
    height: 1920,
    negativePrompt: "no text, no logo, no writing",
    qualityTier: "super_hq",
    generateAudio: true,
    shots: [{ index: 0, durationSec: 15, prompt: "seseorang memegang produk", imageRefPath: fotoPotret }],
    ...ubah,
  } as never;
}

test("BIAYA: tarif diambil dari tabel, bukan ditebak", () => {
  // Rp19.560 = $0,08 x 15 detik x Rp16.300. Angka inilah yang membuat Grok 1.5
  // dipilih untuk super_hq; kalau ia meleset, seluruh alasan pemilihannya batal.
  assert.equal(biayaIdr("grok-imagine-video-1.5", 15), 19_560);
  assert.equal(biayaIdr("grok-imagine-video", 15), 12_225);
  assert.equal(config.usdIdr, 16_300, "kurs berubah — angka margin di dokumen ikut berubah");
});

test("BIAYA: model tak dikenal MELEMPAR, tidak diam-diam nol", () => {
  // Mengembalikan 0 untuk model asing membuat margin terlihat sempurna pada
  // mesin yang harganya tidak pernah diperiksa siapa pun.
  assert.throws(() => biayaIdr("grok-imagine-video-9.9", 15), /tidak diketahui/);
});

test("estimateCost menjumlahkan seluruh shot", () => {
  const c = xaiGrokVideo.estimateCost(spec({
    shots: [
      { index: 0, durationSec: 15, prompt: "a", imageRefPath: fotoPotret },
      { index: 1, durationSec: 10, prompt: "b", imageRefPath: fotoPotret },
    ],
  }));
  assert.equal(c, 19_560 + biayaIdr("grok-imagine-video-1.5", 10));
});

test("TANPA gambar awal DITOLAK — kalau lolos, keluarannya landscape", async () => {
  await assert.rejects(
    () => xaiGrokVideo.generate(spec({ shots: [{ index: 0, durationSec: 15, prompt: "a" }] }), dir),
    /tanpa imageRefPath|landscape/i,
    "shot tanpa gambar acuan diteruskan ke API; Grok tidak punya parameter rasio, jadi hasilnya 848x480",
  );
  assert.equal(panggilanFetch, 0, "API dipanggil padahal spec-nya sudah pasti menghasilkan barang rusak");
});

test("TIER BISU ditolak — audio Grok tidak bisa dimatikan", async () => {
  await assert.rejects(
    () => xaiGrokVideo.generate(spec({ qualityTier: "silent_caption", generateAudio: false }), dir),
    /BISU|audio/i,
  );
  assert.equal(panggilanFetch, 0);
});

test("DURASI di atas batas ditolak sebelum menyentuh API", async () => {
  await assert.rejects(
    () => xaiGrokVideo.generate(
      spec({ shots: [{ index: 0, durationSec: MAKS_DETIK_PER_KLIP + 1, prompt: "a", imageRefPath: fotoPotret }] }),
      dir,
    ),
    /melebihi batas/,
  );
  assert.equal(panggilanFetch, 0);
});

test("gambar acuan yang TIDAK ADA ditolak, bukan dikirim sebagai base64 kosong", async () => {
  await assert.rejects(
    () => xaiGrokVideo.generate(
      spec({ shots: [{ index: 0, durationSec: 15, prompt: "a", imageRefPath: path.join(dir, "hilang.jpg") }] }),
      dir,
    ),
    /tidak ada/,
  );
  assert.equal(panggilanFetch, 0);
});

test("RETRY melanjutkan task yang sudah dibayar, tidak submit ulang", async () => {
  // Tanpa ini xAI menagih DUA KALI untuk shot yang sama setiap kali worker mati
  // saat polling.
  let diminta = 0;
  setTaskMemo({
    async get() { diminta++; return "task-lama"; },
    async put() { throw new Error("put() dipanggil — berarti task BARU dikirim, dan itu tagihan kedua"); },
  } as never);

  // SELURUH url dicatat, bukan yang terakhir: url terakhir adalah UNDUHAN, dan
  // memeriksa itu tidak membuktikan apa pun soal task mana yang dipolling.
  const urls: string[] = [];
  globalThis.fetch = (async (u: unknown) => {
    panggilanFetch++;
    const url = String(u);
    urls.push(url);
    if (url.includes("/videos/task-lama")) {
      return { ok: true, json: async () => ({ status: "done", url: "https://x/v.mp4" }) } as never;
    }
    return { ok: true, arrayBuffer: async () => Buffer.from("VIDEO").buffer } as never;
  }) as unknown as typeof fetch;

  const aset = await xaiGrokVideo.generate(spec(), dir);
  assert.equal(diminta, 1, "memo tidak diperiksa — retry akan submit ulang dan menagih dua kali");
  assert.ok(
    urls.some((u) => u.includes("/videos/task-lama")),
    `task lama tidak dipolling; url yang dipanggil: ${JSON.stringify(urls)}`,
  );
  assert.ok(
    !urls.some((u) => u.includes("/videos/generations")),
    "task BARU dikirim padahal memo punya yang lama — ini tagihan kedua",
  );
  assert.equal(aset[0].costIdr, 19_560);
  assert.equal(aset[0].hasAudio, true);
  assert.ok(fs.existsSync(aset[0].filePath), "berkas video tidak ditulis");
});

test("healthCheck jujur soal kunci", async () => {
  assert.equal(await xaiGrokVideo.healthCheck(), true);
});
