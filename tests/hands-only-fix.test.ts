// Unit test: prompt hands_only melarang wajah + negative per-format + QC-03.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

process.env.DB_PATH = `/tmp/racun-test-handsfix-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-handsfix-storage-${process.pid}`;

const { planShots, HANDS_ONLY_NEGATIVE } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
const { qcProductSimilarity } = await import("../lib/media/qc");

const hijaber = getCreatorCategory("hijaber")!;
const segments = [
  { role: "hook" as const, start: 0, end: 3, text: "Say, masa 85 ribu segini sih", visual_direction: "x" },
  { role: "demo" as const, start: 3, end: 10, text: "nah, ini Serum Glow, teksturnya niat, cuma 85 ribu", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "Cek keranjang kuning ya deh", visual_direction: "x" },
];

function spec(format: "hands_only" | "vo_broll" = "hands_only") {
  return planShots({
    jobId: "t1",
    durationSec: 15,
    segments,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: "botol dropper amber 30ml, label putih tulisan hitam",
    imageRefPath: "/tmp/x.png",
    qualityTier: "silent_caption",
    format,
  });
}

test("hands_only: base prompt mengandung framing larangan wajah eksplisit", () => {
  const s = spec();
  for (const shot of s.shots) {
    assert.ok(shot.prompt.includes("hands and forearms only"), shot.prompt);
    assert.ok(shot.prompt.includes("face and body NOT visible"), shot.prompt);
  }
});

test("hands_only: negative melarang wajah total & tidak lagi 'no face distortion'", () => {
  const s = spec();
  assert.ok(s.negativePrompt.includes("no face"), s.negativePrompt);
  assert.ok(s.negativePrompt.includes("no head in frame"), s.negativePrompt);
  assert.ok(!/no face distortion/i.test(s.negativePrompt), s.negativePrompt);
  assert.ok(s.negativePrompt.includes("no text"), "negative wajib tetap mengandung 'no text'");
});

test("format lain (vo_broll): negative kategori tidak diubah", () => {
  const s = spec("vo_broll");
  assert.equal(s.negativePrompt, hijaber.negativePrompt);
  for (const shot of s.shots) {
    assert.ok(!shot.prompt.includes("face and body NOT visible"));
  }
});

test("kedua shot membawa instruksi konservasi identitas produk + deskripsi visual user", () => {
  const s = spec();
  assert.ok(s.shots[0].prompt.includes("identical packaging"), s.shots[0].prompt);
  assert.ok(s.shots[1].prompt.includes("the same product as in shot 1"), s.shots[1].prompt);
  assert.ok(s.shots[0].prompt.includes("botol dropper amber 30ml"), "deskripsi visual user harus masuk prompt");
});

// --- QC-03 dengan gambar/video sintetis ---
function makeVideo(color: [number, number, number], out: string) {
  execFileSync("python3", [
    "-c",
    `from PIL import Image; img = Image.new("RGB",(720,1280),(240,235,225));
from PIL import ImageDraw; d = ImageDraw.Draw(img); d.rectangle([216,384,504,896], fill=tuple(${JSON.stringify(color)}));
img.save("${out.replace(".mp4", ".png")}")`,
  ]);
  execFileSync(process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg", [
    "-y", "-v", "error", "-loop", "1", "-i", out.replace(".mp4", ".png"),
    "-t", "2", "-pix_fmt", "yuv420p", out,
  ]);
}

test("QC-03: shot menyimpang total (amber->putih) DITOLAK; shot konsisten LOLOS", async () => {
  const dir = `/tmp/qc03-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const ref = `${dir}/ref.png`;
  execFileSync("python3", [
    "-c",
    `from PIL import Image; img = Image.new("RGB",(720,1280),(240,235,225));
from PIL import ImageDraw; d = ImageDraw.Draw(img); d.rectangle([216,384,504,896], fill=(140,85,40));
img.save("${ref}")`,
  ]);
  const amber = `${dir}/amber.mp4`;
  const amber2 = `${dir}/amber2.mp4`;
  const putih = `${dir}/putih.mp4`;
  makeVideo([140, 85, 40], amber);
  makeVideo([150, 95, 50], amber2);
  makeVideo([235, 235, 235], putih);

  const konsisten = await qcProductSimilarity([amber, amber2], ref, dir);
  assert.equal(konsisten.status, "pass", konsisten.detail);

  const menyimpang = await qcProductSimilarity([amber, putih], ref, dir);
  assert.equal(menyimpang.status, "fail", menyimpang.detail);
  assert.ok(menyimpang.detail!.includes("hue_khas_min") || menyimpang.detail!.includes("antar_shot_max"));
});

test("QC-09: detektor YuNet jalan dan melaporkan 0 wajah pada gambar polos", async () => {
  const { qcNoFace } = await import("../lib/media/qc");
  const dir = `/tmp/qc09-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const plain = `${dir}/plain.mp4`;
  makeVideo([140, 85, 40], plain);
  const res = await qcNoFace([plain], dir);
  assert.equal(res.status, "pass", res.detail);
});
