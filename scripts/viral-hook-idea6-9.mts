// docs/AI_HOOK_PROMPTS_V2.md — Ide 6, 7, 8, 9 (Ide 10 sudah selesai duluan
// sesuai rekomendasi dokumen). Brian minta sisanya juga dijalankan biar bisa
// dinilai semua.
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

interface Idea {
  key: string;
  duration: number;
  mode: "i2v" | "r2v";
  prompt: string;
  negative: string;
  xfadeOffset: number;
}

const IDEAS: Idea[] = [
  {
    key: "idea6-ojol",
    duration: 9,
    mode: "r2v",
    xfadeOffset: 8.8,
    prompt:
      "Vertical handheld phone shot, natural slight sway. Interior of an ordinary Indonesian home living room, " +
      "afternoon daylight, tiled floor, a simple sofa. A young Indonesian person sits on the sofa scrolling " +
      "their phone, relaxed and bored. Beat 1 (0-1.5s): calm and ordinary. They glance up at the camera and " +
      "shrug. Beat 2 (1.5-3s): a low engine rumble builds. The person looks toward the wall, confused. Dust " +
      "trickles from the ceiling. Beat 3 (3-6s): a motorbike ridden by a delivery courier in a plain green " +
      "jacket and helmet rides straight DOWN the interior wall of the living room, tyres gripping the vertical " +
      "wall, headlight on, and lands smoothly on the tiled floor with a small skid. No damage to the wall, no " +
      "debris, no fire — it is treated as completely normal. Beat 4 (6-7.5s): the courier calmly reaches into " +
      "their delivery box and takes out THE PRODUCT from the reference image, matching it exactly in colour, " +
      "shape and proportion — do not redesign it. Beat 5 (7.5-9s): the courier holds the product out toward " +
      "the camera at chest height with one hand, arm extended, offering it directly to the viewer. The seated " +
      "person looks at it with wide eyes. The courier speaks casually in Indonesian, saying: \"pesanan atas " +
      "nama kakak, ya.\" Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL " +
      "FRAME: the product is held out toward the camera at chest height, centered and in sharp focus, the " +
      "courier's hand and forearm visible, arm fully extended.",
    negative: "no English speech, no brand logo on jacket, no visible license plate, no crash, no fire, no damaged wall",
  },
  {
    key: "idea7-rebutan",
    duration: 8,
    mode: "i2v",
    xfadeOffset: 7.8,
    prompt:
      "Locked-off static camera on a tripod, top-down three-quarter angle onto a plain wooden table, no camera " +
      "movement. THE PRODUCT sits alone in the centre of the table exactly as in the reference image, evenly " +
      "lit, sharp. Beat 1 (0-1s): completely still and quiet. Just the product alone on the table. Beat 2 " +
      "(1-2.5s): a single human hand darts in fast from the left edge of frame and grabs at the product, but " +
      "misses and is pulled back out of frame. Beat 3 (2.5-5.5s): dozens of human hands and forearms surge in " +
      "from ALL FOUR edges of the frame at once, reaching, grabbing, jostling and pushing against each other " +
      "over the product. The hands are varied: different skin tones, different sleeves, adults' hands. The " +
      "product is passed and knocked between them, staying intact and always partially visible, never crushed " +
      "or damaged. Fast, chaotic, energetic movement. Beat 4 (5.5-7s): the hands begin retreating out of frame " +
      "as quickly as they arrived, thinning out. Beat 5 (7-8s): one single hand remains, holding the product " +
      "firmly, and pulls it directly toward the camera lens so it grows large in frame. FINAL FRAME: one hand " +
      "holds the product close to the camera, the product filling the centre of the frame in sharp focus, the " +
      "table now empty and blurred far behind it.",
    negative: "no faces, no crushed product, no broken packaging, no blood, no violence, no gore",
  },
  {
    key: "idea8-waktu-berhenti",
    duration: 10,
    mode: "r2v",
    xfadeOffset: 9.8,
    prompt:
      "Vertical shot. A busy traditional Indonesian market (pasar) in the morning: crowded narrow aisles, " +
      "fabric awnings, crates of vegetables, hanging plastic bags, warm light filtering through the canopy. " +
      "Handheld phone-style camera with natural sway. Beat 1 (0-2.5s): full motion and life. Shoppers walk " +
      "past, a vendor tosses a plastic bag, a hand pours water from a scoop, dust and steam drift through " +
      "shafts of light. Busy, noisy, normal. Beat 2 (2.5-3.5s): everything in the frame FREEZES completely " +
      "mid-motion — people mid-step with one foot raised, the tossed bag suspended in the air, the poured " +
      "water frozen as a solid arc of droplets, the drifting dust motionless. The camera keeps moving with " +
      "its natural handheld sway, so the frozen world feels genuinely three dimensional. Colour drains " +
      "slightly toward cool grey. Beat 3 (3.5-7s): only THE PRODUCT from the reference image is unaffected " +
      "— it rests on a market stall, still in full warm colour and gently catching the light, matching the " +
      "reference image exactly in colour, shape and proportion — do not redesign it. The camera drifts slowly " +
      "through the frozen crowd toward it, passing between motionless shoppers. Beat 4 (7-10s): a hand and " +
      "forearm enter frame from the bottom, reach into the frozen scene, and pick the product up off the " +
      "stall, lifting it toward the camera. As the product is lifted, warm colour begins bleeding back into " +
      "the frozen world around it. FINAL FRAME: the product is held in the hand close to the camera, centered " +
      "and sharp in full warm colour, the frozen market soft and desaturated behind it.",
    negative: "no slow motion blur on frozen subjects, no ghosting, no camera freeze, no different product, no text on stalls",
  },
  {
    key: "idea9-layar-hp",
    duration: 8,
    mode: "r2v",
    xfadeOffset: 7.8,
    prompt:
      "Vertical shot, over-the-shoulder angle. A young Indonesian person lies on a bed at night in an ordinary " +
      "bedroom, lit only by the glow of the phone screen in their hand. The phone screen faces the camera and " +
      "shows a vertical video playing. Beat 1 (0-2s): they scroll the phone with their thumb, bored, swiping " +
      "past videos. Their face is lit blue-white by the screen. Beat 2 (2-3.5s): the phone screen ripples " +
      "like the surface of water. They stop scrolling and stare. Beat 3 (3.5-6s): a human hand and forearm " +
      "push OUT through the phone screen from inside it, the screen surface stretching and rippling around " +
      "the wrist like liquid, still glowing. The hand is holding THE PRODUCT from the reference image, " +
      "matching it exactly in colour, shape and proportion — do not redesign it. Beat 4 (6-8s): the emerging " +
      "hand extends the product forward past the phone, offering it toward the camera. The person on the bed " +
      "sits up sharply, mouth open in shock. The person speaks in Indonesian, saying: \"hah, serius?\" " +
      "Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL FRAME: the product " +
      "is held out toward the camera, centered and sharp, lit by the phone's glow, the shocked person soft " +
      "in the background.",
    negative: "no English speech, no horror, no scary distorted hand, no gore, no broken screen, no app interface, no visible UI",
  },
];

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

