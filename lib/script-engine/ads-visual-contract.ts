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

const ALLOWED_PROP = /\b(kartu|swatch|blok warna|bidang kosong|halaman catatan|amplop)\b/i;
const FORBIDDEN_ACTION = /\b(produk|product|label|logo|merek|brand|harga|price|nominal|angka|currency|kemasan|botol|bottle|jar|tube)\b/i;

/** Returns contradictions instead of a boolean so audits can identify the
 * exact production instruction that regressed. */
export function neutralStoryAdsActionContradictions(action: string): string[] {
  const findings: string[] = [];
  if (!ALLOWED_PROP.test(action)) findings.push("missing allowed neutral visual subject");
  const forbidden = action.match(FORBIDDEN_ACTION)?.[0];
  if (forbidden) findings.push(`forbidden factual/product subject: ${forbidden}`);
  return findings;
}

const FORBIDDEN_PROMPT_PATTERNS: Array<[string, RegExp]> = [
  ["readable/facing label", /\blabel\b.{0,45}\b(readable|legible|facing|turned|squarely)\b|\b(readable|legible)\b.{0,25}\blabel\b/i],
  ["physical product manipulation", /\b(holding|holds|lifting|picking up|turning|dispensing|held up)\b.{0,45}\b(product|produk)\b|\b(product|produk)\b.{0,45}\b(held|picked up|in her hands|in use)\b/i],
  ["forced hand-sized product", /\b(true small size|width of a hand|real-world size|hand-sized)\b/i],
  ["product identity instruction", /\b(same product as|product identity|identity details)\b/i],
  ["product-name visual setup", /\bstory about\s+["“][^"”]+["”]|\b(presenter|hands?)\b.{0,35}\b(holding|lifting)\s+["“][^"”]+["”]/i],
];

export function neutralStoryAdsPromptContradictions(prompt: string): string[] {
  return FORBIDDEN_PROMPT_PATTERNS.flatMap(([label, pattern]) => pattern.test(prompt) ? [label] : []);
}
