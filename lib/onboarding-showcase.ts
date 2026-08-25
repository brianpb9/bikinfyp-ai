import { AI_RENDER_BLOCKED_TEMPLATE_IDS } from "./template-render-safety";

export type OnboardingShowcaseClip = {
  src: string;
  label: string;
  templateId: string | null;
  provenance: "owned_pipeline_render" | "third_party_portfolio";
};

/**
 * Allowlist publik ini sengaja TIDAK diturunkan dari katalog template.
 * `public/previews` berisi footage portfolio pihak lain yang hanya sah untuk
 * teardown internal. Empat berkas di bawah adalah render pipeline BikinFYP
 * sendiri dan sudah dipakai sebagai showcase publik sejak commit b5323d0.
 */
const PROVENANCE_APPROVED_SHOWCASE_CLIPS = [
  { src: "/showcase/hijaber.mp4", label: "Hijaber", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/genz.mp4", label: "Gen-Z", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/ibu.mp4", label: "Ibu", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/tangan.mp4", label: "Tanpa wajah", templateId: null, provenance: "owned_pipeline_render" },
] as const satisfies readonly OnboardingShowcaseClip[];

const BLOCKED_TEMPLATE_IDS = new Set<string>(AI_RENDER_BLOCKED_TEMPLATE_IDS);

export function isOnboardingShowcaseClipApproved(clip: OnboardingShowcaseClip): boolean {
  return clip.provenance === "owned_pipeline_render"
    && clip.src.startsWith("/showcase/")
    && !clip.src.startsWith("/previews/")
    && (clip.templateId === null || !BLOCKED_TEMPLATE_IDS.has(clip.templateId));
}

/** Hanya klip yang lolos provenance + safety gate boleh berada di bawah klaim AI. */
export const ONBOARDING_AI_SHOWCASE_CLIPS: readonly OnboardingShowcaseClip[] =
  PROVENANCE_APPROVED_SHOWCASE_CLIPS.filter(isOnboardingShowcaseClipApproved);
