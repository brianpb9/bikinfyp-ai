// Gemini TTS (gemini-3.1-flash-tts-preview) — SUARA RESMI semua video
// (keputusan Brian 2026-08-07: "TTS PAKE INI BAGUS, UBAH SEMUA VIDEO KITA").
// Keunggulan vs suara embedded dreamina: voice TERKUNCI per avatar (konsisten
// antar video & antar render), gaya bisa diarahkan (jeda, tempo), murah.
// Video tetap digenerate bersuara (gerak bibir mengucapkan skrip yang sama)
// lalu track audionya DIGANTI dengan TTS ini di compositor.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../config";

const MODEL = "gemini-3.1-flash-tts-preview";

export interface GeminiTtsResult {
  filePath: string;
  costIdr: number; // estimasi — tarif flash-tts sangat kecil
}

/**
 * Sintesis VO Indonesia dengan voice terkunci. Teks HARUS sudah melalui
 * hargaTerbilang() oleh pemanggil bila mengandung harga.
 */
export async function synthesizeGeminiVoiceover(
  text: string,
  voiceName: string,
  styleInstruction: string,
  outWavPath: string,
): Promise<GeminiTtsResult> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY belum di-set — TTS Gemini tidak bisa jalan.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${config.geminiApiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${styleInstruction} ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini TTS HTTP ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const b64 = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error(`Gemini TTS: respons tanpa audio (${JSON.stringify(data).slice(0, 200)})`);
  const pcm = `${outWavPath}.pcm`;
  fs.writeFileSync(pcm, Buffer.from(b64, "base64"));
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  // l16 24 kHz mono -> wav
  execFileSync(config.ffmpegPath, ["-y", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, outWavPath]);
  fs.rmSync(pcm, { force: true });
  return { filePath: outWavPath, costIdr: 50 }; // estimasi kasar; tarif token flash-tts ~nol untuk 1 paragraf
}
