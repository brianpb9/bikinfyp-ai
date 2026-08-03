/**
 * Video Promosi (non-ecommerce) prototype — ElevenLabs voice-over for the
 * AI-generated hook segment only. Deliberately NOT the shared TTS registry
 * (lib/providers/registry.ts) — that registry's voiceOrder() is mock-only by
 * the 31-Jul-2026 decision for the e-commerce pipeline; this is a separate,
 * prototype-scoped integration per Brian's explicit choice (2026-08-02):
 * ElevenLabs for Indonesian naturalness, VO fills the silent AI segment
 * only — the user's own uploaded clip keeps its original audio untouched.
 *
 * Stage 5.1 (2026-08-03): the single static line is now a small rotating
 * pool of hook + CTA patterns (lib/promo/hook-patterns.ts) — still generic
 * placeholder-quality content pending real personalization, but no longer
 * a single fixed sentence, and now includes an actual CTA (previously
 * Video Promosi had none at all — a gap the virality checklist surfaced).
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { probeDurationSec } from "../media/ffmpeg";
import { pickHookAndCta, type CtaPattern, type HookPattern } from "./hook-patterns";

export interface VoiceoverResult {
  filePath: string;
  durationSec: number;
  costIdr: number;
  hook: HookPattern;
  cta: CtaPattern;
}

// ElevenLabs Multilingual v2 published rate ~$0.10/1,000 characters (2026-08
// research, see BRIEF_VIDEO_NON_ECOMMERCE.md) — estimate only, not billed API cost.
function elevenLabsCostIdr(chars: number): number {
  return Math.round((chars / 1000) * 0.1 * config.usdIdr);
}

export async function synthesizeHookVoiceover(outDir: string): Promise<VoiceoverResult> {
  if (!config.elevenLabsApiKey) throw new Error("ELEVENLABS_API_KEY belum diisi — VO Video Promosi butuh ini.");
  if (!config.elevenLabsVoiceId) throw new Error("ELEVENLABS_VOICE_ID belum diisi — pilih voice Indonesia dulu di akun ElevenLabs.");

  const { hook, cta } = pickHookAndCta();
  const scriptText = `${hook.text} ${cta.text}`;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": config.elevenLabsApiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: scriptText,
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
  const costIdr = elevenLabsCostIdr(scriptText.length);
  console.log(`[promo-vo] elevenlabs-tts: hook="${hook.id}" cta="${cta.id}" selesai (${durationSec.toFixed(1)} dtk, ~Rp${costIdr} estimasi)`);
  return { filePath: outPath, durationSec, costIdr, hook, cta };
}
