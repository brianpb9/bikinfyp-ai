/**
 * Video Promosi (non-ecommerce) prototype — ElevenLabs voice-over for the
 * AI-generated hook segment only. Deliberately NOT the shared TTS registry
 * (lib/providers/registry.ts) — that registry's voiceOrder() is mock-only by
 * the 31-Jul-2026 decision for the e-commerce pipeline; this is a separate,
 * prototype-scoped integration per Brian's explicit choice (2026-08-02):
 * ElevenLabs for Indonesian naturalness, VO fills the silent AI segment
 * only — the user's own uploaded clip keeps its original audio untouched.
 *
 * TODO(Brian): VO_SCRIPT_TEXT is a placeholder so the pipeline can be proven
 * end-to-end. Replace with real script content before this goes past
 * Prototype stage.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { probeDurationSec } from "../media/ffmpeg";

export const VO_SCRIPT_TEXT =
  "Eh, tau nggak sih, ini bakal ngebantu banget buat kamu yang lagi cari solusi gampang.";

export interface VoiceoverResult {
  filePath: string;
  durationSec: number;
  costIdr: number;
}

// ElevenLabs Multilingual v2 published rate ~$0.10/1,000 characters (2026-08
// research, see BRIEF_VIDEO_NON_ECOMMERCE.md) — estimate only, not billed API cost.
function elevenLabsCostIdr(chars: number): number {
  return Math.round((chars / 1000) * 0.1 * config.usdIdr);
}

export async function synthesizeHookVoiceover(outDir: string): Promise<VoiceoverResult> {
  if (!config.elevenLabsApiKey) throw new Error("ELEVENLABS_API_KEY belum diisi — VO Video Promosi butuh ini.");
  if (!config.elevenLabsVoiceId) throw new Error("ELEVENLABS_VOICE_ID belum diisi — pilih voice Indonesia dulu di akun ElevenLabs.");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: VO_SCRIPT_TEXT,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`elevenlabs-tts: HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const outPath = path.join(outDir, "vo_hook.mp3");
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  const durationSec = await probeDurationSec(outPath);
  const costIdr = elevenLabsCostIdr(VO_SCRIPT_TEXT.length);
  console.log(`[promo-vo] elevenlabs-tts: hook VO selesai (${durationSec.toFixed(1)} dtk, ~Rp${costIdr} estimasi)`);
  return { filePath: outPath, durationSec, costIdr };
}
