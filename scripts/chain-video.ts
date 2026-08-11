// JALUR B "Avatar Konsisten" (adopsi sistem FYP 2.0, 2026-08-07):
// Seedream still (wajah avatar TERKUNCI via referensi + produk) ->
// Seedance 1.0 i2v (10 dtk + 5 dtk, multi-shot hard cut, bisu) ->
// concat ffmpeg -> VO Gemini TTS (voice terkunci per avatar, harga terbilang)
// -> mix final. Seedance 1.0 MENERIMA frame berwajah (terbukti eksperimen
// chain-exp); yang menolak wajah hanya dreamina 2.0.
//
// Jalankan: npx tsx scripts/chain-video.ts <varian>
// Varian terdefinisi di VIDEOS di bawah. Butuh GEMINI_API_KEY (env atau
// secrets.env Viral Meter).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../lib/config";
import { hargaTerbilang } from "../lib/script-engine/terbilang";

const GEMINI_KEY = process.env.GEMINI_API_KEY ??
  fs.readFileSync("/Users/hadrava/Viral Meter/secrets.env", "utf-8").match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY tidak ditemukan");

const APP = process.cwd();
const dataUrl = (p: string) => {
  const mime = p.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
};

const FULLBLEED =
  "flat authentic candid phone-camera photograph, full-bleed frame, no phone mockup, no borders, " +
  "pore-level natural skin, no beauty filter, soft natural window daylight, muted authentic colors, no watermark";

interface VideoDef {
  avatarRef: string; voice: string; productPhotos: string[];
  stills: { key: string; prompt: string }[];
  clips: { still: string; dur: number; prompt: string }[];
  vo: string; voStyle: string;
}

const VIDEOS: Record<string, VideoDef> = {
  "tts-beauty-salma": {
    avatarRef: `${APP}/public/avatars/salma.png`,
    voice: "Aoede",
    productPhotos: [
      `${APP}/storage/uploads/c1e0383d-4851-4cf2-9050-d5c04befb978/0.jpg`,
      `${APP}/storage/uploads/c1e0383d-4851-4cf2-9050-d5c04befb978/1.jpg`,
    ],
    stills: [
      { key: "s1", prompt:
        "Photorealistic vertical 9:16 UGC photo, the same woman as the first reference image with identical face, hijab and identity, " +
        "arm's-length selfie framing in a cozy lived-in Indonesian living room, warm smile, holding up the exact skincare bottle from the " +
        "second reference image at chest height (identical packaging, label text sharp and readable), " + FULLBLEED },
      { key: "s2", prompt:
        "Photorealistic vertical 9:16 UGC photo, the same woman as the first reference image with identical face, hijab and identity, " +
        "static medium framing at a wooden table by a window, she holds the open skincare bottle from the second reference image in one hand " +
        "and its white dropper in the other above the back of her opposite hand, focused calm expression, " + FULLBLEED },
    ],
    clips: [
      { still: "s1", dur: 10, prompt:
        "UGC iPhone aesthetic vertical social video, cozy Indonesian living room, soft daylight. The woman from the first frame, identical face, hijab and outfit throughout. " +
        "Shot 1: handheld selfie feel, she smiles and tilts the product label toward the lens. Hard cut. " +
        "Shot 2: static macro, the bottle in her palm close to the lens, label sharp and steady. Hard cut. " +
        "Shot 3: static medium, she unscrews the dropper cap smoothly, one bottle one dropper only. " +
        "The label text stays identical and readable, packaging physically intact, exactly two hands, no on-screen text, no subtitles, no watermark, no extra hands, no morphing " +
        "--ratio 9:16 --resolution 720p --duration 10 --watermark false" },
      { still: "s2", dur: 5, prompt:
        "UGC iPhone aesthetic vertical social video, same woman, identical face, hijab and outfit. " +
        "Shot 1: static macro, the dropper drips one clear drop onto the back of her hand, she spreads it gently with a fingertip. Hard cut. " +
        "Shot 2: selfie close-up, warm satisfied smile and a small nod to camera. " +
        "No on-screen text, no watermark, exactly two hands, packaging intact --ratio 9:16 --resolution 720p --duration 5 --watermark false" },
    ],
    vo: "Kulit kusam berminggu-minggu, kenapa justru serum kecil ini yang berhasil? Dua tetes tiap malam... itu aja. Hari keempat, bekas jerawatku mulai pudar. Harganya cuma Rp159.000. Cek keranjang kuning ya.",
    voStyle: "Ucapkan sebagai cewek muda Indonesia yang santai dan hangat, seperti cerita ke teman dekat, ada jeda natural antar kalimat, tidak buru-buru, tidak seperti iklan:",
  },
  "tts-fashion-zea": {
    avatarRef: `${APP}/public/avatars/zea.png`,
    voice: "Leda",
    productPhotos: [
      `${APP}/storage/lab-dress/0.jpg`,
      `${APP}/storage/lab-dress/1.jpg`,
    ],
    stills: [
      { key: "s1", prompt:
        "Photorealistic vertical 9:16 UGC photo, the same young woman as the first reference image with identical face, hair and identity, " +
        "standing FULL BODY head to toe in a bright cozy lived-in bedroom with a bed and clothes rack, WEARING the exact black sleeveless " +
        "neck-ruff dress from the second reference image (same cut, fabric and drape), like a mirror-check try-on photo, " + FULLBLEED },
      { key: "s2", prompt:
        "Photorealistic vertical 9:16 UGC photo, the same young woman as the first reference image with identical face, hair and identity, " +
        "arm's-length selfie framing in the same bright bedroom, wearing the same black neck-ruff dress, playful confident grin, " +
        "one hand pinching the ruffled neckline fabric to show its texture, " + FULLBLEED },
    ],
    clips: [
      { still: "s1", dur: 10, prompt:
        "UGC iPhone aesthetic vertical social video, bright tidy bedroom, soft daylight. The woman from the first frame, identical face, hair and black dress throughout. " +
        "Shot 1: static full body, she does a relaxed half-turn showing how the dress falls, hands smoothing the sides. Hard cut. " +
        "Shot 2: static three-quarter, she sways slightly, the A-line skirt swings naturally. Hard cut. " +
        "Shot 3: static macro, her fingers pinch the ruffled neckline showing the cotton texture. " +
        "The dress stays identical, no on-screen text, no subtitles, no watermark, exactly two hands, no morphing " +
        "--ratio 9:16 --resolution 720p --duration 10 --watermark false" },
      { still: "s2", dur: 5, prompt:
        "UGC iPhone aesthetic vertical social video, same woman, identical face, hair and black dress. " +
        "Shot 1: handheld selfie feel, playful grin, she tugs the shoulder of the dress lightly. Hard cut. " +
        "Shot 2: selfie close-up, confident easy smile and a small approving nod. " +
        "No on-screen text, no watermark, exactly two hands --ratio 9:16 --resolution 720p --duration 5 --watermark false" },
    ],
    vo: "Dress hitam tuh banyak, tapi yang potongannya bener... jarang. Bahannya tebel, jatuhnya lurus, nggak nerawang. Dipakai jalan seharian juga nyaman. Harganya Rp249.000 aja. Cek keranjang kuning ya.",
    voStyle: "Ucapkan sebagai cewek Gen-Z Indonesia yang ceria dan percaya diri, santai seperti ngobrol ke bestie, ada jeda natural, tidak buru-buru:",
  },
};

