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

/** Kunci ukuran kanonik untuk properti visual netral, tanpa identitas produk. */
export const NEUTRAL_PROP_SIZE_LOCK =
  "Every ordinary blank prop in frame stays at its true small size, about the width of a hand, " +
  "resting on a surface or held naturally, and the camera keeps a normal conversational distance from it.";

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

function characterContradictions(input: string, kind: "action" | "prompt", trustedNumericScaffolds: string[] = []): string[] {
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
    // Claim tepat SATU occurrence untuk tiap entri scaffold. Daftar boleh
    // memuat duplikat bila planner memang menulis scaffold dua kali. Ini
    // sengaja bukan replace global: string identik yang diselundupkan field
    // tak tepercaya tidak ikut diputihkan dan tetap menyisakan digit.
    const claimed = new Set<number>();
    for (const scaffold of trustedNumericScaffolds.filter((value) => value && /\d/.test(value))) {
      let from = 0;
      let found = -1;
      while (from <= normalized.length) {
        const candidate = normalized.indexOf(scaffold, from);
        if (candidate < 0) break;
        const overlaps = Array.from({ length: scaffold.length }, (_, offset) => candidate + offset)
          .some((index) => claimed.has(index));
        if (!overlaps) { found = candidate; break; }
        from = candidate + 1;
      }
      if (found < 0) {
        // Metadata memuat seluruh scaffold yang mungkin dipakai shot ini;
        // sebagian (opening/timeline) memang tidak hadir pada beat tertentu.
        // Yang penting: entri yang tak hadir tidak memberi allowance apa pun.
        continue;
      }
      for (let index = found; index < found + scaffold.length; index++) claimed.add(index);
    }
    const unclaimedDigit = [...normalized].some((char, index) => /\p{N}/u.test(char) && !claimed.has(index));
    if (unclaimedDigit) findings.push("non-structural digits forbidden in neutral final prompt");
  }
  return findings;
}

/** Field visual tak tepercaya sebelum dirakit dengan scaffold planner. */
// "box" sendiri adalah properti panggung sah untuk ads-unboxing-pov. Yang
// terlarang adalah bentuk merchandise generik (skincare box/product box),
// sementara jar/tube sudah cukup spesifik untuk selalu dianggap barang.
const GENERIC_MERCHANDISE = /\b(?:jar\w*|tube\w*|(?:unbranded|serum|skincare|cosmetic|product|merchandise|retail)\s+(?:box(?:es)?|container\w*|carton\w*|pouch\w*|sachet\w*))\b/i;

export function neutralStoryAdsUntrustedFieldContradictions(
  field: string,
  identity: NeutralVisualProductIdentity = {}
): string[] {
  const findings = characterContradictions(field, "prompt");
  const unsafe = field.match(/\b(?:product\w*|produk\w*|bottle\w*|botol\w*|packag\w*|kemasan\w*|brand\w*|merek\w*|logo\w*|label\w*|marked|printed|readable|claim\w*|klaim\w*|price\w*|harga\w*|reference\w*|referensi\w*)\b/i)?.[0];
  if (unsafe) findings.push(`untrusted visual field contains product/brand/text instruction: ${unsafe}`);
  const merchandise = field.match(GENERIC_MERCHANDISE)?.[0];
  if (merchandise) findings.push(`untrusted visual field contains generic merchandise: ${merchandise}`);
  const category = literalPattern(identity.productCategory);
  if (category?.test(field)) findings.push(`authoritative product category used in untrusted composition: ${identity.productCategory}`);
  return findings;
}

/** Dialog/metadata boleh menyebut fakta produk dalam kata-kata, tetapi tidak
 * boleh membawa angka yang dapat bertabrakan dengan scaffold milik planner. */
export function neutralStoryAdsUntrustedNumericContradictions(field: string): string[] {
  return characterContradictions(field, "prompt");
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
  ["custom avatar product/brand injection", /\bholding\s+(?:a\s+)?(?:bottle|packag\w*)\b|\bpresenting\s+(?:a\s+)?(?:branded\s+)?(?:[A-Za-z]+\s+){0,2}packag\w*\b|\bbeside\s+(?:a\s+)?readable\s+[A-Z][A-Za-z0-9_-]*\s+identifier\b|\bmarked\s+[A-Z][A-Za-z0-9_-]*\b/],
];

export function neutralStoryAdsPromptContradictions(
  prompt: string,
  identity: NeutralVisualProductIdentity = {},
  trustedNumericScaffolds: string[] = []
): string[] {
  // Kunci ukuran wajib di gerbang provider juga memuat frasa yang dahulu
  // menandai pemaksaan ukuran PRODUK. Hanya kalimat kanonik yang subjeknya
  // properti polos dikecualikan; frasa ukuran yang diikat ke produk tetap
  // ditolak oleh pola di bawah.
  const promptWithoutNeutralSizeLock = prompt.replaceAll(NEUTRAL_PROP_SIZE_LOCK, "");
  const findings = [
    ...characterContradictions(prompt, "prompt", trustedNumericScaffolds),
    ...FORBIDDEN_PROMPT_PATTERNS.flatMap(([label, pattern]) => pattern.test(promptWithoutNeutralSizeLock) ? [label] : []),
  ];
  const merchandise = prompt.match(GENERIC_MERCHANDISE)?.[0];
  if (merchandise) findings.push(`generic merchandise present in final neutral prompt: ${merchandise}`);
  // Nama produk tidak pernah punya alasan sah berada di visual netral. Kategori
  // tidak diperiksa sebagai token final: descriptor persona terkurasi dapat
  // sah memuat kata seperti "beauty". Injeksi kategori tetap ditolak pada
  // field LLM sebelum field itu dibuang dari komposisi.
  for (const [label, value] of [["product name", identity.productName]] as const) {
    const pattern = literalPattern(value);
    if (pattern?.test(prompt)) findings.push(`authoritative ${label} present in final prompt: ${value}`);
  }
  const categoryPattern = literalPattern(identity.productCategory);
  if (categoryPattern && new RegExp(
    `\\b(?:holding|holds|lifting|picking up|turning|presenting|memegang|mengangkat|memutar|menunjukkan)\\b[^,.;]{0,45}${categoryPattern.source}`,
    "i"
  ).test(prompt)) {
    findings.push(`authoritative product category used as visual merchandise: ${identity.productCategory}`);
  }
  return findings;
}
