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
 *
 * The raw ElevenLabs API call now lives in lib/media/vo-tts.ts, shared with
 * the e-commerce vo_broll (VO+Foto) format — that format has no AI-generated
 * embedded audio to fall back on either, for a different reason (no video
 * model call at all, just a panned/zoomed photo).
 */
import path from "node:path";
import { synthesizeElevenLabsVoiceover } from "../media/vo-tts";
import { pickHookAndCta, type CtaPattern, type HookPattern } from "./hook-patterns";

export interface VoiceoverResult {
  filePath: string;
  durationSec: number;
  costIdr: number;
  hook: HookPattern;
  cta: CtaPattern;
}

export async function synthesizeHookVoiceover(outDir: string): Promise<VoiceoverResult> {
  const { hook, cta } = pickHookAndCta();
  const scriptText = `${hook.text} ${cta.text}`;
  const outPath = path.join(outDir, "vo_hook.mp3");
  const result = await synthesizeElevenLabsVoiceover(scriptText, outPath);
  console.log(`[promo-vo] elevenlabs-tts: hook="${hook.id}" cta="${cta.id}" selesai (${result.durationSec.toFixed(1)} dtk, ~Rp${result.costIdr} estimasi)`);
  return { ...result, hook, cta };
}
