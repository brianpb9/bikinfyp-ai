// docs/BRIEF_IDE30_V2.md — REVISI (Brian: "ai slop, kan tadi dibilang stitch
// ke produk video asli"). Root cause: shot 1/2 pakai setting generik "living
// room + sofa" dari brief tanpa dicocokkan ke video REAL Brian, yang
// settingnya meja kerja putih + kursi kantor + lantai kayu terang, BUKAN
// ruang tamu. Sambungan ke real video jadi lompat 2 dunia berbeda. Fix:
// ganti setting jadi meja kerja/home office biar nyambung ke real footage.
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

const SALES_LINE =
  "nah, ini nih yang dari tadi aku pegang. Samsung Portable SSD ini, bodinya kompak banget sih, " +
  "desainnya juga premium, gampang banget dibawa kemana-mana deh";

const SHOT1_PROMPT =
  "Cinematic vertical shot, locked-off tripod at seated eye level, no camera movement. An ordinary home " +
  "office / study room: a white desk, a light wooden floor, an office chair partially visible, a plain " +
  "painted back wall behind the desk, soft daylight from the side. One young Indonesian man in a plain dark " +
  "t-shirt sits calmly at the desk facing the camera, holding THE PRODUCT from the reference image in one " +
  "hand at chest height, matching the reference image exactly in colour, shape and proportion — do not " +
  "redesign it. Beat 1 (0-1.5s): calm and ordinary. He sits relaxed, looking straight at the camera, " +
  "product already visible in his hand. Beat 2 (1.5-2.5s): a deep vibration builds. Items on the desk " +
  "rattle slightly. Fine dust shakes loose from the ceiling. A commuter train horn sounds, close and loud. " +
  "Beat 3 (2.5-6s): a full-size commuter train bursts through the back wall from the left and roars " +
  "horizontally across the room behind him, filling the whole back of the frame — windows, interior lights " +
  "and carriage panels streaking past in motion blur. Wind blasts through the room: loose papers on the " +
  "desk fly, his hair and t-shirt whip violently. He does not flinch and does not look back. Beat 4 (6-8s): " +
  "the final carriage exits through the right of frame. The wind dies. Dust and paper drift slowly down. " +
  "Where the back wall was, there is now a train-sized opening with rails running through it and daylight " +
  "beyond. Beat 5 (8-9s): he has not moved at all — still seated, still calm, still holding the product in " +
  "exactly the same position. His hair settles back down. FINAL FRAME: he sits calmly facing the camera at " +
  "the desk holding the product at chest height, centered and sharp, the broken wall opening and rails " +
  "clearly visible behind him, dust still settling in the air.";

const SHOT1_NEGATIVE =
  "no text, no logo, no writing, no crowds, no other people, no injury, no blood, no fire, no derailment, " +
  "no destroyed furniture, no distorted face, no extra fingers, no English speech";

const SHOT2_PROMPT =
  "Cinematic vertical shot, locked-off tripod at seated eye level, no camera movement. The same ordinary " +
  "home office / study room, immediately after: white desk, light wooden floor, office chair, soft " +
  "daylight, and a train-sized opening in the back wall with rails running through it and daylight beyond, " +
  "fine dust still hanging in the air. The wall behind him is still broken open with rails visible — it has " +
  "NOT been repaired. The same young Indonesian man in the same plain dark t-shirt sits at the same desk " +
  "facing the camera, holding THE PRODUCT from the reference image in one hand at chest height, matching " +
  "the reference image exactly in colour, shape and proportion — do not redesign it. Beat 1 (0-2s): he " +
  "glances briefly over his shoulder at the hole in the wall, then turns back to the camera with a small " +
  "amused shrug, completely unbothered. Beat 2 (2-5s): he raises the product closer to the camera with one " +
  "hand, turning it slowly so its front face catches the daylight, keeping it centered and in sharp focus, " +
  "his other hand resting on the desk. Beat 3 (5-8s): he brings the product back down slightly to chest " +
  "height, holds it steady with one hand close to the camera, and leans in a little, speaking directly to " +
  `the viewer. He speaks casually to camera in Indonesian throughout the shot, saying: "${SALES_LINE}". ` +
  "Natural conversational Indonesian, relaxed, not a newsreader. Do not speak English. Enunciate clearly. " +
  "FINAL FRAME: he holds the product close to the camera with one hand at chest height, product centered " +
  "and in sharp focus, the broken wall and rails visible behind him.";

const SHOT2_NEGATIVE =
  "no text, no logo, no writing, no other people, no English speech, no distorted face, no extra fingers, " +
  "no changed room, no repaired wall, no different clothing";

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

async function submitOne(key: string, prompt: string, negative: string, duration: number): Promise<string> {
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: `${prompt}. Negative: ${negative}` },
      { type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) }, role: "reference_image" },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${key}] task ${res.id} dikirim`);
  return res.id;
}

async function pollAndDownload(key: string, taskId: string): Promise<string> {
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
      const outPath = path.join(OUT_DIR, `hook-${key}.mp4`);
      fs.writeFileSync(outPath, buf);
      console.log(`[${key}] SELESAI: ${outPath}`);
      return outPath;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) {
      throw new Error(`[${key}] ${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
  }
}

function concatTwo(shot1: string, shot2: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      [
        "-y", "-i", shot1, "-i", shot2, "-filter_complex",
        "[0:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v0];" +
          "[1:v]scale=720:1280:flags=lanczos,setsar=1,fps=24[v1];" +
          "[0:a]aformat=sample_rates=44100:channel_layouts=stereo[a0];" +
          "[1:a]aformat=sample_rates=44100:channel_layouts=stereo[a1];" +
          "[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]",
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        outPath,
      ],
      (err) => (err ? reject(err) : resolve())
    );
  });
}

function stitchToReal(hookPath: string, xfadeOffset: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
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
  const [id1, id2] = await Promise.all([
    submitOne("idea30v2fix-shot1", SHOT1_PROMPT, SHOT1_NEGATIVE, 9),
    submitOne("idea30v2fix-shot2", SHOT2_PROMPT, SHOT2_NEGATIVE, 8),
  ]);
  const [shot1Path, shot2Path] = await Promise.all([
    pollAndDownload("idea30v2fix-shot1", id1),
    pollAndDownload("idea30v2fix-shot2", id2),
  ]);
  const combinedPath = path.join(OUT_DIR, "hook-idea30v2fix-combined.mp4");
  await concatTwo(shot1Path, shot2Path, combinedPath);
  console.log(`COMBINED: ${combinedPath}`);
  const finalPath = path.join(OUT_DIR, "FINAL-idea30v2fix-to-real-samsung.mp4");
  await stitchToReal(combinedPath, 16.5, finalPath);
  console.log(`FINAL: ${finalPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