async function ark(pathname: string, body?: unknown, method = "POST") {
  const res = await fetch(`${config.byteplusBaseUrl}${pathname}`, {
    method, headers: { authorization: `Bearer ${config.byteplusApiKey}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ark ${res.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

async function pollTask(id: string): Promise<string> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 10000));
    const t = await ark(`/contents/generations/tasks/${id}`, undefined, "GET");
    if (t.status === "succeeded") return t.content.video_url;
    if (["failed", "cancelled", "expired"].includes(t.status)) throw new Error(`task ${id} ${t.status}: ${t.error?.message}`);
  }
}

async function download(url: string, dst: string) {
  fs.writeFileSync(dst, Buffer.from(await (await fetch(url)).arrayBuffer()));
}

async function main() {
  const name = process.argv[2];
  const def = VIDEOS[name];
  if (!def) throw new Error(`varian tidak dikenal: ${name} (tersedia: ${Object.keys(VIDEOS).join(", ")})`);
  const out = path.join(APP, "test_output", "content-lab", name);
  fs.mkdirSync(out, { recursive: true });

  // 1) Stills (avatar + produk terkunci)
  const stillPaths: Record<string, string> = {};
  for (const s of def.stills) {
    const res = await ark("/images/generations", {
      model: "seedream-4-0-250828", prompt: s.prompt,
      image: [dataUrl(def.avatarRef), ...def.productPhotos.map(dataUrl)],
      size: "1080x1920", response_format: "url", watermark: false });
    stillPaths[s.key] = path.join(out, `still_${s.key}.jpg`);
    await download(res.data[0].url, stillPaths[s.key]);
    console.log(`[${name}] still ${s.key} OK`);
  }

  // 2) Klip i2v Seedance 1.0 (paralel)
  const taskIds = await Promise.all(def.clips.map(async (c, i) => {
    const t = await ark("/contents/generations/tasks", {
      model: "seedance-1-0-pro-fast-251015",
      content: [
        { type: "text", text: c.prompt },
        { type: "image_url", image_url: { url: dataUrl(stillPaths[c.still]) } },
      ],
      generate_audio: false, resolution: "720p", ratio: "9:16", duration: c.dur, watermark: false });
    console.log(`[${name}] clip ${i} task ${t.id}`);
    return t.id as string;
  }));
  const clipPaths: string[] = [];
  for (let i = 0; i < taskIds.length; i++) {
    const url = await pollTask(taskIds[i]);
    const p = path.join(out, `clip_${i}.mp4`);
    await download(url, p);
    clipPaths.push(p);
    console.log(`[${name}] clip ${i} selesai`);
  }

  // 3) Concat
  const listFile = path.join(out, "list.txt");
  fs.writeFileSync(listFile, clipPaths.map((p) => `file '${p}'`).join("\n"));
  const silent = path.join(out, "video_silent.mp4");
  execFileSync(config.ffmpegPath, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

  // 4) VO Gemini TTS (harga otomatis terbilang)
  const voText = `${def.voStyle} ${hargaTerbilang(def.vo)}`;
  const ttsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${GEMINI_KEY}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: voText }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: def.voice } } } },
    }),
  });
  const tts = await ttsRes.json();
  if (!ttsRes.ok) throw new Error(`gemini ${ttsRes.status}: ${JSON.stringify(tts).slice(0, 300)}`);
  const pcm = path.join(out, "vo.pcm");
  fs.writeFileSync(pcm, Buffer.from(tts.candidates[0].content.parts[0].inlineData.data, "base64"));
  const voWav = path.join(out, "vo.wav");
  execFileSync(config.ffmpegPath, ["-y", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, voWav]);

  // 5) Mix final (video 15 dtk, VO dipangkas/di-pad ke durasi video)
  const final = path.join(out, "output.mp4");
  execFileSync(config.ffmpegPath, [
    "-y", "-v", "error", "-i", silent, "-i", voWav,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
    "-af", "apad", "-shortest", "-movflags", "faststart",
    "-metadata", "racun_aigc=true", final,
  ]);
  console.log(`[${name}] SELESAI: ${final}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
