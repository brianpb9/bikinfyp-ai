// EKSPERIMEN AVATAR LIBRARY (2026-08-07): apakah ModelArk r2v menerima wajah
// AI-generated (frame dari render kami sendiri) sebagai reference_image untuk
// mengunci identitas presenter? Kebijakan "may contain real person" menolak
// FOTO orang sungguhan — pertanyaannya: apakah wajah sintetis ikut ditolak.
//
// Hasil eksperimen menentukan arsitektur avatar library:
// - diterima → avatar = stills terkurasi dari render terbaik (identitas konsisten lintas video)
// - ditolak  → avatar = deskripsi prompt beku per avatar (konsistensi lebih lemah)
//
// Jalankan: npx tsx scripts/avatar-experiment.ts

import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";

const AVATAR = path.join(process.cwd(), "storage", "lab-avatar", "hijaber-a.png");
const PRODUCT = path.join(process.cwd(), "storage", "uploads", "c1e0383d-4851-4cf2-9050-d5c04befb978", "0.jpg");
const OUT = path.join(process.cwd(), "test_output", "content-lab", "avatar-experiment");

const PROMPT =
  "face and upper body clearly visible, warm friendly UGC presenter speaking directly to camera, " +
  "front-facing selfie-style angle, natural phone camera look, soft natural indoor daylight, muted authentic colors, " +
  "candid everyday vibe in a lived-in Indonesian home. " +
  "The presenter is EXACTLY the same woman as in the first reference image — same face, same hijab style, same look. " +
  "She holds up the skincare product from the second reference image (identical packaging and label, do not redesign), " +
  "speaking casually in Indonesian at a relaxed unhurried pace with natural pauses: " +
  '"Serum ini tuh beneran bikin glowing. Aku pakai seminggu, bekas jerawat memudar. Cek keranjang kuning ya". ' +
  "Negative: no text overlays, no logo, no watermark, no face distortion, no extra fingers, no plastic skin, " +
  "no morphing, no warping, no uncanny artificial look";

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data as T;
}

const dataUri = (p: string) => {
  const mime = p.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const task = await api<{ id: string }>("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: PROMPT },
      { type: "image_url", image_url: { url: dataUri(AVATAR) }, role: "reference_image" },
      { type: "image_url", image_url: { url: dataUri(PRODUCT) }, role: "reference_image" },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: 10,
    watermark: false,
  });
  console.log(`[avatar-exp] task ${task.id} DITERIMA moderasi awal — polling...`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const t = await api<{ status: string; content?: { video_url?: string }; error?: { message?: string } }>(
      "GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${task.id}`);
    console.log(`  ${Math.round((Date.now() - t0) / 1000)}s ${t.status}`);
    if (t.status === "succeeded") {
      const video = await fetch(t.content!.video_url!);
      fs.writeFileSync(path.join(OUT, "output.mp4"), Buffer.from(await video.arrayBuffer()));
      console.log(`[avatar-exp] BERHASIL: ${path.join(OUT, "output.mp4")}`);
      return;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) throw new Error(`task ${t.status}: ${t.error?.message}`);
    if (Date.now() - t0 > 12 * 60_000) throw new Error("timeout");
  }
}

main().catch((err) => { console.error("[avatar-exp] GAGAL:", err.message); process.exit(1); });
