// Brian 2026-08-09: "gila meter" 0 (normal) - 5 (gila). Hasil sebelumnya
// (selfie tenang langsung reaksi) dinilai level 2. Diminta level 3/4/5 —
// makin intens fisik/masuk ruangan, bukan cuma reaksi wajah doang. Level 5
// eksplisit dari Brian: HP di meja (kamera diam), dia jalan dari luar
// pintu, pintu dibanting, jalan ke meja, ambil HP, transisi ke selfie.
// Pakai 1 kreator dulu (pria) buat kalibrasi sebelum diterapkan ke 3
// kreator. Kamera = HP itu sendiri secara diegetic (diam di meja lalu jadi
// POV tangan begitu diambil) — narasi satu shot berkelanjutan.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { config } from "../lib/config";
import { getCreatorCategory } from "../lib/personas";

const OUT_DIR = path.join(process.cwd(), "test_output/viral-hook-test");
fs.mkdirSync(OUT_DIR, { recursive: true });
const REAL_VIDEO = "/Users/hadrava/Desktop/2026-08-09 17.29.07.mp4";
const persona = getCreatorCategory("pria")!;
const LINE = "Eh, tunggu dulu deh... aku kaget banget nih, serius ada beneran?!";

interface Level {
  key: string;
  duration: number;
  xfadeOffset: number;
  prompt: string;
}

const LEVELS: Level[] = [
  {
    key: "level3",
    duration: 5,
    xfadeOffset: 3.2,
    prompt:
      `${persona.promptSeed}. Vertical 9:16 video. The camera is his phone, already held up in a rushed selfie ` +
      "grip as he bursts into frame from the side, slightly out of breath, phone shaking with quick handheld " +
      "energy, eyes already wide with excitement. He immediately reacts with a big shocked gasp, eyes wide, " +
      "flinching, then grins and says directly to camera in casual Indonesian, natural pace with natural pauses " +
      `between words, casual friendly Indonesian tone: "${LINE}". Bedroom background, fast energetic UGC style, ` +
      "no text, no logo overlay, no writing added, no mirror reflection, no separate visible phone object",
  },
  {
    key: "level4",
    duration: 6,
    xfadeOffset: 4.2,
    prompt:
      `${persona.promptSeed}. Vertical 9:16 video. Starts as a wide shot from a phone propped on a nightstand, ` +
      "framing a bedroom door. He half-jogs quickly into the room through the open doorway, energetic urgent " +
      "movement, rushes straight to the nightstand and grabs the phone, lifting it up — the camera perspective " +
      "becomes his handheld selfie view as he lifts it, arm extended toward camera, wide-angle selfie lens, big " +
      "shocked gasping reaction, eyes wide, then grins excitedly and says directly to camera in casual Indonesian, " +
      `natural pace with natural pauses between words: "${LINE}". Bedroom background, fast energetic UGC style, ` +
      "no text, no logo overlay, no writing added, no mirror reflection",
  },
  {
    key: "level5",
    duration: 8,
    xfadeOffset: 6.2,
    prompt:
      `${persona.promptSeed}. Vertical 9:16 video. Starts as a static wide shot from a phone propped on a table, ` +
      "framing a closed bedroom door across the room. The door suddenly opens and he strides in quickly from " +
      "outside the hallway, then slams the door shut behind him with a decisive motion, immediately walks fast " +
      "toward the table, grabs the phone off the table and lifts it up in one motion — the camera perspective " +
      "becomes his handheld selfie view as he lifts it, arm extended toward camera, wide-angle selfie lens, " +
      "breathless and wide-eyed, big shocked gasping reaction, then grins excitedly and says directly to camera " +
      `in casual Indonesian, natural pace with natural pauses between words: "${LINE}". Bedroom background, ` +
      "fast dramatic energetic UGC style, no text, no logo overlay, no writing added, no mirror reflection",
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

async function submitOne(lv: Level): Promise<string> {
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      { type: "text", text: `${lv.prompt}. Negative: text, logo overlay, watermark, extra fingers, morphing face, low quality, mirror reflection` },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: lv.duration,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${lv.key}] task ${res.id} dikirim`);
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

function stitch(key: string, hookPath: string, xfadeOffset: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const outPath = path.join(OUT_DIR, `FINAL-${key}-selfie-flip-to-real-samsung.mp4`);
    execFile(
      "ffmpeg",
      [
        "-y",
        "-i", hookPath,
        "-i", REAL_VIDEO,
        "-filter_complex",
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
      (err: unknown) => (err ? reject(err) : resolve())
    );
  });
}

async function main() {
  const tasks = await Promise.all(LEVELS.map((lv) => submitOne(lv).then((id) => ({ lv, id }))));
  for (const { lv, id } of tasks) {
    const hookPath = await pollAndDownload(lv.key, id);
    await stitch(lv.key, hookPath, lv.xfadeOffset);
    console.log(`[${lv.key}] STITCH SELESAI`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
