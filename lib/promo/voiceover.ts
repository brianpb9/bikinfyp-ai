/**
 * Video Promosi (non-ecommerce) prototype — voice-over for the AI-generated
 * hook segment only. VO fills the silent AI segment only — the user's own
 * uploaded clip keeps its original audio untouched.
 *
 * r-switch (Brian 2026-08-10): dipindah dari ElevenLabs ke Gemini TTS.
 * ElevenLabs (keputusan 2026-08-02) TERNYATA tidak pernah beneran jalan di
 * production — ELEVENLABS_API_KEY & ELEVENLABS_VOICE_ID tidak pernah di-set
 * di manapun (lokal maupun Render), jadi setiap job Video Promosi gagal di
 * langkah VO ini sejak awal ("Worker gagal (stalled/attempts habis):
 * ELEVENLABS_API_KEY belum diisi"). Brian juga sudah menegaskan hari ini
 * ElevenLabs "ga bagus" dan pipeline e-commerce sudah balik ke Gemini TTS —
 * lebih masuk akal satu teknologi suara konsisten di seluruh produk daripada
 * pasang akun berbayar baru buat 1 fitur prototype.
 *
 * Stage 5.1 (2026-08-03): the single static line is now a small rotating
 * pool of hook + CTA patterns (lib/promo/hook-patterns.ts) — still generic
 * placeholder-quality content pending real personalization, but no longer
 * a single fixed sentence, and now includes an actual CTA (previously
 * Video Promosi had none at all — a gap the virality checklist surfaced).
 */
import path from "node:path";
import { synthesizeGeminiVoiceover } from "../media/gemini-tts";
import { probeDurationSec } from "../media/ffmpeg";
import { pickHookAndCta, type CtaPattern, type HookPattern } from "./hook-patterns";

export interface VoiceoverResult {
  filePath: string;
  durationSec: number;
  costIdr: number;
  hook: HookPattern;
  cta: CtaPattern;
}

// Belum ada field persona/produk di Video Promosi (lihat TODO di
// hook-patterns.ts) — voice generik yang cocok lintas konten: energik,
// ramah, cocok buat hook curiosity-gap/shock-stat pendek.
const VOICE_NAME = "Leda";
const STYLE_INSTRUCTION =
  "Ucapkan sebagai kreator muda Indonesia yang ceria dan energik, santai kayak lagi cerita ke followers, ada jeda natural, tidak buru-buru:";

export async function synthesizeHookVoiceover(outDir: string): Promise<VoiceoverResult> {
  const { hook, cta } = pickHookAndCta();
  const scriptText = `${hook.text} ${cta.text}`;
  const outPath = path.join(outDir, "vo_hook.wav");
  const result = await synthesizeGeminiVoiceover(scriptText, VOICE_NAME, STYLE_INSTRUCTION, outPath);
  const durationSec = await probeDurationSec(result.filePath);
  console.log(`[promo-vo] gemini-tts: hook="${hook.id}" cta="${cta.id}" selesai (${durationSec.toFixed(1)} dtk, ~Rp${result.costIdr} estimasi)`);
  return { filePath: result.filePath, durationSec, costIdr: result.costIdr, hook, cta };
}
