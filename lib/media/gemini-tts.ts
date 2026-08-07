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

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function callGemini(text: string, voiceName: string, styleInstruction: string): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
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
  return { status: res.status, ok: res.ok, data };
}

/**
 * Sintesis VO Indonesia dengan voice terkunci. Teks HARUS sudah melalui
 * hargaTerbilang() oleh pemanggil bila mengandung harga.
 *
 * Retry 3x dgn backoff (2s/5s/10s) utk error transien (429/5xx) — insiden
 * lab 2026-08-07 job aa39e66a: Gemini 503 "high demand" menggagalkan SELURUH
 * job (refund) padahal video BytePlus sudah sukses (~Rp8rb terbakar percuma)
 * hanya karena hiccup TTS sesaat tanpa retry sama sekali.
 */
export async function synthesizeGeminiVoiceover(
  text: string,
  voiceName: string,
  styleInstruction: string,
  outWavPath: string,
): Promise<GeminiTtsResult> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY belum di-set — TTS Gemini tidak bisa jalan.");
  const delaysMs = [2000, 5000, 10000];
  let last: { status: number; ok: boolean; data: Record<string, unknown> } | null = null;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    last = await callGemini(text, voiceName, styleInstruction);
    if (last.ok) break;
    if (!RETRYABLE_STATUS.has(last.status) || attempt === delaysMs.length) break;
    console.warn(`[gemini-tts] HTTP ${last.status} (percobaan ${attempt + 1}/${delaysMs.length + 1}) — retry ${delaysMs[attempt]}ms`);
    await new Promise((r) => setTimeout(r, delaysMs[attempt]));
  }
  const { status, ok, data } = last!;
  if (!ok) throw new Error(`Gemini TTS HTTP ${status}: ${JSON.stringify(data).slice(0, 250)}`);
  const b64 = (data as { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error(`Gemini TTS: respons tanpa audio (${JSON.stringify(data).slice(0, 200)})`);
  const pcm = `${outWavPath}.pcm`;
  fs.writeFileSync(pcm, Buffer.from(b64, "base64"));
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  // l16 24 kHz mono -> wav
  execFileSync(config.ffmpegPath, ["-y", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", pcm, outWavPath]);
  fs.rmSync(pcm, { force: true });
  return { filePath: outWavPath, costIdr: 50 }; // estimasi kasar; tarif token flash-tts ~nol untuk 1 paragraf
}
