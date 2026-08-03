/**
 * Real Indonesian TTS (ElevenLabs) — used ONLY where there is no AI-generated
 * embedded audio to fall back on. hands_only/talking_head keep audio embedded
 * from the video model itself (KEPUTUSAN FINAL 31 Jul 2026 — see
 * lib/providers/registry.ts's voiceOrder(), still mock-only for those
 * formats). vo_broll (VO+Foto) has no video-model call at all — the visual
 * is the user's real product photo panned/zoomed by ffmpeg, not AI-generated
 * — so there is no embedded audio to substitute for. This module exists
 * because of that structural gap, not to replace the 31-Jul decision.
 *
 * Same ElevenLabs integration pattern as lib/promo/voiceover.ts (Video
 * Promosi); factored out here so both callers share one API-calling path.
 */
import fs from "node:fs";
import { config } from "../config";
import { probeDurationSec } from "./ffmpeg";

export interface ElevenLabsVoiceoverResult {
  filePath: string;
  durationSec: number;
  costIdr: number;
}

// ElevenLabs Multilingual v2 published rate ~$0.10/1,000 characters — estimate
// only, not billed API cost.
export function elevenLabsCostIdr(chars: number): number {
  return Math.round((chars / 1000) * 0.1 * config.usdIdr);
}

export async function synthesizeElevenLabsVoiceover(text: string, outPath: string): Promise<ElevenLabsVoiceoverResult> {
  if (!config.elevenLabsApiKey) throw new Error("ELEVENLABS_API_KEY belum diisi.");
  if (!config.elevenLabsVoiceId) throw new Error("ELEVENLABS_VOICE_ID belum diisi — pilih voice Indonesia dulu di akun ElevenLabs.");

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`elevenlabs-tts: HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  const durationSec = await probeDurationSec(outPath);
  const costIdr = elevenLabsCostIdr(text.length);
  return { filePath: outPath, durationSec, costIdr };
}
