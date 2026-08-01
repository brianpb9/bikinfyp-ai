// Re-composite lokal untuk demo silent_caption: memakai ulang shot BytePlus yang
// SUDAH digenerate (tanpa panggilan API baru) dengan compositor versi terbaru.
// Dipakai untuk memperbaiki overlay setelah perubahan compositor tanpa biaya ulang.
// Jalankan: npx tsx scripts/recomposite-demo.ts <jobId> [outMp4]

import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { getDb, type ScriptRow, type ProductRow } from "../lib/db";
import { compositeVideo } from "../lib/media/compositor";
import { buildCaptionCards } from "../lib/media/captions";
import { renderCaptionPngs } from "../lib/media/render-captions";
import { formatHargaOverlay, type SegmentDraft } from "../lib/script-engine/templates";
import { probeDurationSec, volumeDetect } from "../lib/media/ffmpeg";

async function main() {
  const jobId = process.argv[2];
  if (!jobId) {
    console.log("pakai: npx tsx scripts/recomposite-demo.ts <jobId> [out.mp4]");
    process.exit(1);
  }
  const db = getDb();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as { id: string; script_id: string; product_id: string; duration_s: number; provider_video: string } | undefined;
  if (!job) throw new Error(`job ${jobId} tidak ada`);
  const script = db.prepare("SELECT * FROM scripts WHERE id = ?").get(job.script_id) as ScriptRow;
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(job.product_id) as ProductRow;
  const segments = JSON.parse(script.segments) as SegmentDraft[];
  const workDir = path.join(config.storageDir, "jobs", job.id);
  const clipPaths = [path.join(workDir, "shot0.mp4"), path.join(workDir, "shot1.mp4")];
  for (const c of clipPaths) if (!fs.existsSync(c)) throw new Error(`shot hilang: ${c}`);

  const cards = await renderCaptionPngs(buildCaptionCards({ segments, productName: product.name }), workDir);
  const res = await compositeVideo({
    jobId: job.id + "-recomp",
    workDir,
    clipPaths,
    mode: "caption",
    captions: cards,
    musicPath: path.join(process.cwd(), "assets", "music", "bg-loop.m4a"),
    durationSec: job.duration_s,
    priceText: `Cuma ${formatHargaOverlay(product.price_idr)}`,
    ctaText: "Cek keranjang kuning",
    demoRange: [3, 10],
    ctaRange: [10, 15],
    providerVideo: job.provider_video ?? "byteplus-ark-seedance",
  });

  const out = process.argv[3] ?? res.outPath;
  if (out !== res.outPath) fs.copyFileSync(res.outPath, out);
  const vol = await volumeDetect(out);
  console.log(`OK: ${out} (${await probeDurationSec(out)} dtk, max_volume ${vol.maxDb.toFixed(1)} dB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
