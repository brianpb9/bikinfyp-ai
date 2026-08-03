/**
 * Video Promosi (non-ecommerce) — hook + CTA pattern pool (v1).
 *
 * Replaces the single static placeholder VO line with a small rotating set
 * of hook OPENERS and CTA CLOSERS, categorized by the general structural
 * technique they use. The category names/descriptions here are my own
 * abstraction of well-known short-form-video hook mechanics (curiosity gap,
 * shock stat, direct value promise, etc.) — informed by a pattern-level
 * review of several reference books Brian shared (2026-08-03), but written
 * fresh in generic, product-agnostic Indonesian, not copied or closely
 * paraphrased from any source. See the chat synthesis for the full source
 * breakdown and copyright notes (two of the seven references turned out to
 * be scanned third-party books — those were excluded from this pool
 * entirely, only the two originally-authored ebooks and the live-streaming
 * SOP informed the categories below).
 *
 * Generic on purpose: Video Promosi doesn't collect product/service detail
 * from the user (unlike the e-commerce flow), so these can't be personalized
 * yet — they're written to work for "promoting an app or service" broadly.
 * TODO(Brian): once there's a field for what's being promoted, these can
 * become fill-in-the-blank templates instead of fixed lines.
 */
export interface HookPattern {
  id: string;
  category: string;
  text: string;
}

export const HOOK_PATTERNS: HookPattern[] = [
  { id: "curiosity_gap", category: "Curiosity gap", text: "Eh, tau nggak sih, ada satu hal yang bakal ngerubah cara kamu ngelakuin ini." },
  { id: "shock_stat", category: "Shock stat", text: "Serius, ini baru aku tau — dan kayaknya kebanyakan orang juga belum tau." },
  { id: "pain_point", category: "Relatable pain point", text: "Buat kamu yang udah capek muter-muter cari solusi, coba tonton ini dulu deh." },
  { id: "direct_value", category: "Direct value promise", text: "Ini bakal ngebantu banget buat kamu yang lagi cari solusi gampang." },
  { id: "myth_bust", category: "Myth-bust / reframe", text: "Banyak yang salah kira soal ini — biar aku jelasin yang bener." },
  { id: "question_hook", category: "Direct question", text: "Kamu pernah ngerasa ribet banget cuma buat ngerjain hal simpel kayak gini?" },
  { id: "personal_experience", category: "Personal-experience opener", text: "Jujur, awalnya aku ragu — tapi setelah coba ini, langsung ketagihan." },
  { id: "low_expectation", category: "Low-expectation-to-surprise", text: "Ekspektasi aku rendah banget sebelum coba ini, eh ternyata beda jauh." },
];

export interface CtaPattern {
  id: string;
  label: string;
  text: string;
}

export const CTA_PATTERNS: CtaPattern[] = [
  { id: "bio_link", label: "Cek link di bio", text: "Cek link di bio aku, ya!" },
  { id: "comment_word", label: "Komen kata kunci", text: 'Komen "INFO" di bawah kalau kamu mau tau lebih lanjut!' },
  { id: "dm", label: "DM", text: "DM aku aja kalau ada yang mau ditanyain!" },
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function pickHookAndCta(): { hook: HookPattern; cta: CtaPattern } {
  return { hook: pickRandom(HOOK_PATTERNS), cta: pickRandom(CTA_PATTERNS) };
}
