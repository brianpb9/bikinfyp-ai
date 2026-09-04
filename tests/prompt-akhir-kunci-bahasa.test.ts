// Audit B6/B8 (19 Agu 2026): kunci bahasa 4 lapis, "no English speech", dan
// kunci UKURAN ASLI produk (§C.10) diklaim dokumen tapi TIDAK ADA di prompt
// akhir maupun di gerbang mana pun. Skrip berbahasa Inggris penuh lolos, dan
// produk raksasa di bidang depan tidak dicegah apa pun.
//
// Tes ini merah pada kode lama; ia mengunci tiga hal:
//   1. perakit prompt menaruh keempat lapis + kunci ukuran,
//   2. gerbang prompt akhir MENOLAK (hard) prompt yang kehilangan salah satunya,
//   3. frasa yang kita tambahkan sendiri tidak memicu penyaring penyedia.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-kunci-bahasa-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-kunci-bahasa-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
const { periksaPemicu } = await import("../lib/media/pemicu-filter");
const { periksaPromptAkhir } = await import("../lib/media/gerbang-prompt");

const SEGMENTS = [
  { role: "hook", start: 0, end: 5, text: "Kak, ini beneran ngefek?", visual_direction: "close-up produk" },
  { role: "demo", start: 5, end: 11, text: "Dipakai tiap malam, dua minggu.", visual_direction: "tangan memakai produk" },
  { role: "cta", start: 11, end: 15, text: "Detailnya ada di bawah ya.", visual_direction: "produk hero" },
] as never;

function spec(format: "ads" | "talking_head" | "hands_only") {
  return planShots({
    jobId: "uji-kunci-bahasa",
    durationSec: 15,
    segments: SEGMENTS,
    category: getCreatorCategory("hijaber")!,
    productName: "Serum Glow Bening",
    productCategory: "beauty",
    imageRefPath: "/tmp/uji-produk.jpg",
    qualityTier: "super_hq",
    format,
  } as never) as { shots: { prompt: string }[]; negativePrompt: string };
}

for (const format of ["ads", "talking_head", "hands_only"] as const) {
  test(`[${format}] prompt akhir memuat kunci bahasa 4 lapis + no English speech`, () => {
    const prompt = spec(format).shots[0].prompt;
    assert.match(prompt, /Every spoken word is Indonesian/, "lapis 1 (header) hilang");
    assert.match(prompt, /\(Bahasa Indonesia\)/, "lapis 2 (per shot bicara) hilang");
    assert.match(prompt, /Indonesian dialogue/i, "lapis 3 (label dialog) hilang");
    assert.match(prompt, /no English speech/i, "lapis 4 hilang");
  });

  test(`[${format}] prompt akhir mengunci ukuran ASLI produk (§C.10)`, () => {
    const prompt = spec(format).shots[0].prompt;
    assert.match(prompt, /true real-world size/i, "kunci ukuran asli hilang — produk raksasa tidak dicegah");
    assert.match(prompt, /normal conversational distance/i);
  });

  test(`[${format}] kunci baru tidak memicu penyaring penyedia`, () => {
    const s = spec(format);
    for (const sh of s.shots) {
      const negasi = periksaPemicu(sh.prompt, { namaProduk: "Serum Glow Bening" }).filter((t) => t.jenis === "negasi-orang");
      assert.deepEqual(negasi, [], `prompt ${format} memicu negasi-orang: ${JSON.stringify(negasi)}`);
    }
  });

  test(`[${format}] gerbang prompt akhir MELULUSKAN prompt yang benar`, () => {
    const s = spec(format);
    const temuan = periksaPromptAkhir({
      shots: s.shots.map((sh, i) => ({ index: i, prompt: sh.prompt })),
      negativePrompt: s.negativePrompt,
      namaProduk: "Serum Glow Bening",
      format,
      withAudio: true,
    });
    assert.deepEqual(temuan.filter((t) => t.keras), [], `gerbang menolak prompt sah: ${JSON.stringify(temuan)}`);
  });
}

