// docs/AI_HOOK_PROMPTS_V2.md — Ide 10 (angkot, social proof H4), direkomendasikan
// dokumen sebagai yang paling layak dites duluan (sambungan naratif, bukan
// pixel-match, jadi tahan banting walau ruangan/cahaya beda dari video real).
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { config } from "../lib/config";

const OUT_DIR = path.join(process.cwd(), "test_output/viral-hook-test");
const REAL_VIDEO = "/Users/hadrava/Desktop/2026-08-09 17.29.07.mp4";
const PRODUCT_PHOTO = path.join(process.cwd(), "storage/lab-samsungssd/0.jpg");

const MIME: Record<string, string> = { ".jpg": "image/jpeg" };
function imageToDataUri(p: string): string {
  const buf = fs.readFileSync(p);
  return `data:${MIME[path.extname(p).toLowerCase()] ?? "image/jpeg"};base64,${buf.toString("base64")}`;
}

const PROMPT =
  "Vertical handheld phone shot from inside a public minivan (angkot) in an Indonesian city, daytime. Worn " +
  "vinyl bench seats facing each other, open windows, street and warung fronts sliding past outside, natural " +
  "sunlight flickering through the windows. Beat 1 (0-2s): the camera is held selfie-style by a young " +
  "Indonesian passenger who looks slightly bored, swaying with the vehicle. Ordinary and unremarkable. " +
  "Beat 2 (2-4s): the camera pans slowly to the right along the bench of passengers. The first passenger is " +
  "holding THE PRODUCT from the reference image in their lap, looking at it calmly. Beat 3 (4-6.5s): the pan " +
  "continues. EVERY passenger on the bench is holding the exact same product in the same way, calmly and " +
  "casually, as if it is completely normal. Five or six people, different ages and clothing, all with the " +
  "identical product, matching the reference image exactly in colour, shape and proportion — do not redesign " +
  "it. Nobody reacts. Nobody looks at the camera. Beat 4 (6.5-9s): the camera pans back to the original " +
  "passenger, who slowly looks down at their own empty hands, then lifts their head and stares straight into " +
  "the camera with a deadpan expression. The passenger speaks in Indonesian, saying: \"kok cuma aku yang " +
  "belum punya?\" Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL FRAME: " +
  "the passenger looks straight into the camera, deadpan, hands empty and open in their lap, the other " +
  "passengers holding the product soft behind them.";

const NEGATIVE =
  "no English speech, no exaggerated comedy faces, no laughing, no different product variants, no crowd staring at camera";

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

function stitch(hookPath: string, xfadeOffset: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(OUT_DIR, "FINAL-idea10-angkot-to-real-samsung.mp4");
    execFile(
      "ffmpeg",
      [
        "-y", "-i", hookPath, "-i", REAL_VIDEO, "-filter_complex",
        "[0:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v0];" +
          "[1:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v1];" +
          "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];" +
          "[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];" +
          `[v0][v1]xfade=transition=fadewhite:duration=0.15:offset=${xfadeOffset}[outv];` +
          "[a0][a1]acrossfade=d=0.15[outa]",
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        outPath,
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: `${PROMPT}. Negative: ${NEGATIVE}` },
      { type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) }, role: "reference_image" },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: 9,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`task ${res.id} dikirim`);
  const startedAt = Date.now();
  for (;;) {
    if (Date.now() - startedAt > 8 * 60_000) throw new Error("timeout 8mnt");
    await new Promise((r) => setTimeout(r, 8000));
    const t = await apiRequest("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${res.id}`);
    console.log(`${Math.round((Date.now() - startedAt) / 1000)}s ${t.status}`);
    if (t.status === "succeeded") {
      const url = t.content?.video_url;
      const videoRes = await fetch(url);
      const buf = Buffer.from(await videoRes.arrayBuffer());
      const outPath = path.join(OUT_DIR, "hook-idea10-angkot-forward.mp4");
      fs.writeFileSync(outPath, buf);
      console.log(`SELESAI: ${outPath}`);
      await stitch(outPath, 8.8);
      console.log("STITCH SELESAI");
      return;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) {
      throw new Error(`${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
