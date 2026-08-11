// Eksperimen kelayakan "Viral Hook + Produk" (ide Brian 2026-08-09, terinspirasi
// viralhooks.org — tapi versi mereka itu library TRANSISI VIDEO manual, bukan
// AI-generated). Tes: bisakah Seedance/BytePlus menghasilkan transisi ala-viral
// (whip-pan/snap-zoom) yang mendarat di reveal produk, dalam SATU shot i2v?
// Bukan bagian dari pipeline produksi — murni tes visual, tanpa TTS/QC/script-engine.
import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
function imageToDataUri(p: string): string {
  const buf = fs.readFileSync(p);
  const mime = MIME[path.extname(p).toLowerCase()] ?? "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const REF = path.join(process.cwd(), "storage/lab-scarlettskin-clean/0.jpg");
const OUT_DIR = path.join(process.cwd(), "test_output/viral-hook-test");
fs.mkdirSync(OUT_DIR, { recursive: true });

const VARIANTS: Record<string, string> = {
  "whip-pan-reveal":
    "Vertical 9:16 UGC phone video. Fast dramatic whip-pan camera transition: starts as a blurry fast pan across a bedroom, camera whips and snaps to a sudden sharp stop framing a hand holding up the skincare product bottle directly at camera, sharp focus landing exactly on the product label, slight snap-zoom punch-in on landing, natural handheld phone camera energy, warm cozy room with fairy lights, no text, no logo overlay, no writing added",
  "spin-flip-reveal":
    "Vertical 9:16 UGC phone video. Camera does a fast spinning flip transition (like a coin flip camera move), motion-blurred spin, then snaps into sharp focus landing on a hand holding the skincare product bottle up close to camera, quick punch-in zoom on landing for emphasis, natural handheld phone energy, cozy bedroom background with fairy lights, no text, no logo overlay, no writing added",
};

async function apiRequest(method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function submitVariant(key: string, prompt: string): Promise<string> {
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: `${prompt}. Negative: text, logo, watermark, extra fingers, morphing hands, low quality, blurry product label` },
      { type: "image_url", image_url: { url: imageToDataUri(REF) } },
    ],
    generate_audio: false,
    resolution: "720p",
    ratio: "9:16",
    duration: 5,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${key}] task ${res.id} dikirim`);
  return res.id;
}

async function pollAndDownload(key: string, taskId: string) {
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > 8 * 60_000) throw new Error(`[${key}] timeout 8mnt`);
    await new Promise((r) => setTimeout(r, 8000));
    const t = await apiRequest("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${taskId}`);
    console.log(`[${key}] ${Math.round((Date.now() - startedAt) / 1000)}s ${t.status}`);
    if (t.status === "succeeded") {
      const url = t.content?.video_url;
      if (!url) throw new Error(`[${key}] sukses tapi tanpa video_url`);
      const videoRes = await fetch(url);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outPath = path.join(OUT_DIR, `${key}.mp4`);
      fs.writeFileSync(outPath, buf);
      console.log(`[${key}] SELESAI: ${outPath}`);
      return;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) {
      throw new Error(`[${key}] ${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
  }
}

async function main() {
  const tasks: Record<string, string> = {};
  for (const [key, prompt] of Object.entries(VARIANTS)) {
    tasks[key] = await submitVariant(key, prompt);
  }
  for (const [key, taskId] of Object.entries(tasks)) {
    await pollAndDownload(key, taskId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
