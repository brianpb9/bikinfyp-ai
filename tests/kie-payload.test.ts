// BENTUK PERMINTAAN kie.ai PER MODEL (Brian 9 Sep 2026).
//
// "Pastikan setiap request dan response yang dikirimkan sesuai dengan setiap
//  model yang digunakan. Hindari kekurangan payload yang menyebabkan proses
//  generation gagal."
//
// Tes ini mengunci bentuknya terhadap CONTOH RESMI yang Brian kirim. Medan yang
// hilang tidak menghasilkan galat di sini — ia menghasilkan tugas yang terkirim,
// ditagih, lalu gagal beberapa menit kemudian di sisi provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { badanKieVideo, badanKieGambar, MODEL_GAMBAR_KIE } from "../lib/kie-payload";

const ktx = {
  prompt: "hands hold the pouch",
  imageUrls: ["https://x.test/a.png"],
  aspectRatio: "9:16",
  durationSec: 15,
  resolution: "720p",
  generateAudio: true,
};

test("seedance-2-mini: medan sesuai contoh resmi, tidak kurang satu pun", () => {
  const b = badanKieVideo("bytedance/seedance-2-mini", ktx);
  // Daftar ini disalin dari contoh Brian. Kalau ada yang hilang, generation
  // gagal di provider — bukan di sini.
  for (const k of ["first_frame_url", "prompt", "generate_audio", "resolution",
                   "aspect_ratio", "duration", "web_search", "nsfw_checker"]) {
    assert.ok(k in b, `medan "${k}" hilang`);
  }
  assert.equal(b.first_frame_url, "https://x.test/a.png");
  assert.equal(b.duration, 15);
  assert.equal(b.nsfw_checker, true);
  // Medan milik model LAIN tidak boleh ikut.
  assert.ok(!("image_urls" in b), "membawa medan grok");
  assert.ok(!("reference_image_urls" in b), "membawa medan seedance-2-5");
});

test("last_frame_url DIHILANGKAN kalau tidak ada, bukan dikirim kosong", () => {
  // Medan kosong bukan "tidak diisi" bagi provider — ia URL tidak sah, dan
  // ditolak lebih keras daripada medan yang memang tidak ada.
  const tanpa = badanKieVideo("bytedance/seedance-2-mini", ktx);
  assert.ok(!("last_frame_url" in tanpa), "medan kosong ikut terkirim");

  const dengan = badanKieVideo("bytedance/seedance-2-mini", { ...ktx, lastFrameUrl: "https://x.test/z.png" });
  assert.equal(dengan.last_frame_url, "https://x.test/z.png");
});

test("seedance-2-5: memakai reference_image_urls, bukan first_frame_url", () => {
  const b = badanKieVideo("bytedance/seedance-2-5", { ...ktx, imageUrls: ["https://x.test/a.png", "https://x.test/b.png"] });
  for (const k of ["prompt", "reference_image_urls", "generate_audio", "resolution",
                   "aspect_ratio", "duration", "output_format", "web_search", "nsfw_checker"]) {
    assert.ok(k in b, `medan "${k}" hilang`);
  }
  assert.deepEqual(b.reference_image_urls, ["https://x.test/a.png", "https://x.test/b.png"]);
  assert.equal(b.output_format, "mp4");
  assert.ok(!("first_frame_url" in b), "membawa medan seedance-2-mini");
});

test("array rujukan kosong DIHILANGKAN", () => {
  // Sebagian model memperlakukan array kosong sebagai "ada rujukan tapi tak
  // terbaca" dan menolak permintaannya.
  const b = badanKieVideo("bytedance/seedance-2-5", { ...ktx, referenceVideoUrls: [], referenceAudioUrls: [] });
  assert.ok(!("reference_video_urls" in b), "array video kosong ikut terkirim");
  assert.ok(!("reference_audio_urls" in b), "array audio kosong ikut terkirim");

  const isi = badanKieVideo("bytedance/seedance-2-5", { ...ktx, referenceVideoUrls: ["https://x.test/v.mp4"] });
  assert.deepEqual(isi.reference_video_urls, ["https://x.test/v.mp4"]);
});

