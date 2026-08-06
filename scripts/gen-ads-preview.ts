// One-off: aset preview kartu "AI UGC Ads" di S1 (halaman jenis) — hijaber
// memegang SMARTPHONE yang menampilkan aplikasi (bukan produk fisik), sesuai
// arahan Brian 2026-08-07: kartu Ads harus terlihat "promosi app/jasa yang
// real", bukan copy-paste preview Affiliate.
//
// Referensi layar HP = screenshot UI BikinFYP sendiri (aman: milik kita).
// Model: dreamina mini (r2v, murah) 10 dtk 720p, tanpa audio embedded
// (preview kartu selalu muted-loop).
// Jalankan: npx tsx scripts/gen-ads-preview.ts [screenshotPath]

import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";

const SCREENSHOT = process.argv[2] ?? path.join(process.cwd(), "test_output", "performance", "baseline-kredit.png");
const OUT = path.join(process.cwd(), "test_output", "content-lab", "ads-preview");

const PROMPT =
  "Indonesian hijabi woman in a soft neutral hijab, warm friendly UGC presenter speaking directly to camera, " +
  "front-facing selfie-style angle, holding up a modern smartphone next to her face with its screen clearly visible " +
  "showing the mobile finance app interface from the reference image, pointing at the phone screen while explaining " +
  "enthusiastically, graceful calm delivery, soft natural indoor daylight, muted authentic colors, " +
  "candid everyday vibe in a lived-in Indonesian home, natural phone camera look. " +
  "Negative: no physical product, no bottle, no text overlays, no logo except on the phone screen, " +
  "no face distortion, no extra fingers, no plastic skin, no watermark";

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data as T;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const mime = SCREENSHOT.endsWith(".png") ? "image/png" : "image/jpeg";
  const dataUri = `data:${mime};base64,${fs.readFileSync(SCREENSHOT).toString("base64")}`;
  const task = await api<{ id: string }>("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: dataUri }, role: "reference_image" },
    ],
    generate_audio: false,
    resolution: "720p",
    ratio: "9:16",
    duration: 10,
    watermark: false,
  });
  console.log(`[ads-preview] task ${task.id} dikirim, polling...`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const t = await api<{ status: string; content?: { video_url?: string }; error?: { message?: string } }>(
      "GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${task.id}`);
    console.log(`  ${Math.round((Date.now() - t0) / 1000)}s ${t.status}`);
    if (t.status === "succeeded") {
      const video = await fetch(t.content!.video_url!);
      const out = path.join(OUT, "ads-preview.mp4");
      fs.writeFileSync(out, Buffer.from(await video.arrayBuffer()));
      console.log(`[ads-preview] SELESAI: ${out}`);
      return;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) throw new Error(`task ${t.status}: ${t.error?.message}`);
    if (Date.now() - t0 > 10 * 60_000) throw new Error("timeout");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
