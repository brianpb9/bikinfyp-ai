// Google Cloud Text-to-Speech API v1 — provider voice NYATA.
// Dok: https://cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
// Voice: id-ID-Chirp3-HD-* (30 voice). PENTING (hasil riset): Chirp3-HD TIDAK
// mendukung SSML — kirim teks polos via buildChirpText() (tanda baca natural
// sudah memberi jeda). Harga: $30/1M karakter.

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import { runFfmpeg, probeDurationSec } from "../../media/ffmpeg";
import { buildChirpText, TTS_RATES } from "../ssml";
import { ProviderNotConfigured, type VoiceProvider, type VoiceSpec, type AudioAsset } from "../types";

export function googleCostIdr(chars: number): number {
  return Math.round((chars / 1_000_000) * TTS_RATES.googleChirp3HdPerMChars * config.usdIdr);
}

export async function googleSynthesize(opts: {
  text: string;
  voice: string;
  apiKey: string;
  outPath: string; // wav tujuan (24k mono)
}): Promise<{ durationSec: number; chars: number }> {
  const text = buildChirpText(opts.text);
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${opts.apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "id-ID", name: opts.voice },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000 },
    }),
  });
  const data = (await res.json()) as { audioContent?: string; error?: { message?: string } };
  if (!res.ok || !data.audioContent) {
    throw new Error(`google-tts: HTTP ${res.status}: ${data.error?.message ?? "respons tanpa audioContent"}`);
  }
  const tmp = opts.outPath + ".raw.wav";
  fs.writeFileSync(tmp, Buffer.from(data.audioContent, "base64"));
  await runFfmpeg(["-y", "-i", tmp, "-ar", "24000", "-ac", "1", opts.outPath]);
  fs.rmSync(tmp, { force: true });
  return { durationSec: await probeDurationSec(opts.outPath), chars: text.length };
}

export const googleTts: VoiceProvider = {
  name: "google-cloud-tts-id",

  estimateCost(spec: VoiceSpec): number {
    return googleCostIdr(spec.text.length);
  },

  async healthCheck(): Promise<boolean> {
    return config.googleTtsApiKey !== ""; // tanpa panggilan API (menghindari biaya)
  },

  async synthesize(spec: VoiceSpec, outDir: string): Promise<AudioAsset> {
    if (!config.googleTtsApiKey) throw new ProviderNotConfigured("google-cloud-tts-id", "GOOGLE_TTS_API_KEY");
    const wavPath = path.join(outDir, `vo${spec.segmentIndex}.wav`);
    const { durationSec, chars } = await googleSynthesize({
      text: spec.text,
      voice: config.googleTtsVoice,
      apiKey: config.googleTtsApiKey,
      outPath: wavPath,
    });
    const costIdr = googleCostIdr(chars);
    console.log(
      `[provider] google-tts: segmen ${spec.segmentIndex} voice=${config.googleTtsVoice} (${durationSec.toFixed(1)} dtk, ${chars} char, Rp${costIdr})`
    );
    return { filePath: path.resolve(wavPath), durationSec, costIdr };
  },
};
