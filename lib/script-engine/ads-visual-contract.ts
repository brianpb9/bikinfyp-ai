/** Story Ads are staged with non-factual props. Product facts belong in
 * speech/metadata, never in generated pixels. */
export const NEUTRAL_STORY_ADS_TEMPLATE_IDS = new Set([
  "ads-unboxing-pov", "ads-meja-kosong", "ads-panas-ekstrem",
  "ads-tembus-dinding", "ads-atap-jebol", "ads-dobrak-pintu",
  "ads-waktu-berhenti", "kenalin-bisnis", "promo-terbatas",
]);

export function isNeutralStoryAdsTemplate(templateId?: string | null): boolean {
  return Boolean(templateId && NEUTRAL_STORY_ADS_TEMPLATE_IDS.has(templateId));
}

const ALLOWED_PROP_SOURCE = "(?:kartu(?: warna)?(?: polos| blank)?|swatch(?: polos| blank)?|blok warna|bidang kosong|halaman catatan(?: kosong)?|amplop|lipatan kartu)";
const ALLOWED_PROP = new RegExp(`\\b${ALLOWED_PROP_SOURCE}\\b`, "i");
// Stem, bukan kata utuh: bahasa Indonesia menempelkan -nya/-ku dan imbuhan
// pada objek (kemasannya, produknya). Word-boundary-only pernah meloloskan
// keduanya ke prompt provider.
const FORBIDDEN_PRODUCT_STEM = /\b(?:produk\w*|product\w*|label\w*|logo\w*|merek\w*|brand\w*|harga\w*|price\w*|nominal\w*|currency\w*|kemasan\w*|botol\w*|bottle\w*|jar\w*|tube\w*)/i;
const ACTIVE_MANIPULATION = /\b(?:memutar(?:kan)?|putar|mengangkat(?:kan)?|angkat|menahan|memegang|pegang|membuka|buka|menunjuk(?:kan)?|mengarahkan|memindahkan|meletakkan)\s+([^,.;]+)/gi;
const APPROVED_ACTION_WORDS = new Set([
  "talent", "kartu", "warna", "polos", "blank", "swatch", "blok", "bidang",
  "halaman", "catatan", "kosong", "amplop", "lipatan", "tanpa", "tulisan", "buka", "membuka",
  "menunjuk", "menunjukkan", "terlihat", "bergerak", "dipindahkan", "diletakkan",
  "diarahkan", "ditunjukkan", "mendekati", "pada", "kepada", "di", "depan", "meja",
  "saksi", "kasir", "sejak", "frame", "pertama", "perlahan", "sambil", "menyisakan",
  "pertanyaan", "berisi", "off", "camera",
]);

export interface NeutralVisualProductIdentity {
  productName?: string | null;
  productCategory?: string | null;
}

function literalPattern(value?: string | null): RegExp | null {
  const words = value?.trim().split(/\s+/).filter(Boolean);
  if (!words?.length) return null;
  return new RegExp(`\\b${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")}\\b`, "i");
}