async function submitOne(idea: Idea): Promise<string> {
  const content: unknown[] = [{ type: "text", text: `${idea.prompt}. Negative: ${idea.negative}` }];
  if (idea.mode === "i2v") {
    content.push({ type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) } });
  } else {
    content.push({ type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) }, role: "reference_image" });
  }
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content,
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: idea.duration,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${idea.key}] task ${res.id} dikirim (mode ${idea.mode})`);
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
      const outPath = path.join(OUT_DIR, `hook-${key}-forward.mp4`);
      fs.writeFileSync(outPath, buf);
      console.log(`[${key}] SELESAI: ${outPath}`);
      return outPath;
    }
    if (["failed", "cancelled", "expired"].includes(t.status)) {
      throw new Error(`[${key}] ${t.status}: ${t.error?.message ?? "tanpa pesan"}`);
    }
  }
}

function stitch(key: string, hookPath: string, xfadeOffset: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(OUT_DIR, `FINAL-${key}-to-real-samsung.mp4`);
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
  const tasks = await Promise.all(IDEAS.map((idea) => submitOne(idea).then((id) => ({ idea, id }))));
  for (const { idea, id } of tasks) {
    const hookPath = await pollAndDownload(idea.key, id);
    await stitch(idea.key, hookPath, idea.xfadeOffset);
    console.log(`[${idea.key}] STITCH SELESAI`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
