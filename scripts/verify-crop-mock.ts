// Verifikasi fix crop (jalur MOCK): foto uji persegi 800×800 dengan teks di pojok
// kiri-atas ("MEREK") dan kanan-bawah ("Rp85RB") -> render video silent_caption
// lewat pipeline asli (mock) -> ekstrak frame. Frame dicek manusia/agent:
// kedua teks harus terbaca UTUH (tidak kepotong cover-crop).
// Jalankan: npx tsx scripts/verify-crop-mock.ts

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../lib/config";
import { renderZoompanShot } from "../lib/providers/mock/shared";
import { compositeVideo } from "../lib/media/compositor";
import { buildCaptionCards } from "../lib/media/captions";
import { renderCaptionPngs } from "../lib/media/render-captions";
import { runFfmpeg } from "../lib/media/ffmpeg";

const OUT_DIR = path.resolve(process.cwd(), "..", "test_output", "crop_fix");
const IMG = path.join(OUT_DIR, "foto_uji_persegi.png");

async function makeTestImage() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const py = `
from PIL import Image, ImageDraw, ImageFont
img = Image.new("RGB", (800, 800), (230, 220, 200))
d = ImageDraw.Draw(img)
f = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 64)
d.rectangle([300, 300, 500, 500], fill=(180, 60, 40))
d.text((405, 385), "P", font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 90), fill="white", anchor="mm")
d.text((12, 12), "MEREK", font=f, fill="black", stroke_width=2, stroke_fill="white")
d.text((788, 788), "Rp85RB", font=f, fill="black", stroke_width=2, stroke_fill="white", anchor="rd")
img.save("${IMG}")
print("ok")
`;
  execFileSync("python3", ["-c", py]);
}

async function main() {
  await makeTestImage();
  const workDir = path.join(OUT_DIR, "work");
  fs.mkdirSync(workDir, { recursive: true });

  // 2 shot mock (zoom-in & zoom-out) dari foto persegi
  const shots = [];
  for (const [i, dir] of [[0, "in"], [1, "out"]] as const) {
    shots.push(
      await renderZoompanShot({
        shot: { index: i, durationSec: 7.5, prompt: "test", imageRefPath: IMG },
        outPath: path.join(workDir, `shot${i}.mp4`),
        width: 720, height: 1280, direction: dir, costIdr: 0,
      })
    );
  }

  const segments = [
    { role: "hook" as const, start: 0, end: 3, text: "Say, masa 85 ribu dapet kualitas kayak gini sih? aku ngecek ulang loh", visual_direction: "x" },
    { role: "demo" as const, start: 3, end: 10, text: "nah jadi gini, ini Serum Glow Bright. teksturnya tuh niat banget, harganya cuma 85 ribu", visual_direction: "x" },
    { role: "cta" as const, start: 10, end: 15, text: "Cek keranjang kuning ya, tinggal CO aja deh", visual_direction: "x" },
  ];
  const cards = await renderCaptionPngs(buildCaptionCards({ segments, productName: "Serum Glow Bright" }), workDir);

  const res = await compositeVideo({
    jobId: "crop-fix-mock",
    workDir,
    clipPaths: shots.map((s) => s.filePath),
    mode: "caption",
    captions: cards,
    musicPath: path.join(process.cwd(), "assets", "music", "bg-loop.m4a"),
    durationSec: 15,
    priceText: "Cuma Rp85.000",
    ctaText: "Cek keranjang kuning",
    demoRange: [3, 10],
    ctaRange: [10, 15],
    providerVideo: "mock-video-a",
  });

  const outVideo = path.join(OUT_DIR, "mock_silent_caption.mp4");
  fs.copyFileSync(res.outPath, outVideo);
  // Frame awal & akhir tiap shot (zoom paling ekstrem di ujung-ujung)
  for (const t of [0.2, 3.9, 7.3, 11, 14.5]) {
    await runFfmpeg(["-y", "-v", "error", "-ss", String(t), "-i", outVideo, "-frames:v", "1", path.join(OUT_DIR, `frame_${String(t).replace(".", "_")}s.png`)]);
  }
  console.log(`OK: ${outVideo}`);
  console.log("Frame bukti di", OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
