// Probe audio embedded (bukti D4): kirim 1 task BytePlus dreamina-seedance-2-0-mini-260615
// dengan generate_audio:true (8 dtk), unduh, buktikan ada stream audio + tidak senyap.
// HANYA 1 shot — bukan video penuh. Kualitas suara TIDAK kami nilai (Brian harus mendengar).
// Jalankan: npx tsx scripts/probe-embedded-audio.ts

import fs from "node:fs";
import path from "node:path";
import { config } from "../lib/config";
import { probeDurationSec, probeFormatTags, runFf, volumeDetect } from "../lib/media/ffmpeg";

const OUT_DIR = path.resolve(process.cwd(), "..", "test_output", "embedded_audio_probe");
const MODEL = "dreamina-seedance-2-0-mini-260615";

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

async function main() {
  if (!config.byteplusApiKey) {
    console.log("BYTEPLUS_ARK_API_KEY belum diisi — probe dilewati.");
    process.exit(0);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const body = {
    model: MODEL,
    content: [
      {
        type: "text",
        text: 'A young Indonesian hijabi woman at home holds a small skincare bottle and says to camera in Indonesian: "Nah, ini dia serum yang aku ceritain. Harganya cuma 85 ribu, cek keranjang kuning ya!" She pauses for a beat, then smiles. Enunciate clearly. Natural conversational tone. Negative: no text, no logo, no writing',
      },
    ],
    generate_audio: true,
    resolution: "720p",
    ratio: "9:16",
    duration: 8,
    watermark: false,
  };

  console.log(`Kirim 1 task ${MODEL} (generate_audio=true, 8 dtk)...`);
  const created = await api<{ id: string }>("POST", `${config.byteplusBaseUrl}/contents/generations/tasks`, body);
  console.log(`Task: ${created.id}`);
  const startedAt = Date.now();

  let result: {
    status: string;
    content?: { video_url?: string };
    usage?: { total_tokens?: number };
    duration?: number;
    error?: { message?: string };
  } | null = null;
  let delay = 5000;
  for (;;) {
    if (Date.now() - startedAt > 30 * 60_000) throw new Error("timeout 30 mnt menunggu task");
    await new Promise((r) => setTimeout(r, delay));
    result = await api<typeof result>("GET", `${config.byteplusBaseUrl}/contents/generations/tasks/${created.id}`);
    if (result!.status === "succeeded") break;
    if (["failed", "cancelled", "expired"].includes(result!.status))
      throw new Error(`task ${result!.status}: ${result!.error?.message ?? "-"}`);
    console.log(`  status: ${result!.status} (${Math.round((Date.now() - startedAt) / 1000)} dtk)`);
    delay = Math.min(delay + 5000, 15000);
  }

  const videoUrl = result!.content?.video_url;
  if (!videoUrl) throw new Error("task sukses tanpa video_url");
  const outPath = path.join(OUT_DIR, "probe_embedded_audio.mp4");
  const dl = await fetch(videoUrl);
  fs.writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));
  const waitSec = Math.round((Date.now() - startedAt) / 1000);

  // Bukti teknis: stream audio + durasi + volume
  const { stdout: streams } = await runFf(config.ffprobePath, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", outPath,
  ]);
  const streamList = (JSON.parse(streams)?.streams ?? []) as { codec_type: string; codec_name: string }[];
  const hasAudio = streamList.some((s) => s.codec_type === "audio");
  const dur = await probeDurationSec(outPath);
  const vol = await volumeDetect(outPath);

  const report = [
    "# PROBE AUDIO EMBEDDED — dreamina-seedance-2-0-mini-260615",
    "",
    `Tanggal: ${new Date().toISOString()}`,
    `Task: ${created.id} · submit→selesai: ${waitSec} dtk · usage.total_tokens: ${result!.usage?.total_tokens ?? "-"}`,
    "",
    `| Pemeriksaan | Hasil |`,
    `|---|---|`,
    `| File | probe_embedded_audio.mp4 (${Math.round(fs.statSync(outPath).size / 1024)} KB) |`,
    `| Durasi | ${dur.toFixed(2)} dtk |`,
    `| Stream audio ada | ${hasAudio ? "YA" : "TIDAK"} (${streamList.map((s) => `${s.codec_type}:${s.codec_name}`).join(", ")}) |`,
    `| mean_volume | ${vol.meanDb.toFixed(1)} dB |`,
    `| max_volume | ${vol.maxDb.toFixed(1)} dB |`,
    `| Tidak senyap (> -40 dB) | ${vol.maxDb > -40 ? "YA" : "TIDAK"} |`,
    "",
    "**CATATAN:** kami TIDAK menilai kualitas/naturalitas suara — Brian harus mendengar",
    "file probe_embedded_audio.mp4 sendiri sebelum keputusan tier bersuara difinalkan.",
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "LAPORAN_PROBE.md"), report);
  console.log("\n" + report);
  if (!hasAudio) process.exit(1);
}

main().catch((err) => {
  console.error("PROBE GAGAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