test("grok tetap memakai bentuk lamanya — tidak boleh ikut berubah", () => {
  // Model ini yang menghasilkan video produksi hari ini. Bentuknya berubah
  // berarti seluruh paket Standard berhenti jalan.
  const b = badanKieVideo("grok-imagine/image-to-video", ktx);
  assert.deepEqual(b, {
    image_urls: ["https://x.test/a.png"],
    index: 0,
    prompt: "hands hold the pouch",
    mode: "normal",
    aspect_ratio: "9:16",
    duration: 15,
    resolution: "720p",
    nsfw_checker: true,
  });
});

test("seedream 5-pro: model GAMBAR, bentuknya sendiri", () => {
  const b = badanKieGambar("seedream/5-pro-image-to-image", {
    prompt: "ganti teks",
    imageUrls: ["https://x.test/a.jpg"],
    aspectRatio: "1:1",
  });
  for (const k of ["prompt", "image_urls", "aspect_ratio", "quality", "output_format", "nsfw_checker"]) {
    assert.ok(k in b, `medan "${k}" hilang`);
  }
  assert.equal(b.quality, "basic");
  assert.equal(b.output_format, "png");
  assert.ok(MODEL_GAMBAR_KIE.includes("seedream/5-pro-image-to-image"), "tidak ditandai sebagai model gambar");
});

test("model tak dikenal DITOLAK, bukan ditebak bentuknya", () => {
  // Menjatuhkannya ke bentuk grok "supaya jalan" adalah cara terpelan untuk
  // membakar uang: tugasnya terkirim, ditagih, lalu gagal — dan lognya menunjuk
  // provider, bukan kita.
  assert.throws(() => badanKieVideo("model/yang-belum-ada", ktx), /belum punya pembangun payload/);
  assert.throws(() => badanKieGambar("model/yang-belum-ada", { prompt: "x", imageUrls: ["u"], aspectRatio: "1:1" }));
});

test("model yang menuntut gambar menolak permintaan tanpa gambar", () => {
  // Lebih baik gagal SEBELUM dikirim daripada membayar tugas yang pasti gagal.
  assert.throws(() => badanKieVideo("bytedance/seedance-2-mini", { ...ktx, imageUrls: [] }), /first_frame_url/);
  assert.throws(() => badanKieGambar("seedream/5-pro-image-to-image", { prompt: "x", imageUrls: [], aspectRatio: "1:1" }), /image_urls/);
});

test("nsfw_checker menyala di SETIAP model", () => {
  // Dikumpulkan di satu tempat supaya tidak ada model yang diam-diam lupa
  // mengaktifkan penyaring konten.
  for (const m of ["grok-imagine/image-to-video", "bytedance/seedance-2-mini", "bytedance/seedance-2-5"]) {
    assert.equal(badanKieVideo(m, ktx).nsfw_checker, true, `${m} tanpa nsfw_checker`);
  }
  assert.equal(badanKieGambar("seedream/5-pro-image-to-image",
    { prompt: "x", imageUrls: ["u"], aspectRatio: "1:1" }).nsfw_checker, true);
});

test("model baru terdaftar di katalog admin, dengan mesin yang benar", async () => {
  const { KATALOG_MODEL } = await import("../lib/katalog-model");
  for (const id of ["bytedance/seedance-2-mini", "bytedance/seedance-2-5"]) {
    const m = KATALOG_MODEL.find((x) => x.id === id);
    assert.ok(m, `model "${id}" tidak ada di katalog — admin tidak bisa memilihnya`);
    assert.equal(m!.mesin, "kie-grok", `${id} salah mesin`);
    // Durasi produksi kita 15 detik; model yang tidak sanggup akan menolak
    // SETIAP job, dengan HTTP 400 di ujung render.
    assert.ok(m!.maksDetik >= 15, `${id} tidak sanggup 15 detik`);
  }
});
