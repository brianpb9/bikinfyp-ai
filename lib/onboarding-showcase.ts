import { AI_RENDER_BLOCKED_TEMPLATE_IDS } from "./template-render-safety";
import approvalLedger from "./onboarding-showcase-approvals.json";

export type OnboardingShowcaseClip = {
  src: string;
  label: string;
  templateId: string | null;
  approvalId: string;
  /**
   * Batas yang benar-benar dijaga: RENDER KAMI SENDIRI vs FOOTAGE ORANG LAIN.
   *
   *   owned_pipeline_render  keluaran pipeline BikinFYP.
   *   owned_model_render     kami yang menghasilkan, TAPI bukan lewat pipeline
   *                          produksi. Dipisah karena menyebutnya "pipeline
   *                          render" adalah klaim yang tidak kami punya — dan
   *                          gerbang ini ada justru karena klaim provenance
   *                          pernah dilebihkan sekali.
   *   third_party_portfolio  footage pihak lain. TIDAK PERNAH sah di halaman
   *                          komersial.
   */
  provenance: "owned_pipeline_render" | "owned_model_render" | "third_party_portfolio";
};

/**
 * Allowlist publik ini sengaja TIDAK diturunkan dari katalog template.
 * `public/previews` berisi footage portfolio pihak lain yang hanya sah untuk
 * teardown internal. Dua berkas pertama di bawah adalah render pipeline
 * BikinFYP sendiri; empat berikutnya render model kami sendiri. Setiap baris
 * wajib terikat ke approval ledger, SHA asset, dan frame evidence yang dapat
 * diperiksa — nilai `provenance` saja tidak pernah cukup.
 */
const PROVENANCE_APPROVED_SHOWCASE_CLIPS = [
  { src: "/showcase/genz.mp4", label: "Gen-Z", templateId: null, approvalId: "genz-a089584", provenance: "owned_pipeline_render" },
  { src: "/showcase/tangan.mp4", label: "Tanpa wajah", templateId: null, approvalId: "tangan-a089584", provenance: "owned_pipeline_render" },

  // Empat karakter Grok Imagine, dirender Brian 26 Agu 2026 dari akun kami
  // sendiri (720x1280, diturunkan ke 360x640 tanpa audio seperti klip lain).
  //
  // SATU KARAKTER SATU KLIP. Selain dua duplikat karakter yang sudah dibuang,
  // "Review produk" tidak masuk public proof karena belum punya source-product
  // identity record yang dapat direview.
  //
  // provenance "owned_model_render", BUKAN "owned_pipeline_render": klip ini
  // lahir dari Grok Imagine langsung, dan Grok belum jadi mesin bawaan tier
  // mana pun (super_hq masih BytePlus). Menyebutnya keluaran pipeline berarti
  // mengklaim jalur produksi yang belum dilewati klip ini.
  { src: "/showcase/persona/ootd.mp4", label: "OOTD", templateId: null, approvalId: "persona-ootd-2ecdc5a", provenance: "owned_model_render" },
  { src: "/showcase/persona/unboxing.mp4", label: "Unboxing", templateId: null, approvalId: "persona-unboxing-2ecdc5a", provenance: "owned_model_render" },
  { src: "/showcase/persona/close-up.mp4", label: "Close-up", templateId: null, approvalId: "persona-close-up-2ecdc5a", provenance: "owned_model_render" },
  { src: "/showcase/persona/di-mobil.mp4", label: "Di mobil", templateId: null, approvalId: "persona-di-mobil-2ecdc5a", provenance: "owned_model_render" },
] as const satisfies readonly OnboardingShowcaseClip[];

/** Kelas provenance yang boleh tampil di halaman komersial. */
export const PROVENANCE_OWNED = new Set<OnboardingShowcaseClip["provenance"]>([
  "owned_pipeline_render",
  "owned_model_render",
]);

const BLOCKED_TEMPLATE_IDS = new Set<string>(AI_RENDER_BLOCKED_TEMPLATE_IDS);
const APPROVALS = new Map(approvalLedger.approvals.map((approval) => [approval.id, approval]));

export function isOnboardingShowcaseClipApproved(clip: OnboardingShowcaseClip): boolean {
  const approval = APPROVALS.get(clip.approvalId);
  return approval?.qcResult === "pass"
    && approval.src === clip.src
    && approval.provenance === clip.provenance
    && PROVENANCE_OWNED.has(clip.provenance)
    && clip.src.startsWith("/showcase/")
    && !clip.src.startsWith("/previews/")
    && (clip.templateId === null || !BLOCKED_TEMPLATE_IDS.has(clip.templateId));
}

/** Hanya klip yang lolos provenance + safety gate boleh berada di bawah klaim AI. */
export const ONBOARDING_AI_SHOWCASE_CLIPS: readonly OnboardingShowcaseClip[] =
  PROVENANCE_APPROVED_SHOWCASE_CLIPS.filter(isOnboardingShowcaseClipApproved);
