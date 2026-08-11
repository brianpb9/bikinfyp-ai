// Brian 2026-08-09: 3 varian UGC creator, bahasa Indonesia, ikut SOP —
// pakai persona bank asli (lib/personas.ts, BUKAN deskripsi bebas baru) +
// register bahasa terkunci (lib/script-engine/registers.ts, L-16) + aturan
// bahasa kasar SOP manual (partikel wajib L-01/L-04, no overclaim L-10, no
// klaim medis L-11, no bahasa iklan formal L-12, no urgency palsu L-13, no
// bashing kompetitor L-15) — hook-only (belum ada harga/CTA, jadi L-02/L-03
// tidak berlaku di sini, sama seperti hook_family biasa yang boleh tanpa
// itu). Framing: POV selfie tangan-terentang (arm's length), kaget, lalu
// flash-cut ke video REAL (bukan AI generate produk) — approved Brian.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { config } from "../lib/config";
import { getCreatorCategory } from "../lib/personas";
import { REGISTERS, type Register } from "../lib/script-engine/registers";

const OUT_DIR = path.join(process.cwd(), "test_output/viral-hook-test");
fs.mkdirSync(OUT_DIR, { recursive: true });
const REAL_VIDEO = "/Users/hadrava/Desktop/2026-08-09 17.29.07.mp4";

interface Variant {
  key: string;
  personaId: string;
  register: Register;
  line: string; // sudah dicek manual: >=2 partikel, tanpa campur ganti orang, tanpa overclaim
}

// Kata ganti dicek konsisten dengan REGISTERS[register] (L-16); partikel
// (eh/deh/sih/nih/banget/dll) >=2 per baris (L-01/L-04); tanpa kata
// terlarang overclaim/medis (L-10/L-11).
const VARIANTS: Variant[] = [
  {
    key: "pria",
    personaId: "pria",
    register: "bestie",
    line: "Eh, tunggu dulu deh... aku kaget banget nih, serius ada beneran?!",
  },
  {
    key: "genz",
    personaId: "genz",
    register: "genz",
    line: "Woy, gila sih... gue baru sadar ada ini, cuy, serius deh!",
  },
  {
    key: "lokal",
    personaId: "lokal",
    register: "netral",
    line: "Eh bentar, aku kaget deh... ini beneran ada, sumpah?",
  },
];

const MALE_PERSONAS = new Set(["pria"]);

function buildPrompt(v: Variant): string {
  const persona = getCreatorCategory(v.personaId);
  if (!persona) throw new Error(`persona tidak ditemukan: ${v.personaId}`);
  const reg = REGISTERS[v.register];
  const pronoun = MALE_PERSONAS.has(v.personaId) ? "his" : "her";
  const subject = MALE_PERSONAS.has(v.personaId) ? "he" : "she";
  return (
    `Vertical 9:16 selfie video, POV from the front camera of a phone held at arm's length by ${persona.promptSeed}. ` +
    `${pronoun[0].toUpperCase()}${pronoun.slice(1)} extended arm is visible reaching toward the camera from the bottom of frame (holding the phone that IS ` +
    "the camera — not looking at a separate phone), slight wide-angle selfie lens distortion, face fills most of the frame. " +
    `${subject[0].toUpperCase()}${subject.slice(1)} suddenly reacts with genuine shock and surprise, eyes wide, flinching slightly as if startled, then grins ` +
    "excitedly and says directly to camera in casual Indonesian, natural pace with natural pauses between words, " +
    `${reg.genzStyle ? "Gen-Z Indonesian slang tone" : "casual friendly Indonesian tone"}: "${v.line}". ` +
    "Casual indoor home bedroom background, natural handheld selfie energy, authentic UGC style, " +
    "no text, no logo overlay, no writing added, no mirror reflection, no separate visible phone object"
  );
}

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

async function submitOne(v: Variant): Promise<string> {
  const body = {
    model: "dreamina-seedance-2-0-mini-260615",
    content: [
      {
        type: "text",
        text: `${buildPrompt(v)}. Negative: text, logo overlay, watermark, extra fingers, morphing face, low quality, mirror reflection`,
      },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: 5,
    watermark: false,
  };
  const res = await apiRequest("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`[${v.key}] task ${res.id} dikirim`);
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

function stitch(key: string, hookPath: string): Promise<void> {
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
          "[v0][v1]xfade=transition=fadewhite:duration=0.15:offset=3.2[outv];" +
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
  // Submit semua dulu (paralel), lalu poll satu-satu — hemat waktu total.
  const tasks = await Promise.all(VARIANTS.map((v) => submitOne(v).then((id) => ({ v, id }))));
  for (const { v, id } of tasks) {
    const hookPath = await pollAndDownload(v.key, id);
    await stitch(v.key, hookPath);
    console.log(`[${v.key}] STITCH SELESAI`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
