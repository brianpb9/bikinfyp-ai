// docs/AI_HOOK_PROMPTS_V3.md — Ide 11-15. Aturan A (mustahil di fisika OK,
// mustahil di anatomi TIDAK) dan Aturan B (produk harus di tempat wajar)
// sudah dipertimbangkan penulis dokumen saat nulis prompt2 ini.
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
    key: "idea11-antrean",
    duration: 9,
    mode: "r2v",
    xfadeOffset: 8.8,
    prompt:
      "Vertical handheld phone shot with natural sway. A narrow Indonesian residential alley (gang) in the " +
      "late afternoon, golden light, low houses on both sides, tangled overhead cables, potted plants, a " +
      "green metal gate in the foreground. Beat 1 (0-2s): the camera is close behind a person's shoulder as " +
      "they unlock and slowly push open the green metal gate of their house, casual and unhurried. Beat 2 " +
      "(2-4s): the gate swings open to reveal a queue of people standing patiently in the alley outside, " +
      "single file, stretching away from the gate. Beat 3 (4-7s): the camera lifts and pans slowly along the " +
      "queue. The line of people continues far down the alley, around a bend, and out of sight — at least " +
      "forty people, all ages, ordinary everyday clothing, standing calmly and patiently, some holding " +
      "phones, some fanning themselves in the heat. They are relaxed and orderly, not a mob. A few glance " +
      "politely toward the camera and look away again. Beat 4 (7-9s): the camera pans back to the person at " +
      "the gate, who turns to face the camera holding THE PRODUCT from the reference image in one hand at " +
      "chest height, matching the reference image exactly in colour, shape and proportion — do not redesign " +
      "it. They give a small overwhelmed smile. FINAL FRAME: the person faces the camera holding the product " +
      "at chest height, centered and in sharp focus, the long queue soft and out of focus behind them.",
    negative: "no crowd panic, no pushing, no shouting, no protest, no banners, no text on signs, no exaggerated faces, no distorted hands",
  },
  {
    key: "idea12-warung",
    duration: 8,
    mode: "r2v",
    xfadeOffset: 7.8,
    prompt:
      "Vertical handheld phone shot, slight natural sway. Inside a small Indonesian roadside warung in the " +
      "evening: warm yellow bulb light, simple wooden benches and tables, plastic chairs, jars of snacks on " +
      "the counter, a street visible through the open front. Beat 1 (0-2s): a young Indonesian person sits " +
      "at a table, filmed from across the table. Three other customers sit at other tables in the background, " +
      "quietly eating and looking at their own food. Ordinary, calm, unremarkable evening. Beat 2 (2-4s): the " +
      "person reaches into their bag and takes out THE PRODUCT from the reference image, setting it down on " +
      "the table in front of them, matching the reference image exactly in colour, shape and proportion — " +
      "do not redesign it. They look at it casually. Beat 3 (4-6.5s): one by one, slowly and in silence, " +
      "every other customer in the warung turns their head to look at the product. Calm, unhurried head " +
      "turns, natural neutral expressions, no smiling, no exaggeration. Even the warung owner behind the " +
      "counter pauses and looks. Nobody moves from their seat. The room goes completely still. Beat 4 " +
      "(6.5-8s): the person at the table notices everyone looking, glances around slowly, then looks back " +
      "down at the product and picks it up in one hand. FINAL FRAME: the person holds the product up in one " +
      "hand at chest height, centered and in sharp focus, with the other still, silent customers softly out " +
      "of focus behind them.",
    negative: "no exaggerated comedy faces, no laughing, no crowd standing up, no fast head movement, no distorted faces, no extra fingers",
  },
  {
    key: "idea13-dunia-ngebut",
    duration: 10,
    mode: "r2v",
    xfadeOffset: 9.8,
    prompt:
      "Vertical shot on a tripod, locked-off, no camera movement. A busy pedestrian bridge or sidewalk in " +
      "Jakarta at dusk, city buildings and traffic behind, warm streetlights just turning on. Beat 1 (0-2s): " +
      "normal speed. A young Indonesian person stands still in the centre of the frame, facing the camera, " +
      "holding THE PRODUCT from the reference image in both hands at chest height, matching the reference " +
      "image exactly in colour, shape and proportion — do not redesign it. People walk past on either side " +
      "at normal speed. Beat 2 (2-7s): the world around them accelerates into a long-exposure time-lapse. " +
      "Pedestrians become fast smeared streaks of motion blur, headlights stretch into continuous ribbons of " +
      "light, clouds race across the sky, the sunset drops and the sky shifts from orange to deep blue. The " +
      "person in the centre stays completely still and perfectly sharp, in focus, not blurred at all, still " +
      "holding the product. Their clothes and hair move only very slightly. Beat 3 (7-10s): the time-lapse " +
      "decelerates smoothly back to normal speed. The streaks resolve back into ordinary walking people. It " +
      "is now night, the streetlights are fully on, and the person is still standing in exactly the same " +
      "position holding the product. FINAL FRAME: the person stands perfectly still facing the camera at " +
      "night, holding the product at chest height, centered and sharp, city lights soft and glowing behind them.",
    negative: "no sharp background people, no frozen bystanders, no strobing, no flickering, no distorted faces in blur, no text on signage",
  },
  {
    key: "idea14-tidak-terangkat",
    duration: 10,
    mode: "i2v",
    xfadeOffset: 9.8,
    prompt:
      "Locked-off static camera on a tripod, no camera movement, medium close framing on a plain wooden " +
      "table inside an ordinary Indonesian home. THE PRODUCT sits alone in the centre of the table exactly " +
      "as in the reference image, evenly lit and sharp. Beat 1 (0-1.5s): completely still. Just the small " +
      "product alone on the table. Beat 2 (1.5-4s): one adult hand and forearm enter frame and grip the " +
      "product firmly, then pull upward hard. The product does not move at all, as if it weighs a tonne. " +
      "The forearm tenses, veins showing, then gives up and releases. The hand exits frame. Beat 3 (4-7s): " +
      "a second, larger pair of hands enters frame, grips the product with both hands, and heaves upward " +
      "with real effort — the table itself creaks and lifts slightly at one corner — but the product still " +
      "does not move. Both hands release and exit frame. Beat 4 (7-9s): a third smaller hand enters frame " +
      "and lifts the product effortlessly with two fingers, as if it weighs nothing at all, raising it " +
      "smoothly off the table. Beat 5 (9-10s): the hand turns the product gently toward the camera, holding " +
      "it still. FINAL FRAME: the product is held between two fingers, centered in frame, in sharp focus, " +
      "undamaged, identical to the reference image, the empty table blurred behind it.",
    negative: "no faces, no full bodies, no extra fingers, no distorted hands, no broken table, no broken product, no cartoon effects",
  },
  {
    key: "idea15-mati-lampu",
    duration: 10,
    mode: "r2v",
    xfadeOffset: 9.8,
    prompt:
      "Vertical handheld phone shot with slight natural sway. An Indonesian residential neighbourhood " +
      "(kampung) at night, seen from the alley: rows of small houses, overhead cables, a narrow lane. " +
      "Beat 1 (0-2s): the whole neighbourhood is lit normally — warm light glowing from many windows, a " +
      "streetlamp on, the blue flicker of a television through one curtain. Beat 2 (2-3.5s): every light in " +
      "the entire frame cuts out at once. Total darkness. The streetlamp dies, all the windows go black, the " +
      "television flicker vanishes. Only faint moonlight and the silhouettes of rooftops remain. Somewhere a " +
      "dog barks. Beat 3 (3.5-6s): one single window in the middle of the frame is still glowing — a soft, " +
      "cool white light, steady and calm, the only light in the entire neighbourhood. The camera moves " +
      "slowly toward that window. Beat 4 (6-10s): the camera arrives at the window and looks in. Inside, a " +
      "young Indonesian person sits calmly on the floor, completely relaxed, their face lit by their phone " +
      "screen. THE PRODUCT from the reference image sits beside them connected to the phone by a short " +
      "cable, matching the reference image exactly in colour, shape and proportion — do not redesign it. " +
      "They are unbothered while the rest of the neighbourhood is dark. FINAL FRAME: the product sits beside " +
      "the person in the calm glow of the phone screen, centered and in sharp focus, the dark room and dark " +
      "neighbourhood around it.",
    negative: "no product glowing by itself, no product lighting the whole room, no lightning, no fire, no candles, no distorted faces, no text on screen",
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
