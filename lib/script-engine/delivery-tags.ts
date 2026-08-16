/**
 * Penanda pembawaan yang didukung jalur Gemini TTS.
 *
 * Daftar ini sengaja kecil. Dokumentasi Gemini 3.1 TTS menyebut lebih banyak
 * tag, tetapi tag emosi/adjektiva dapat ikut DIUCAPKAN. Sepuluh tag di bawah
 * adalah kontrak authoring BikinFYP untuk jeda, tawa, tempo, bisikan, dan
 * penekanan yang didokumentasikan.
 * Tag lain tidak dinormalisasi diam-diam: salah eja lebih aman ditolak daripada
 * tiba-tiba dibacakan.
 */
export const DELIVERY_TAGS = [
  "[short pause]",
  "[medium pause]",
  "[long pause]",
  "[giggles]",
  "[laughs]",
  "[slow]",
  "[fast]",
  "[whispers]",
  "[excited]",
  "[serious]",
] as const;

/** Cue penekanan line-start; sengaja tidak memasukkan [shouting] agar output
 * tidak mendorong loudness yang melelahkan atau mengejutkan. */
export const DELIVERY_EMPHASIS_TAGS = ["[excited]", "[serious]"] as const;

export type DeliveryTag = (typeof DELIVERY_TAGS)[number];

const ALLOWED = new Set<string>(DELIVERY_TAGS);
const BRACKET_TAG = /\[[^\[\]\n]+\]/g;

/** Semua cue berbentuk `[ ... ]` yang bukan whitelist resmi kita. */
export function unknownDeliveryTags(text: string): string[] {
  return [...new Set(text.match(BRACKET_TAG) ?? [])].filter((tag) => !ALLOWED.has(tag));
}

/** Gemini mendokumentasikan cue emphasis sebagai tag awal baris. */
export function misplacedEmphasisTags(text: string): string[] {
  return DELIVERY_EMPHASIS_TAGS.filter((tag) => {
    let from = 0;
    while (true) {
      const index = text.indexOf(tag, from);
      if (index === -1) return false;
      const lineStart = text.lastIndexOf("\n", index - 1) + 1;
      if (text.slice(lineStart, index).trim().length > 0) return true;
      from = index + tag.length;
    }
  });
}

/** Hapus tag pembawaan dari teks yang dibaca UI/validator/provider non-Gemini. */
export function stripDeliveryTags(text: string): string {
  return text
    .replace(BRACKET_TAG, (tag) => (ALLOWED.has(tag) ? " " : tag))
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface CompiledDeliveryText {
  /** Dialog bersih — satu-satunya teks untuk UI, validator, caption, QC, video prompt. */
  text: string;
  /** Dialog bertag — hanya boleh dikirim ke Gemini TTS. */
  tts_text?: string;
}

/**
 * Template boleh ditulis dengan tag inline agar cue tidak terpisah dari copy,
 * lalu dikompilasi menjadi dua representasi yang tidak bisa tertukar.
 */
export function compileDeliveryText(authoredText: string): CompiledDeliveryText {
  const text = stripDeliveryTags(authoredText);
  const hasAllowedTag = DELIVERY_TAGS.some((tag) => authoredText.includes(tag));
  return hasAllowedTag ? { text, tts_text: authoredText.trim() } : { text };
}
