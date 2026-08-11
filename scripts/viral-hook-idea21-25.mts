// docs/AI_HOOK_PROMPTS_V5.md — Ide 21, 22, 25 (urutan prioritas dokumen).
// Aturan F: pattern-interrupt harus terlihat KECELAKAAN, bukan spektakel —
// "no slow motion, no freeze, no floating" WAJIB (pembeda dari Ide 16 yang
// gagal). Tangan saja, tanpa wajah/badan, tanpa hal mustahil.
// Teks overlay di tabel dokumen SENGAJA tidak diminta ke model (ditambah di
// compositor nanti, bukan di-generate AI — konsisten dengan "no text" yang
// selalu ada di negative prompt sepanjang seri dokumen ini).
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
  prompt: string;
  negative: string;
  xfadeOffset: number;
}

const IDEAS: Idea[] = [
  {
    key: "idea22-nyaris-jatuh",
    duration: 4,
    xfadeOffset: 3.8,
    prompt:
      "Locked-off static camera on a tripod, waist-level, framing a pair of hands over a hard tiled floor in " +
      "an ordinary Indonesian home, natural daylight. Only hands and forearms are visible — no face, no body. " +
      "Beat 1 (0-0.8s): a hand holds THE PRODUCT casually at waist height, exactly as in the reference image, " +
      "turning it slightly as if about to show it to someone. Completely ordinary. Beat 2 (0.8-1.4s): the " +
      "product slips out of the fingers and drops. Real gravity, real speed, no slow motion. Beat 3 " +
      "(1.4-2.2s): the second hand darts in and fumbles it — the product bounces off the fingertips once, " +
      "tumbling, still falling. Beat 4 (2.2-3.2s): both hands catch it awkwardly just above the floor, close " +
      "to the tiles. The hands are tense, fingers splayed from the effort. Beat 5 (3.2-4s): the hands slowly " +
      "straighten and bring the product back up to waist height, holding it firmly now, one person exclaims " +
      "\"WOY!\" in a genuine startled reflex, then says, still catching their breath, \"jantungan aku... " +
      "tapi tunggu dulu\" in casual Indonesian, natural conversational tone, not a newsreader. Do not speak " +
      "English. FINAL FRAME: both hands hold the product securely at waist height, centered and sharp, " +
      "undamaged and identical to the reference image.",
    negative:
      "no face, no body, no slow motion, no freeze, no floating, no hovering, no broken product, no distorted hands, no extra fingers, no text, no English speech",
  },
  {
    key: "idea21-merayap-tepi",
    duration: 5,
    xfadeOffset: 4.8,
    prompt:
      "Locked-off static camera on a tripod, eye-level and close to the surface of a wooden table in an " +
      "ordinary Indonesian home, warm daylight from the left. THE PRODUCT sits on the table exactly as in " +
      "the reference image, about 20cm from the table edge, which is at the right of frame. Only hands and " +
      "forearms are ever visible — no face, no body. Beat 1 (0-1s): a hand is tidying the table, casually " +
      "pushing a small stack of papers to one side. The movement is ordinary and unremarkable. In doing so, " +
      "the hand nudges the product slightly closer to the table edge without noticing. Beat 2 (1-2.5s): the " +
      "hand keeps tidying other things, and each pass accidentally nudges the product a little further " +
      "toward the edge. The product is now half a hand-width from falling. The hand does not notice and " +
      "continues working elsewhere in frame. Beat 3 (2.5-4s): the product is now overhanging the edge, " +
      "balanced on maybe a third of its base, tilting very slightly. The hand keeps tidying, still unaware. " +
      "It does not fall. Beat 4 (4-5s): the hand finally moves back toward the product, and stops just short " +
      "of touching it, a voice says quietly \"eh eh eh, awas—\" then after a pause, \"...tapi bukan ini yang " +
      "mau aku tunjukin\" in casual Indonesian, natural conversational tone. Do not speak English. FINAL " +
      "FRAME: the product is balanced on the very edge of the table, overhanging and tilted slightly, still " +
      "not falling, sharp and centered, a hand paused just beside it.",
    negative:
      "no face, no body, no head in frame, no falling product, no dropped product, no distorted hands, no extra fingers, no slow motion, no text, no English speech",
  },
  {
    key: "idea25-kabel-kusut",
    duration: 5,
    xfadeOffset: 4.8,
    prompt:
      "Locked-off static camera on a tripod, top-down close-up onto a plain wooden table in an ordinary " +
      "Indonesian home, soft daylight. A short cable is knotted and tangled in a messy ball in the centre of " +
      "frame. THE PRODUCT sits just beside it, exactly as in the reference image. Only hands and fingers are " +
      "visible — no face, no body. Beat 1 (0-1s): fingers pick at the tangled cable, pulling one loop through " +
      "another. The knot loosens slightly. Beat 2 (1-2.5s): the fingers work steadily. One loop pulls free, " +
      "then the knot tightens again somewhere else. The tangle is smaller but still knotted. Beat 3 " +
      "(2.5-4s): the fingers slow down and work at one stubborn loop in the middle, pulling it gently back " +
      "and forth. It does not come free. Beat 4 (4-5s): the fingers stop, leaving the cable still partly " +
      "knotted, and rest beside the product without picking it up, a voice says \"tiap hari gini terus, " +
      "capek\" then \"nah, ini yang akhirnya bikin aku berhenti ribet\" in casual Indonesian, natural " +
      "conversational tone. Do not speak English. FINAL FRAME: the cable lies still and partly untangled on " +
      "the table next to the product, which is sharp and centered, identical to the reference image.",
    negative:
      "no face, no body, no fully untangled cable, no cut cable, no distorted hands, no extra fingers, no text, no logo, no English speech",
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
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: `${idea.prompt}. Negative: ${idea.negative}` },
      { type: "image_url", image_url: { url: imageToDataUri(PRODUCT_PHOTO) } },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: idea.duration,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${idea.key}] task ${res.id} dikirim`);
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