function characterContradictions(input: string, kind: "action" | "prompt"): string[] {
  const normalized = input.normalize("NFC");
  const findings: string[] = [];
  if (/[^\x00-\x7F]/u.test(normalized.replace(/—/g, ""))) {
    const unicodeLetters = [...new Set(normalized.match(/[\p{L}\p{M}]/gu)?.filter((char) => !/[A-Za-z]/.test(char)) ?? [])];
    if (unicodeLetters.length > 0) findings.push(`non-ASCII letters/marks forbidden: ${unicodeLetters.join("")}`);
  }
  if (/\p{Sc}|%/u.test(normalized)) findings.push("currency/percent marker forbidden");
  if (kind === "action") {
    if (/\p{N}/u.test(normalized)) findings.push("digits forbidden on blank prop action");
    // Grammar aksi hanya membutuhkan spasi dan tanda baca staging sederhana.
    if (/[^A-Za-z\s,.'—-]/u.test(normalized)) findings.push("punctuation/symbol outside approved neutral action grammar");
  } else {
    // Prompt produksi memang punya nomor shot/durasi. Hanya tiga bentuk
    // struktural itu yang dibolehkan; angka lain adalah calon fakta sintetis.
    const withoutStructuralNumbers = normalized
      .replace(/\b\d+(?:\.\d+)?-second\b/gi, "")
      .replace(/\bShot\s+\d+\s+of\s+\d+\b/gi, "")
      .replace(/\b(?:at|then at)\s+\d+(?:\.\d+)?-\d+(?:\.\d+)?\s+seconds\b/gi, "");
    if (/\p{N}/u.test(withoutStructuralNumbers)) findings.push("non-structural digits forbidden in neutral final prompt");
  }
  return findings;
}

/** Returns contradictions instead of a boolean so audits can identify the
 * exact production instruction that regressed. */
export function neutralStoryAdsActionContradictions(action: string, identity: NeutralVisualProductIdentity = {}): string[] {
  const findings: string[] = characterContradictions(action, "action");
  if (!ALLOWED_PROP.test(action)) findings.push("missing allowed neutral visual subject");
  const unknownWords = [...new Set((action.toLocaleLowerCase("id-ID").match(/[a-z]+/g) ?? [])
    .filter((word) => !APPROVED_ACTION_WORDS.has(word)))];
  if (unknownWords.length > 0) findings.push(`outside approved neutral action schema: ${unknownWords.join(", ")}`);
  const forbidden = action.match(FORBIDDEN_PRODUCT_STEM)?.[0];
  if (forbidden) findings.push(`forbidden factual/product subject: ${forbidden}`);
  for (const [label, value] of [["product name", identity.productName], ["product category", identity.productCategory]] as const) {
    const pattern = literalPattern(value);
    if (pattern?.test(action)) findings.push(`authoritative ${label} used as visual subject: ${value}`);
  }
  // Kontrak positif: objek langsung setiap gerak manipulasi harus dimulai
  // oleh salah satu prop blank yang disetujui. Menyebut kartu di anak kalimat
  // tidak dapat melegalkan objek lain ("angkat botolnya sambil pegang kartu").
  for (const match of action.matchAll(ACTIVE_MANIPULATION)) {
    const object = match[1].trim();
    if (!new RegExp(`^(?:${ALLOWED_PROP_SOURCE})\\b`, "i").test(object)) {
      findings.push(`unapproved manipulated visual subject: ${object}`);
    }
  }
  return findings;
}

const FORBIDDEN_PROMPT_PATTERNS: Array<[string, RegExp]> = [
  ["readable/facing label", /\blabel\b.{0,45}\b(readable|legible|facing|turned|squarely)\b|\b(readable|legible)\b.{0,25}\blabel\b/i],
  ["physical product manipulation", /\b(holding|holds|lifting|picking up|turning|dispensing|held up)\b.{0,45}\b(product|produk)\b|\b(product|produk)\b.{0,45}\b(held|picked up|in her hands|in use)\b/i],
  ["forced hand-sized product", /\b(true small size|width of a hand|real-world size|hand-sized)\b/i],
  ["product identity instruction", /\b(same product as|product identity|identity details)\b/i],
  ["product-name visual setup", /\bstory about\s+["“][^"”]+["”]|\b(presenter|hands?)\b.{0,35}\b(holding|lifting)\s+["“][^"”]+["”]/i],
  ["Indonesian product manipulation", /\b(?:memutar(?:kan)?|mengangkat(?:kan)?|menahan|memegang|membuka|menunjuk(?:kan)?|mengarahkan|memindahkan|meletakkan)\s+(?:produk\w*|kemasan\w*|botol\w*|label\w*|merek\w*)/i],
];

export function neutralStoryAdsPromptContradictions(prompt: string, identity: NeutralVisualProductIdentity = {}): string[] {
  const findings = [
    ...characterContradictions(prompt, "prompt"),
    ...FORBIDDEN_PROMPT_PATTERNS.flatMap(([label, pattern]) => pattern.test(prompt) ? [label] : []),
  ];
  for (const [label, value] of [["product name", identity.productName], ["product category", identity.productCategory]] as const) {
    const pattern = literalPattern(value);
    if (pattern?.test(prompt)) findings.push(`authoritative ${label} present in final prompt: ${value}`);
  }
  return findings;
}
