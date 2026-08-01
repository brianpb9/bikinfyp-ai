// Azure Speech TTS — provider voice NYATA dengan SSML penuh.
// Dok: https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
// Voice id-ID (Microsoft Learn): id-ID-GadisNeural (F), id-ID-ArdiNeural (M).
// Harga: Neural ~$16/1M karakter.

import fs from "node:fs";
import path from "node:path";
import { config } from "../../config";
import { runFfmpeg, probeDurationSec } from "../../media/ffmpeg";
import { buildSsml, TTS_RATES } from "../ssml";
import { ProviderNotConfigured, type VoiceProvider, type VoiceSpec, type AudioAsset } from "../types";

export function azureCostIdr(chars: number): number {
  return Math.round((chars / 1_000_000) * TTS_RATES.azureNeuralPerMChars * config.usdIdr);
}

export async function azureSynthesize(opts: {
  text: string;
  voice: string;
  key: string;
  region: string;
  outPath: string;
}): Promise<{ durationSec: number; chars: number }> {
  const ssml = buildSsml(opts.text, opts.voice);
  const res = await fetch(`https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "ocp-apim-subscription-key": opts.key,
      "content-type": "application/ssml+xml",
      "x-microsoft-outputformat": "riff-24khz-16bit-mono-pcm",
      "user-agent": "racun-ai/0.1",
    },
    body: ssml,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`azure-tts: HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const tmp = opts.outPath + ".raw.wav";
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  await runFfmpeg(["-y", "-i", tmp, "-ar", "24000", "-ac", "1", opts.outPath]);
  fs.rmSync(tmp, { force: true });
  return { durationSec: await probeDurationSec(opts.outPath), chars: opts.text.length };
}

export const azureTts: VoiceProvider = {
  name: "azure-tts-id",

  estimateCost(spec: VoiceSpec): number {
    return azureCostIdr(spec.text.length);
  },

  async healthCheck(): Promise<boolean> {
    return config.azureTtsKey !== "" && config.azureTtsRegion !== "";
  },

  async synthesize(spec: VoiceSpec, outDir: string): Promise<AudioAsset> {
    if (!config.azureTtsKey || !config.azureTtsRegion)
      throw new ProviderNotConfigured("azure-tts-id", "AZURE_TTS_KEY/AZURE_TTS_REGION");
    const wavPath = path.join(outDir, `vo${spec.segmentIndex}.wav`);
    const { durationSec, chars } = await azureSynthesize({
      text: spec.text,
      voice: config.azureTtsVoice,
      key: config.azureTtsKey,
      region: config.azureTtsRegion,
      outPath: wavPath,
    });
    const costIdr = azureCostIdr(chars);
    console.log(
      `[provider] azure-tts: segmen ${spec.segmentIndex} voice=${config.azureTtsVoice} (${durationSec.toFixed(1)} dtk, ${chars} char, Rp${costIdr})`
    );
    return { filePath: path.resolve(wavPath), durationSec, costIdr };
  },
};
