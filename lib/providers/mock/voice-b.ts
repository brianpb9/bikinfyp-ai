// Provider voice mock B — fallback nada sinus per segmen (FFmpeg sine) bila `say` gagal,
// supaya failover voice bisa didemokan end-to-end.

import path from "node:path";
import { runFfmpeg, probeDurationSec } from "../../media/ffmpeg";
import type { VoiceProvider, VoiceSpec, AudioAsset } from "../types";

export const mockVoiceB: VoiceProvider = {
  name: "mock-voice-b-sine",

  estimateCost(): number {
    return 120; // sedikit di atas mock-a agar suara asli (`say`) tetap jadi pilihan utama
  },

  async healthCheck(): Promise<boolean> {
    return true;
  },

  async synthesize(spec: VoiceSpec, outDir: string): Promise<AudioAsset> {
    // Durasi nada mengikuti panjang teks, dibatasi slot segmen.
    const words = spec.text.split(/\s+/).filter(Boolean).length;
    const duration = Math.min(Math.max(1.2, words * 0.38), spec.slotSec);
    const freq = 340 + spec.segmentIndex * 60; // tiap segmen beda nada — failover terlihat/terdengar
    const wavPath = path.join(outDir, `vo${spec.segmentIndex}.wav`);
    await runFfmpeg([
      "-y",
      "-f", "lavfi",
      "-i", `sine=frequency=${freq}:duration=${duration}`,
      "-af", "volume=0.5,afade=t=in:st=0:d=0.1,afade=t=out:st=" + Math.max(0, duration - 0.15).toFixed(2) + ":d=0.15",
      "-ar", "24000",
      "-ac", "1",
      wavPath,
    ]);
    const durationSec = await probeDurationSec(wavPath);
    console.log(`[provider] mock-voice-b: segmen ${spec.segmentIndex} nada sinus fallback (${durationSec.toFixed(1)} dtk)`);
    return { filePath: path.resolve(wavPath), durationSec, costIdr: 120 };
  },
};
