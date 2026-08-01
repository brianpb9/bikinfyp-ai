// Provider voice mock A — TTS via `say` macOS (voice Indonesia bila tersedia, mis. Damayanti),
// aiff -> wav 24kHz mono via FFmpeg.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../../config";
import { runFfmpeg, probeDurationSec, runFf } from "../../media/ffmpeg";
import type { VoiceProvider, VoiceSpec, AudioAsset } from "../types";

function detectIndonesianVoice(): string | null {
  try {
    const out = execFileSync("/usr/bin/say", ["-v", "?"], { encoding: "utf8" });
    const line = out.split("\n").find((l) => /\bid_ID\b/.test(l));
    if (line) return line.trim().split(/\s+/)[0]; // mis. "Damayanti"
  } catch {
    /* say tidak tersedia */
  }
  return null;
}

export const mockVoiceA: VoiceProvider = {
  name: "mock-voice-a-say",

  estimateCost(): number {
    return 100; // TTS sangat murah (hasil uji: 1,5 kredit ≈ Rp1.198 per 15 dtk bicara)
  },

  async healthCheck(): Promise<boolean> {
    return fs.existsSync("/usr/bin/say");
  },

  async synthesize(spec: VoiceSpec, outDir: string): Promise<AudioAsset> {
    if (config.mockVoiceAFail) {
      throw new Error("mock-voice-a: kegagalan disimulasikan (MOCK_VOICE_A_FAIL=1)");
    }
    const voice = detectIndonesianVoice();
    const aiffPath = path.join(outDir, `vo${spec.segmentIndex}.aiff`);
    const wavPath = path.join(outDir, `vo${spec.segmentIndex}.wav`);
    const args = voice ? ["-v", voice] : [];
    await runFf("/usr/bin/say", [...args, "-o", aiffPath, spec.text]);
    await runFfmpeg(["-y", "-i", aiffPath, "-ar", "24000", "-ac", "1", wavPath]);
    fs.rmSync(aiffPath, { force: true });
    const durationSec = await probeDurationSec(wavPath);
    console.log(
      `[provider] mock-voice-a: segmen ${spec.segmentIndex} TTS voice=${voice ?? "default"} (${durationSec.toFixed(1)} dtk)`
    );
    return { filePath: path.resolve(wavPath), durationSec, costIdr: 100 };
  },
};