test("gerbang MENOLAK (keras) prompt tanpa kunci bahasa", () => {
  const temuan = periksaPromptAkhir({
    shots: [{ index: 0, prompt: "A woman speaks to camera holding the product at its true real-world size, about the width of a hand, the camera keeps a normal conversational distance from it." }],
    negativePrompt: "blurry",
    namaProduk: "Serum Glow Bening",
    format: "talking_head",
    withAudio: true,
  });
  assert.ok(temuan.some((t) => t.keras && t.aturan === "BAHASA"), `harus ada temuan keras BAHASA: ${JSON.stringify(temuan)}`);
});

test("gerbang MENOLAK (keras) prompt tanpa kunci ukuran asli", () => {
  const temuan = periksaPromptAkhir({
    shots: [{ index: 0, prompt: 'Every spoken word is Indonesian. She speaks Indonesian (Bahasa Indonesia). Indonesian dialogue: "halo". no English speech.' }],
    negativePrompt: "blurry",
    namaProduk: "Serum Glow Bening",
    format: "talking_head",
    withAudio: true,
  });
  assert.ok(temuan.some((t) => t.keras && t.aturan === "UKURAN"), `harus ada temuan keras UKURAN: ${JSON.stringify(temuan)}`);
});

test("gerbang MENOLAK (keras) kosakata pemicu di prompt akhir — bukan lagi peringatan", () => {
  const temuan = periksaPromptAkhir({
    shots: [{ index: 0, prompt: 'Every spoken word is Indonesian. She speaks Indonesian (Bahasa Indonesia). Indonesian dialogue: "halo". no English speech. Every product in frame is at its true real-world size, about the width of a hand, and the camera keeps a normal conversational distance from it. She steps into the shower holding a towel.' }],
    negativePrompt: "blurry",
    namaProduk: "Serum Glow Bening",
    format: "talking_head",
    withAudio: true,
  });
  const kosakata = temuan.filter((t) => t.aturan === "L-21-KOSAKATA");
  assert.ok(kosakata.length > 0, "kosakata pemicu harus terdeteksi");
  assert.ok(kosakata.every((t) => t.keras), `kosakata harus KERAS sekarang: ${JSON.stringify(kosakata)}`);
});

test("gerbang tetap MENOLAK negasi tentang orang (perilaku lama dipertahankan)", () => {
  const temuan = periksaPromptAkhir({
    shots: [{ index: 0, prompt: 'Every spoken word is Indonesian. She speaks Indonesian (Bahasa Indonesia). Indonesian dialogue: "halo". no English speech. true real-world size, about the width of a hand, normal conversational distance. no second person in frame.' }],
    negativePrompt: "blurry",
    namaProduk: "Serum Glow Bening",
    format: "talking_head",
    withAudio: true,
  });
  assert.ok(temuan.some((t) => t.keras && t.aturan === "L-21-NEGASI"), `negasi-orang harus tetap keras: ${JSON.stringify(temuan)}`);
});

test("vo_broll: gerbang dilewati — tidak ada penyedia video yang dipanggil", () => {
  const temuan = periksaPromptAkhir({
    shots: [{ index: 0, prompt: "pan over the user's own product photo" }],
    negativePrompt: "",
    namaProduk: "Serum Glow Bening",
    format: "vo_broll",
    withAudio: true,
  });
  assert.deepEqual(temuan, [], "vo_broll tidak memanggil penyedia video, jadi tidak ada penyaring yang bisa menolaknya");
});

test("planShots menolak kategori cacat, tidak menyelundupkan 'undefined' ke prompt berbayar", () => {
  assert.throws(
    () => planShots({
      jobId: "uji-kategori-cacat", durationSec: 15, segments: SEGMENTS,
      category: "hijaber" as never, productName: "Serum Glow Bening", productCategory: "beauty",
      imageRefPath: "/tmp/x.jpg", qualityTier: "super_hq", format: "ads",
    } as never),
    /kategori kreator tidak sah/i
  );
});
