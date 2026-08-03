/**
 * Rule-based "virality checklist" — v1, heuristic only. NOT a machine-learned
 * score, not calibrated against Brian's viral-video corpus (that comes
 * later once the dataset is large enough to be a real benchmark — see
 * 2026-08-03 conversation). This exists to surface gaps NOW, cheaply:
 * e-commerce videos already satisfy most of these by construction (fixed
 * 15s duration, mandatory "keranjang kuning" CTA per L-03) — the checklist
 * is far more informative for Video Promosi, which has neither guarantee.
 *
 * Deliberately observational-only: reads final output metadata (duration,
 * caption/hashtag text, audio presence), never touches script-engine,
 * personas, or shot-planner — that domain stays Brian's.
 */
export interface ViralityCheck {
  id: string;
  label: string;
  passed: boolean;
}

export interface ViralityChecklistResult {
  score: number; // 0-100, checks passed / total
  checks: ViralityCheck[];
}

const MIN_DURATION_SEC = 9;
const MAX_DURATION_SEC = 60;

export function computeViralityChecklist(input: {
  durationSec: number;
  hasCta: boolean;
  hasAudioOrCaption: boolean;
}): ViralityChecklistResult {
  const checks: ViralityCheck[] = [
    {
      id: "duration_range",
      label: `Durasi ${MIN_DURATION_SEC}-${MAX_DURATION_SEC} detik (rentang aman buat short-form)`,
      passed: input.durationSec >= MIN_DURATION_SEC && input.durationSec <= MAX_DURATION_SEC,
    },
    {
      id: "has_cta",
      label: "Ada ajakan aksi (CTA) yang jelas di akhir",
      passed: input.hasCta,
    },
    {
      id: "has_audio_or_caption",
      label: "Ada suara atau caption tersinkron (bukan video bisu tanpa teks)",
      passed: input.hasAudioOrCaption,
    },
  ];
  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  return { score, checks };
}
