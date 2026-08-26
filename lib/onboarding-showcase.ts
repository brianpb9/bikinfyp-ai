import { AI_RENDER_BLOCKED_TEMPLATE_IDS } from "./template-render-safety";

export type OnboardingShowcaseClip = {
  src: string;
  label: string;
  templateId: string | null;
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
 * teardown internal. Empat berkas pertama di bawah adalah render pipeline
 * BikinFYP sendiri, dipakai sebagai showcase publik sejak commit b5323d0;
 * lima berikutnya render model kami sendiri (lihat catatannya di sana).
 */
const PROVENANCE_APPROVED_SHOWCASE_CLIPS = [
  { src: "/showcase/hijaber.mp4", label: "Hijaber", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/genz.mp4", label: "Gen-Z", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/ibu.mp4", label: "Ibu", templateId: null, provenance: "owned_pipeline_render" },
  { src: "/showcase/tangan.mp4", label: "Tanpa wajah", templateId: null, provenance: "owned_pipeline_render" },

  // Lima karakter Grok Imagine, dirender Brian 26 Agu 2026 dari akun kami
  // sendiri (720x1280, diturunkan ke 360x640 tanpa audio seperti klip lain).
  //
  // SATU KARAKTER SATU KLIP. Dari tujuh klip yang diberikan, dua dibuang
  // karena mengulang karakter yang sama: satu berbaju denim yang sama persis
  // dengan "Review produk", satu lagi berbaju coral yang sama dengan
  // "Di mobil". Dinding bukti yang menampilkan orang yang sama dua kali
  // membuktikan lebih sedikit, bukan lebih banyak.
  //
  // provenance "owned_model_render", BUKAN "owned_pipeline_render": klip ini
  // lahir dari Grok Imagine langsung, dan Grok belum jadi mesin bawaan tier
  // mana pun (super_hq masih BytePlus). Menyebutnya keluaran pipeline berarti
  // mengklaim jalur produksi yang belum dilewati klip ini.
  { src: "/showcase/persona/ootd.mp4", label: "OOTD", templateId: null, provenance: "owned_model_render" },
  { src: "/showcase/persona/unboxing.mp4", label: "Unboxing", templateId: null, provenance: "owned_model_render" },
  { src: "/showcase/persona/review-produk.mp4", label: "Review produk", templateId: null, provenance: "owned_model_render" },
  { src: "/showcase/persona/close-up.mp4", label: "Close-up", templateId: null, provenance: "owned_model_render" },
  { src: "/showcase/persona/di-mobil.mp4", label: "Di mobil", templateId: null, provenance: "owned_model_render" },
] as const satisfies readonly OnboardingShowcaseClip[];

/** Kelas provenance yang boleh tampil di halaman komersial. */
export const PROVENANCE_OWNED = new Set<OnboardingShowcaseClip["provenance"]>([
  "owned_pipeline_render",
  "owned_model_render",
]);

const BLOCKED_TEMPLATE_IDS = new Set<string>(AI_RENDER_BLOCKED_TEMPLATE_IDS);

export function isOnboardingShowcaseClipApproved(clip: OnboardingShowcaseClip): boolean {
  return PROVENANCE_OWNED.has(clip.provenance)
    && clip.src.startsWith("/showcase/")
    && !clip.src.startsWith("/previews/")
    && (clip.templateId === null || !BLOCKED_TEMPLATE_IDS.has(clip.templateId));
}

/** Hanya klip yang lolos provenance + safety gate boleh berada di bawah klaim AI. */
export const ONBOARDING_AI_SHOWCASE_CLIPS: readonly OnboardingShowcaseClip[] =
  PROVENANCE_APPROVED_SHOWCASE_CLIPS.filter(isOnboardingShowcaseClipApproved);
