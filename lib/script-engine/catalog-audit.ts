import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "../templates";
import { DELIVERY_EMPHASIS_TAGS, DELIVERY_TAGS, misplacedEmphasisTags, stripDeliveryTags, unknownDeliveryTags } from "./delivery-tags";
import { TEMPLATE_COPY } from "./template-copy";
import { generateScripts, type GeneratedScript, type ProductInput } from "./index";

/**
 * Satu produk dipakai untuk seluruh katalog supaya perbedaan yang dihitung
 * benar-benar berasal dari template, bukan dari pergantian produk. Nilainya
 * sama dengan fixture render katalog di scripts/render-katalog.ts.
 */
export const SCRIPT_CATALOG_AUDIT_FIXTURE = {
  product: {
    id: "katalog-script-audit",
    name: "Mosseru Bright Shower Gel",
    price_idr: 189_000,
    category: "beauty",
    sourceUrl: null,
  } satisfies ProductInput,
  register: "bunda" as const,
  variantsPerTemplate: 4,
  expectedTemplateCount: 33,
  expectedFixedHookCount: 33,
  expectedTotalHookCount: 132,
  minimumUniqueSegmentSentences: 150,
  minimumUniqueNonHookSegmentSentences: 100,
  nearDuplicateThreshold: 0.8,
  bodyNearDuplicateThreshold: 0.72,
  sharedBodyBlockWords: 6,
  maximumDemoPriceMentions: 66,
  maximumProofPriceSkeletonRate: 0.2,
  maximumHookPriceMentions: 33,
  maximumFixedHookPriceMentions: 8,
  maximumTemplatesPerSharedHookPrefix: 4,
} as const;

const AUDIT_PRODUCT_BY_CATEGORY: Record<string, string> = {
  beauty: "Serum Uji Katalog", fashion: "Kemeja Uji Katalog",
  muslim_fashion: "Hijab Uji Katalog", home: "Rak Uji Katalog",
  kitchen: "Alat Dapur Uji", gadget: "Gadget Uji Katalog",
  food: "Camilan Uji Katalog", kids: "Tas Anak Uji", jasa: "Jasa Uji Katalog",
  app: "Aplikasi Uji Katalog", toko: "Toko Uji Katalog", default: "Produk Uji Katalog",
};

const AUDIT_DYNAMIC_SLOTS: Array<[RegExp, string]> = [
  [/\b(?:build quality(?:-nya| nya)?|teksturnya|bahannya|materialnya|rasanya|jahitannya|kualitasnya)\b/giu, " PLACEHOLDER_BUKTI "],
  [/\b(?:kusamnya|gerahnya|berantakannya|ribetnya|lemotnya|enegnya|rewelnya|zonknya)\b/giu, " PLACEHOLDER_MASALAH "],
  [/\b(?:skincare-an malem|mix and match baju|styling hijab|beres-beres rumah|masak tiap hari|ganti-ganti aksesori hp|jajan online|belanja kebutuhan anak|belanja online)\b/giu, " PLACEHOLDER_AKTIVITAS "],
  [/\b(?:meja skincare|isi lemari|meja kerja|stok cemilan|ruang main|dapur|rumah)\b/giu, " PLACEHOLDER_RUANG "],
  [/\b(?:tim glowing|anak ootd|anak hijab|tim rumah rapi|tim masak rumahan|anak gadget|anak jajan|bunda kekinian|anak tiktok)\b/giu, " PLACEHOLDER_IDENTITAS "],
  [/\b(?:skincare|baju|hijab|barang rumah|alat dapur|gadget|cemilan|barang anak|barang)\b/giu, " PLACEHOLDER_KATEGORI "],
];

/** Samakan kosakata katalog dengan kategori yang benar-benar dipahami engine. */
export function normalizeBestForCategory(category: string): string {
  const normalized = category.trim().toLocaleLowerCase("id-ID");
  if (normalized === "electronics") return "gadget";
  if (normalized === "health") return "beauty";
  return Object.prototype.hasOwnProperty.call(AUDIT_PRODUCT_BY_CATEGORY, normalized)
    ? normalized
    : "default";
}

/** Fixture tiap template mengikuti bestFor-nya; audit tidak lagi memaksa serum
 * beauty ke template makanan, jasa, aplikasi, atau pakaian. */
export function auditProductForTemplate(template: Pick<CampaignTemplate, "id" | "bestFor">): ProductInput {
  const sourceCategory = template.bestFor[0] ?? "default";
  const category = normalizeBestForCategory(sourceCategory);
  return {
    id: `katalog-script-audit-${template.id}`,
    name: AUDIT_PRODUCT_BY_CATEGORY[category] ?? AUDIT_PRODUCT_BY_CATEGORY.default,
    price_idr: SCRIPT_CATALOG_AUDIT_FIXTURE.product.price_idr,
    category,
    sourceUrl: null,
  };
}

export interface AuditTextRef {
  templateId: string;
  variantIndex: number;
  text: string;
  normalized: string;
}

export interface NearDuplicatePair {
  left: Pick<AuditTextRef, "templateId" | "variantIndex" | "text">;
  right: Pick<AuditTextRef, "templateId" | "variantIndex" | "text">;
  score: number;
}

export interface CatalogLanguageFinding {
  templateId: string;
  variantIndex: number;
  role: string;
  text: string;
  matches: string[];
}

export interface CatalogTemplateAudit {
  templateId: string;
  templateName: string;
  group: string | null;
  kind: string;
  configuration: {
    durationSec: number;
    tier: string;
    hookLevel: string;
    hookFamily: string | null;
    configuredCount: number;
    auditedCount: number;
    fixtureSourceCategory: string;
    fixtureCategory: string;
    fixtureCompatible: boolean;
  };
  hasCopy: boolean;
  fixedHook: AuditTextRef | null;
  uniqueHookCount: number;
  uniqueDemoCount: number;
  uniqueCtaCount: number;
  uniqueScriptCount: number;
  count4Passed: boolean;
  count4DemoPassed: boolean;
  deliveryTagSignatures: string[];
  uniqueDeliveryTagSignatureCount: number;
  deliveryTagSignaturesPassed: boolean;
  duplicateFailureReasons: string[];
  allVariantsValidationPassed: boolean;
  nearDuplicateHookRefs: Array<{
    ownVariantIndex: number;
    otherTemplateId: string;
    otherVariantIndex: number;
    score: number;
  }>;
  variants: Array<{
    variantIndex: number;
    hookFamily: string;
    hook: AuditTextRef | null;
    scriptNormalized: string;
    segments: Array<{
      role: string;
      text: string;
      ttsText: string | null;
      normalized: string;
    }>;
    delivery: {
      mode: "voiced" | "silent";
      allowedTags: string[];
      allowedTagCount: number;
      signature: string;
      unknownTags: string[];
      passed: boolean;
      failureReasons: string[];
    };
    validation: GeneratedScript["validation"];
  }>;
}

export interface CatalogScriptAudit {
  generatedAt: string;
  fixture: typeof SCRIPT_CATALOG_AUDIT_FIXTURE;
  templates: CatalogTemplateAudit[];
  nearDuplicateHookPairs: NearDuplicatePair[];
  summary: {
    templateCount: number;
    templatesWithCopy: number;
    fixedHookCount: number;
    uniqueFixedHookCount: number;
    totalHookCount: number;
    uniqueTotalHookCount: number;
    totalSegmentSentenceCount: number;
    uniqueSegmentSentenceCount: number;
    totalNonHookSegmentSentenceCount: number;
    uniqueNonHookSegmentSentenceCount: number;
    uniqueDemoCount: number;
    totalDemoCount: number;
    uniqueCtaCount: number;
    count4DuplicateFailures: number;
    count4DemoDuplicateFailures: number;
    deliveryTagDistribution: Record<string, number>;
    missingDeliveryTags: string[];
    deliverySignatureFailureTemplateIds: string[];
    deliveryFailureVariants: number;
    validationFailureVariants: number;
    templatesMissingCopy: string[];
    count4FailureTemplateIds: string[];
    count4DemoFailureTemplateIds: string[];
    crossTemplateCtaDuplicatePairs: Array<{
      normalizedCta: string;
      templateIds: string[];
    }>;
    incompatibleFixtureTemplateIds: string[];
    nearDuplicateBodyPairs: NearDuplicatePair[];
    sharedBodyBlocks: Array<{ block: string; templateIds: string[] }>;
    productionJargonRefs: CatalogLanguageFinding[];
    unsupportedClaimRefs: CatalogLanguageFinding[];
    creativeAnalysisRefs: CatalogLanguageFinding[];
    semanticRiskRefs: CatalogLanguageFinding[];
    danglingFragmentRefs: CatalogLanguageFinding[];
    demosMentioningPriceCount: number;
    demosMentioningPriceRefs: CatalogLanguageFinding[];
    proofPriceSkeletonCount: number;
    maximumProofPriceSkeletonCount: number;
    repeatedProofPriceSkeletons: Array<{ skeleton: string; templateIds: string[]; refs: string[] }>;
    emphasisCueCount: number;
    voicedTemplatesWithEmphasisCue: number;
    missingEmphasisCueTemplateIds: string[];
    hooksMentioningPriceCount: number;
    hooksMentioningPriceRefs: CatalogLanguageFinding[];
    fixedHooksMentioningPriceCount: number;
    fixedHooksMentioningPriceRefs: CatalogLanguageFinding[];
    bannedBoilerplateHookRefs: CatalogLanguageFinding[];
    sharedHookPrefixes: Array<{ prefix: string; tokenCount: number; templateIds: string[]; refs: string[] }>;
    intraHookEchoRefs: CatalogLanguageFinding[];
    mechanicalPhraseRefs: CatalogLanguageFinding[];
    deliveryFailureRefs: Array<{
      templateId: string;
      variantIndex: number;
      mode: "voiced" | "silent";
      allowedTagCount: number;
      unknownTags: string[];
      failureReasons: string[];
    }>;
    unknownAudioTagRefs: Array<{
      templateId: string;
      variantIndex: number;
      tags: string[];
    }>;
    validationFailureRefs: Array<{
      templateId: string;
      variantIndex: number;
      errors: GeneratedScript["validation"]["errors"];
    }>;
    targets: {
      templateCount: boolean;
      everyTemplateHasCopy: boolean;
      fixedHooksUnique: boolean;
      totalHooksUnique: boolean;
      enoughUniqueSegmentSentences: boolean;
      enoughUniqueNonHookSegmentSentences: boolean;
      count4HasNoDuplicates: boolean;
      count4DemosAreUnique: boolean;
      ctasDoNotRepeatAcrossTemplates: boolean;
      fixturesMatchBestFor: boolean;
      bodiesNotNearDuplicate: boolean;
      noSharedBodyBlocks: boolean;
      noSpokenProductionJargon: boolean;
      noUnsupportedFactualClaims: boolean;
      noSpokenCreativeAnalysis: boolean;
      riskyEvidenceTemplatesStayNeutral: boolean;
      noDanglingFragments: boolean;
      demoPriceMentionsWithinLimit: boolean;
      genericProofPriceSkeletonWithinLimit: boolean;
      proofPriceSkeletonsNotShared: boolean;
      hookPriceMentionsWithinLimit: boolean;
      fixedHookPriceMentionsWithinLimit: boolean;
      noBannedBoilerplateHookStarters: boolean;
      sharedHookPrefixesWithinCap: boolean;
      noIntraHookSemanticEchoes: boolean;
      noMechanicalSpokenPhrases: boolean;
      deliveryTagsValid: boolean;
      deliveryTagInventoryComplete: boolean;
      deliverySignaturesUnique: boolean;
      everyVoicedTemplateHasEmphasisCue: boolean;
      everyVariantPassesValidation: boolean;
    };
    passed: boolean;
  };
}

/**
 * Normalisasi exact-match sengaja menghapus kapitalisasi, emoji, tanda baca,
 * aksen, dan spasi ganda. Perubahan kosmetik tidak boleh dihitung sebagai
 * kalimat baru.
 */
export function normalizeAuditText(text: string): string {
  const productNames = [SCRIPT_CATALOG_AUDIT_FIXTURE.product.name, ...Object.values(AUDIT_PRODUCT_BY_CATEGORY)];
  // Bentuk harga yang mungkin dirender engine untuk fixture 189.000 rupiah.
  // Diganti sebelum tanda baca dibuang agar "Rp 189.000" tidak berubah menjadi
  // token berbeda dari "189 ribu" dan menaikkan angka keunikan secara palsu.
  const pricePatterns = [
    /\brp\s*189[.\s]?000\b/giu,
    /\b189[.\s]?000\b/gu,
    /\b189\s*ribu\b/giu,
  ];
  // Defensif: arsitektur resmi sudah memisahkan tag ke `tts_text`, tetapi tag
  // whitelist tetap dibuang bila copy lama menyelipkannya di `text`. Dengan
  // begitu cue audio tidak pernah bisa menaikkan angka keunikan naskah.
  let canonical = stripDeliveryTags(text);
  for (const productName of productNames) {
    canonical = canonical.replace(new RegExp(escapeRegExp(productName), "giu"), " PLACEHOLDER_PRODUK ");
  }
  for (const pattern of pricePatterns) canonical = canonical.replace(pattern, " PLACEHOLDER_HARGA ");
  for (const [pattern, replacement] of AUDIT_DYNAMIC_SLOTS) canonical = canonical.replace(pattern, replacement);
  return canonical
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("id-ID")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PRODUCTION_JARGON = [
  /\bkameranya?\b/giu, /\bframing\b/giu, /\bframe\b/giu,
  /\b(?:di)?rekam(?:an)?\b/giu, /\bpengambilan\b/giu,
  /\bfilter\b/giu, /\b(?:di)?edit\b/giu, /\bclose[ -]?up\b/giu,
];

const UNSUPPORTED_FACTUAL_CLAIMS = [
  /\bsetelah\s+[^.!?;]{0,50}\s+dipakai\b/giu,
  /\bpemakaian nyata\b/giu, /\bterasa (?:rapi|niat|beda|dirancang|praktis)\b/giu,
  /\bkualitasnya (?:lebih )?mudah dibaca\b/giu,
  /\bfungsinya (?:memang )?kepakai\b/giu, /\bkesan pertamanya\b/giu,
  /\b(?:aku|saya) suka\b/giu, /\bkelebihannya?\b/giu,
  /\brapi\b/giu, /\bsegel(?:nya)? (?:terbuka|lepas) mulus\b/giu,
  /\bterasa (?:ringkas|kokoh|halus|nyaman|lega|hangat|lebih nyata)\b/giu,
  /\bpaling menonjol\b/giu, /\bfitur(?:nya)?[^.!?;]{0,35}\bkepakai\b/giu,
  /\btidak bisa dipalsukan\b/giu, /\bnggak bisa dipalsukan\b/giu,
  /\b(?:berfungsi|bekerja) (?:dengan )?(?:baik|mulus|cepat)\b/giu,
  /\b(?:mudah|gampang|enak|praktis|nyaman) (?:dipakai|digunakan|dibawa|dipahami|dinilai)\b/giu,
  /\bcocok (?:buat|untuk)\b/giu,
  /\b(?:membuat|bikin)[^.!?;]{0,45}\blebih (?:mudah|praktis|nyaman|rapi|cepat)\b/giu,
  /\bkualitasnya cocok\b/giu,
  /\b(?:jatuh|terjatuh|benturan|terbentur|impact)\b[^.!?;]{0,60}\bmasih utuh\b/giu,
  /\bmasih utuh\b[^.!?;]{0,60}\b(?:setelah|sesudah|habis)\s+(?:jatuh|terjatuh|benturan|terbentur|impact)\b/giu,
];

const CREATIVE_ANALYSIS_PHRASES = [
  /\bkejutan(?:nya)?\b/giu, /\bpembuka(?:nya)?\b/giu,
  /\b(?:menarik|merebut|menangkap) perhatian\b/giu, /\befek dramatis\b/giu,
  /\bmekanisme iklan\b/giu, /\balur (?:iklan|cerita)\b/giu,
  /\bmengarang keramaian\b/giu,
  /\bmenjanjikan pengalaman orang lain\b/giu,
  /\bubah klaim menjadi pertanyaan\b/giu,
  /\brincian[^.!?;]{0,60}\btidak tersedia\b/giu,
  /\btidak perlu dibuat seolah (?:sudah )?diketahui\b/giu,
  /\b(?:tidak|nggak) menjelaskan fungsi\b/giu,
  /\bpisahkan kesan visual dari manfaat\b/giu,
  /\b(?:ini |itu )?bukan (?:sebuah )?bukti\b/giu,
  /\b(?:ini |itu )?bukan (?:sebuah )?janji\b/giu,
  /\b(?:jika|kalau) manfaat(?:nya)? (?:tidak|belum|nggak) (?:tertulis|tersedia|disebutkan)\b/giu,
];

const BANNED_HOOK_STARTERS = /^(?:di harga|pada harga|untuk banderol|dengan nilai)\b/iu;

const RISKY_EVIDENCE_PATTERNS: Record<string, RegExp[]> = {
  "t05-before-after": [
    /\b(?:sebelum|sesudah|setelah|awal|akhir|hasil|berubah|perubahan|perbedaan)\b/giu,
  ],
  "t08-day-1-vs-day-7": [
    /\b(?:hari (?:pertama|ke[- ]?\w+)|day\s*\d+|setelah|hasil|berubah|perubahan|rutinitas)\b/giu,
  ],
  "t10-bukti-di-lengan": [
    /\b(?:(?:satu|dua|kedua) lengan|lengan[^.!?;]{0,35}(?:beda|hasil|banding)|(?:beda|hasil|banding)[^.!?;]{0,35}lengan)\b/giu,
  ],
};

function regexMatches(text: string, patterns: RegExp[]): string[] {
  const clean = stripDeliveryTags(text);
  return [...new Set(patterns.flatMap((pattern) => [...clean.matchAll(pattern)].map((match) => match[0].toLowerCase())))];
}

export function spokenProductionJargon(text: string): string[] {
  return regexMatches(text, PRODUCTION_JARGON);
}

export function spokenCreativeAnalysis(text: string): string[] {
  return regexMatches(text, CREATIVE_ANALYSIS_PHRASES);
}

export function bannedHookBoilerplateStarter(text: string): string[] {
  const clean = stripDeliveryTags(text).trim();
  const match = clean.match(BANNED_HOOK_STARTERS);
  return match ? [match[0].toLocaleLowerCase("id-ID")] : [];
}

/** Prefix 2–4 token setelah normalisasi slot; dipakai mengungkap starter yang
 * hanya mengganti harga/produk tetapi mempertahankan ritme yang sama. */
export function normalizedHookPrefixes(text: string): string[] {
  const tokens = normalizeAuditText(text).split(" ").filter(Boolean);
  return [2, 3, 4]
    .filter((size) => tokens.length >= size)
    .map((size) => tokens.slice(0, size).join(" "));
}

const ECHO_STOPWORDS = new Set([
  "aku", "saya", "kamu", "anda", "yang", "dan", "atau", "ini", "itu", "di", "ke", "dari",
  "buat", "untuk", "dengan", "sama", "satu", "aja", "dulu", "lagi", "kok", "nih", "tuh", "banget",
  "placeholder", "harga", "produk", "kategori", "identitas", "ruang", "aktivitas", "masalah", "bukti",
]);

const ECHO_SYNONYMS: Record<string, string> = {
  lihat: "inspect", melihat: "inspect", dilihat: "inspect", perhatikan: "inspect", memperhatikan: "inspect",
  amati: "inspect", mengamati: "inspect", cek: "inspect", mengecek: "inspect", periksa: "inspect", memeriksa: "inspect",
  beda: "compare", bedanya: "compare", perbedaan: "compare", bandingkan: "compare", membandingkan: "compare",
  tampak: "visible", terlihat: "visible", kelihatan: "visible", jelas: "visible",
  fungsi: "function", manfaat: "function", kegunaan: "function", kerja: "function",
  bukti: "proof", buktinya: "proof", membuktikan: "proof",
};

function echoToken(token: string): string {
  const direct = ECHO_SYNONYMS[token];
  if (direct) return direct;
  const unprefixed = token.replace(/^(?:memper|meng|meny|men|mem|ber|ter|di|ke)/u, "");
  if (ECHO_SYNONYMS[unprefixed]) return ECHO_SYNONYMS[unprefixed];
  const stem = unprefixed.replace(/(?:nya|lah|kan|an|i)$/u, "");
  return ECHO_SYNONYMS[stem] ?? stem;
}

function echoClauseTokens(clause: string): Set<string> {
  const normalized = normalizeAuditText(clause);
  return new Set(normalized.split(" ")
    .map(echoToken)
    .filter((token) => token.length > 1 && !ECHO_STOPWORDS.has(token)));
}

/** Pecah di tanda baca/interjeksi, lalu cari dua klausa yang mengatakan hal
 * sama meski urutan kata atau verba inspect/compare-nya berbeda. */
export function intraHookSemanticEchoReasons(text: string): string[] {
  const clean = stripDeliveryTags(text)
    .replace(/\b(?:nah|eh|sumpah|btw|bun|bunda|bestie)\b/giu, "|")
    .replace(/[,.!?;:—–-]+/gu, "|");
  const clauses = clean.split("|").map((clause) => clause.trim()).filter(Boolean);
  const tokenSets = clauses.map(echoClauseTokens).filter((tokens) => tokens.size >= 2);
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      const a = tokenSets[left];
      const b = tokenSets[right];
      let intersection = 0;
      for (const token of a) if (b.has(token)) intersection += 1;
      const jaccard = intersection / (a.size + b.size - intersection);
      const containment = intersection / Math.min(a.size, b.size);
      if (jaccard >= 0.6 || containment >= 0.75) {
        return [`semantic echo jaccard=${jaccard.toFixed(2)} containment=${containment.toFixed(2)}`];
      }
    }
  }
  return [];
}

const MECHANICAL_ACTIONS = new Set(["cek", "buka", "lihat", "pelajari", "bandingkan", "periksa"]);

export function mechanicalSpokenPhraseReasons(text: string, role = ""): string[] {
  const clean = stripDeliveryTags(text).trim();
  const normalized = normalizeAuditText(clean);
  const tokens = normalized.split(" ").filter(Boolean);
  const reasons: string[] = [];
  if (/\bberkas produk\b/iu.test(clean)) reasons.push("berkas produk");
  if (role === "cta" && tokens.length > 10) reasons.push(`bloated CTA ${tokens.length} tokens`);
  if (role === "cta" && tokens.filter((token) => MECHANICAL_ACTIONS.has(token) || echoToken(token) === "inspect").length >= 2) {
    reasons.push("stacked mechanical CTA actions");
  }
  const bigrams = new Set<string>();
  const meaningfulPatternTokens = new Set(["inspect", "compare", "visible", "function", "proof", "produk", "barang", "aku", "kamu"]);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = [echoToken(tokens[index]), echoToken(tokens[index + 1])];
    const bigram = pair.join(" ");
    if (bigrams.has(bigram) && !bigram.includes("placeholder") && pair.some((token) => meaningfulPatternTokens.has(token))) {
      reasons.push(`duplicated action/subject pattern: ${bigram}`);
      break;
    }
    bigrams.add(bigram);
  }
  return reasons;
}

export function riskyEvidenceClaims(templateId: string, text: string): string[] {
  return regexMatches(text, RISKY_EVIDENCE_PATTERNS[templateId] ?? []);
}

export function unsupportedFactualClaims(text: string): string[] {
  const matches = regexMatches(text, UNSUPPORTED_FACTUAL_CLAIMS);
  const normalized = normalizeAuditText(text);
  if (/\bplaceholder produk\b(?:\s+\p{L}+){0,3}\s+membantu\s+(?:saat|kebutuhan|satu kebutuhan|alur|rutinitas)\b/iu.test(normalized)) {
    matches.push("produk membantu");
  }
  return [...new Set(matches)];
}

/** Fragmen yang berakhir pada kata penghubung/preposisi tidak boleh lolos
 * hanya karena jumlah katanya cukup dan teksnya berbeda secara exact. */
export function danglingFragmentReasons(text: string): string[] {
  const clean = stripDeliveryTags(text).trim();
  const reasons: string[] = [];
  if (!clean) return ["empty segment"];
  if (/\b(?:dan|atau|karena|kalau|dengan|buat|untuk|yang|di|ke|dari|tapi|lalu|supaya|biar)\s*[,.!?;:]*$/iu.test(clean)) {
    reasons.push("ends with connector");
  }
  if (/^[,.;:!?]/u.test(clean)) reasons.push("starts with punctuation");
  if ((clean.match(/\(/g)?.length ?? 0) !== (clean.match(/\)/g)?.length ?? 0)) reasons.push("unbalanced parentheses");
  return reasons;
}

export function proofPriceSkeleton(text: string): string | null {
  const normalized = normalizeAuditText(text);
  if (!normalized.includes("placeholder bukti") || !normalized.includes("placeholder harga")) return null;
  return normalized
    .replace(/\b(?:aku|saya|gue|kamu|kalian|bunda|bestie|nah|eh|sih|loh|ya|deh|dong)\b/g, " ")
    .replace(/\bplaceholder (?:produk|bukti|harga|masalah|aktivitas|ruang|identitas|kategori)\b/g, (slot) => slot.replace(" ", "_"))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Istilah platform wajib tidak membuat CTA dianggap berbeda. */
function normalizeCtaForOwnership(text: string): string {
  return normalizeAuditText(text)
    .replace(/\bkeranjang kuning\b/g, "placeholder platform")
    .replace(/\bkeranjang\b/g, "placeholder platform")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccard(left: string, right: string): number {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function nearDuplicatePairs(refs: AuditTextRef[], threshold: number): NearDuplicatePair[] {
  const pairs: NearDuplicatePair[] = [];
  for (let i = 0; i < refs.length; i += 1) {
    for (let j = i + 1; j < refs.length; j += 1) {
      if (refs[i].normalized === refs[j].normalized) continue;
      const score = tokenJaccard(refs[i].normalized, refs[j].normalized);
      if (score < threshold) continue;
      pairs.push({
        left: {
          templateId: refs[i].templateId,
          variantIndex: refs[i].variantIndex,
          text: refs[i].text,
        },
        right: {
          templateId: refs[j].templateId,
          variantIndex: refs[j].variantIndex,
          text: refs[j].text,
        },
        score: Number(score.toFixed(3)),
      });
    }
  }
  return pairs;
}

function crossTemplateNearDuplicatePairs(refs: AuditTextRef[], threshold: number): NearDuplicatePair[] {
  return nearDuplicatePairs(refs, threshold).filter((pair) => pair.left.templateId !== pair.right.templateId);
}

function sharedBodyBlocks(refs: AuditTextRef[], wordsPerBlock: number): Array<{ block: string; templateIds: string[] }> {
  const owners = new Map<string, Set<string>>();
  for (const ref of refs) {
    const words = ref.normalized.split(" ").filter(Boolean);
    const local = new Set<string>();
    for (let index = 0; index <= words.length - wordsPerBlock; index += 1) {
      const block = words.slice(index, index + wordsPerBlock).join(" ");
      if (local.has(block)) continue;
      local.add(block);
      const ids = owners.get(block) ?? new Set<string>();
      ids.add(ref.templateId);
      owners.set(block, ids);
    }
  }
  return [...owners.entries()]
    .filter(([, templateIds]) => templateIds.size > 1)
    .map(([block, templateIds]) => ({ block, templateIds: [...templateIds].sort() }))
    .sort((left, right) => left.block.localeCompare(right.block));
}

function textRef(templateId: string, variantIndex: number, text: string): AuditTextRef {
  return { templateId, variantIndex, text, normalized: normalizeAuditText(text) };
}

function allowedDeliveryTags(text: string): string[] {
  const matches: string[] = [];
  for (const tag of DELIVERY_TAGS) {
    let from = 0;
    while (true) {
      const index = text.indexOf(tag, from);
      if (index === -1) break;
      matches.push(tag);
      from = index + tag.length;
    }
  }
  return matches;
}

/**
 * Menjalankan konfigurasi template yang benar-benar aktif. Audit tidak
 * mengubah durasi, rute, beat, tier, atau keluarga hook; satu-satunya override
 * adalah count=4 agar kapasitas variasi diuji secara seragam.
 */
export async function generateCatalogScriptAudit(): Promise<CatalogScriptAudit> {
  const fixture = SCRIPT_CATALOG_AUDIT_FIXTURE;
  const rawTemplates: Awaited<ReturnType<typeof satuTemplate>>[] = [];
  for (const template of CAMPAIGN_TEMPLATES) rawTemplates.push(await satuTemplate(template));

  async function satuTemplate(template: (typeof CAMPAIGN_TEMPLATES)[number]) {
    const product = auditProductForTemplate(template);
    const fixtureSourceCategory = template.bestFor[0] ?? "default";
    const fixtureCategory = product.category;
    const fixtureCompatible = normalizeBestForCategory(fixtureSourceCategory) === fixtureCategory;
    const variants = await generateScripts({
      product,
      register: fixture.register,
      qualityTier: template.tier,
      durationSec: template.durationSec,
      count: fixture.variantsPerTemplate,
      hookLevel: template.hookLevel,
      ...(template.hookFamily
        ? { hookFamilies: [template.hookFamily as GeneratedScript["hook_family"]], lockHookFamily: true }
        : {}),
      ...(template.beats ? { beats: template.beats } : {}),
      ...(template.wordBudget ? { wordBudget: template.wordBudget } : {}),
      templateId: template.id,
    });

    const variantEvidence = variants.map((variant, variantIndex) => {
      const hookSegment = variant.segments.find((segment) => segment.role === "hook") ?? null;
      const segments = variant.segments.map((segment) => ({
        role: segment.role,
        text: segment.text,
        ttsText: segment.tts_text ?? null,
        normalized: normalizeAuditText(segment.text),
      }));
      const ttsTexts = variant.segments.flatMap((segment) => segment.tts_text ? [segment.tts_text] : []);
      const allowedTags = ttsTexts.flatMap(allowedDeliveryTags);
      const signature = variant.segments
        .map((segment) => `${segment.role}:${allowedDeliveryTags(segment.tts_text ?? "").join(",")}`)
        .join("|");
      const unknownTags = [...new Set(ttsTexts.flatMap(unknownDeliveryTags))];
      const misplacedEmphasis = [...new Set(ttsTexts.flatMap(misplacedEmphasisTags))];
      const mode: "voiced" | "silent" = template.tier === "silent_caption" ? "silent" : "voiced";
      const deliveryFailureReasons: string[] = [];
      if (unknownTags.length > 0) deliveryFailureReasons.push(`unknown audio tags: ${unknownTags.join(", ")}`);
      if (misplacedEmphasis.length > 0) deliveryFailureReasons.push(`emphasis tag must start a line: ${misplacedEmphasis.join(", ")}`);
      if (mode === "voiced" && allowedTags.length < 2) {
        deliveryFailureReasons.push(`voiced variant requires at least 2 delivery tags, received ${allowedTags.length}`);
      }
      if (mode === "silent" && ttsTexts.length > 0) {
        deliveryFailureReasons.push("silent_caption must not define tts_text");
      }
      return {
        variantIndex,
        hookFamily: variant.hook_family,
        hook: hookSegment ? textRef(template.id, variantIndex, hookSegment.text) : null,
        scriptNormalized: segments.map((segment) => `${segment.role}:${segment.normalized}`).join("|"),
        segments,
        delivery: {
          mode,
          allowedTags,
          allowedTagCount: allowedTags.length,
          signature,
          unknownTags,
          passed: deliveryFailureReasons.length === 0,
          failureReasons: deliveryFailureReasons,
        },
        validation: variant.validation,
      };
    });

    const normalizedHooks = variantEvidence.flatMap((variant) => variant.hook ? [variant.hook.normalized] : []);
    const normalizedDemos = variantEvidence.flatMap((variant) =>
      variant.segments.filter((segment) => segment.role === "demo").map((segment) => segment.normalized)
    );
    const normalizedCtas = variantEvidence.flatMap((variant) =>
      variant.segments.filter((segment) => segment.role === "cta").map((segment) => segment.normalized)
    );
    const normalizedScripts = variantEvidence.map((variant) => variant.scriptNormalized);
    const duplicateFailureReasons: string[] = [];
    if (variants.length !== fixture.variantsPerTemplate) {
      duplicateFailureReasons.push(`expected ${fixture.variantsPerTemplate} variants, received ${variants.length}`);
    }
    if (new Set(normalizedHooks).size !== fixture.variantsPerTemplate) {
      duplicateFailureReasons.push(`expected ${fixture.variantsPerTemplate} unique hooks, received ${new Set(normalizedHooks).size}`);
    }
    if (new Set(normalizedScripts).size !== fixture.variantsPerTemplate) {
      duplicateFailureReasons.push(`expected ${fixture.variantsPerTemplate} unique scripts, received ${new Set(normalizedScripts).size}`);
    }
    if (new Set(normalizedDemos).size !== fixture.variantsPerTemplate) {
      duplicateFailureReasons.push(`expected ${fixture.variantsPerTemplate} unique demos, received ${new Set(normalizedDemos).size}`);
    }
    const deliveryTagSignatures = variantEvidence.map((variant) => variant.delivery.signature);
    const uniqueDeliveryTagSignatureCount = new Set(deliveryTagSignatures).size;
    const deliveryTagSignaturesPassed = template.tier === "silent_caption"
      || uniqueDeliveryTagSignatureCount === fixture.variantsPerTemplate;

    return {
      templateId: template.id,
      templateName: template.name,
      group: template.group ?? null,
      kind: template.kind,
      configuration: {
        durationSec: template.durationSec,
        tier: template.tier,
        hookLevel: template.hookLevel,
        hookFamily: template.hookFamily,
        configuredCount: template.count,
        auditedCount: fixture.variantsPerTemplate,
        fixtureSourceCategory,
        fixtureCategory,
        fixtureCompatible,
      },
      hasCopy: Object.prototype.hasOwnProperty.call(TEMPLATE_COPY, template.id),
      fixedHook: variantEvidence[0]?.hook ?? null,
      uniqueHookCount: new Set(normalizedHooks).size,
      uniqueDemoCount: new Set(normalizedDemos).size,
      uniqueCtaCount: new Set(normalizedCtas).size,
      uniqueScriptCount: new Set(normalizedScripts).size,
      count4Passed: duplicateFailureReasons.length === 0,
      count4DemoPassed: new Set(normalizedDemos).size === fixture.variantsPerTemplate,
      deliveryTagSignatures,
      uniqueDeliveryTagSignatureCount,
      deliveryTagSignaturesPassed,
      duplicateFailureReasons,
      allVariantsValidationPassed: variantEvidence.length === fixture.variantsPerTemplate
        && variantEvidence.every((variant) => variant.validation.passed),
      nearDuplicateHookRefs: [] as CatalogTemplateAudit["nearDuplicateHookRefs"],
      variants: variantEvidence,
    } satisfies CatalogTemplateAudit;
  }

  const allHookRefs = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) => variant.hook ? [variant.hook] : [])
  );
  const nearDuplicateHookPairs = nearDuplicatePairs(allHookRefs, fixture.nearDuplicateThreshold);
  for (const pair of nearDuplicateHookPairs) {
    const leftTemplate = rawTemplates.find((template) => template.templateId === pair.left.templateId);
    const rightTemplate = rawTemplates.find((template) => template.templateId === pair.right.templateId);
    leftTemplate?.nearDuplicateHookRefs.push({
      ownVariantIndex: pair.left.variantIndex,
      otherTemplateId: pair.right.templateId,
      otherVariantIndex: pair.right.variantIndex,
      score: pair.score,
    });
    rightTemplate?.nearDuplicateHookRefs.push({
      ownVariantIndex: pair.right.variantIndex,
      otherTemplateId: pair.left.templateId,
      otherVariantIndex: pair.left.variantIndex,
      score: pair.score,
    });
  }

  const fixedHooks = rawTemplates.flatMap((template) => template.fixedHook ? [template.fixedHook] : []);
  const hookFinding = (ref: AuditTextRef, matches: string[]): CatalogLanguageFinding => ({
    templateId: ref.templateId,
    variantIndex: ref.variantIndex,
    role: "hook",
    text: ref.text,
    matches,
  });
  const hooksMentioningPriceRefs = allHookRefs
    .filter((ref) => ref.normalized.includes("placeholder harga"))
    .map((ref) => hookFinding(ref, ["rendered price"]));
  const fixedHooksMentioningPriceRefs = fixedHooks
    .filter((ref) => ref.normalized.includes("placeholder harga"))
    .map((ref) => hookFinding(ref, ["rendered price"]));
  const bannedBoilerplateHookRefs = allHookRefs.flatMap((ref) => {
    const matches = bannedHookBoilerplateStarter(ref.text);
    return matches.length === 0 ? [] : [hookFinding(ref, matches)];
  });
  const hookPrefixOwners = new Map<string, { tokenCount: number; templateIds: Set<string>; refs: string[] }>();
  for (const ref of allHookRefs) {
    for (const prefix of normalizedHookPrefixes(ref.text)) {
      const entry = hookPrefixOwners.get(prefix) ?? {
        tokenCount: prefix.split(" ").length,
        templateIds: new Set<string>(),
        refs: [],
      };
      entry.templateIds.add(ref.templateId);
      entry.refs.push(`${ref.templateId}#${ref.variantIndex}`);
      hookPrefixOwners.set(prefix, entry);
    }
  }
  const sharedHookPrefixes = [...hookPrefixOwners.entries()]
    .filter(([, entry]) => entry.templateIds.size > fixture.maximumTemplatesPerSharedHookPrefix)
    .map(([prefix, entry]) => ({
      prefix,
      tokenCount: entry.tokenCount,
      templateIds: [...entry.templateIds].sort(),
      refs: entry.refs.sort(),
    }))
    .sort((left, right) => right.templateIds.length - left.templateIds.length || left.prefix.localeCompare(right.prefix));
  const intraHookEchoRefs = allHookRefs.flatMap((ref) => {
    const matches = intraHookSemanticEchoReasons(ref.text);
    return matches.length === 0 ? [] : [hookFinding(ref, matches)];
  });
  const segmentSentences = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) => variant.segments.map((segment) => segment.normalized))
  );
  const nonHookSegmentSentences = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) =>
      variant.segments.filter((segment) => segment.role !== "hook").map((segment) => segment.normalized)
    )
  );
  const nonHookRefs = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) =>
      variant.segments
        .filter((segment) => segment.role !== "hook")
        .map((segment) => textRef(template.templateId, variant.variantIndex, segment.text))
    )
  );
  const nearDuplicateBodyPairs = crossTemplateNearDuplicatePairs(nonHookRefs, fixture.bodyNearDuplicateThreshold);
  const repeatedBodyBlocks = sharedBodyBlocks(nonHookRefs, fixture.sharedBodyBlockWords);
  const languageFindings = (detector: (text: string) => string[]): CatalogLanguageFinding[] =>
    rawTemplates.flatMap((template) => template.variants.flatMap((variant) =>
      variant.segments.flatMap((segment) => {
        const matches = detector(segment.text);
        return matches.length === 0 ? [] : [{
          templateId: template.templateId,
          variantIndex: variant.variantIndex,
          role: segment.role,
          text: segment.text,
          matches,
        }];
      })
    ));
  const productionJargonRefs = languageFindings(spokenProductionJargon);
  const unsupportedClaimRefs = languageFindings(unsupportedFactualClaims);
  const creativeAnalysisRefs = languageFindings(spokenCreativeAnalysis);
  const danglingFragmentRefs = languageFindings(danglingFragmentReasons);
  const mechanicalPhraseRefs = rawTemplates.flatMap((template) => template.variants.flatMap((variant) =>
    variant.segments.flatMap((segment) => {
      const matches = mechanicalSpokenPhraseReasons(segment.text, segment.role);
      return matches.length === 0 ? [] : [{
        templateId: template.templateId,
        variantIndex: variant.variantIndex,
        role: segment.role,
        text: segment.text,
        matches,
      }];
    })
  ));
  const semanticRiskRefs = rawTemplates.flatMap((template) => template.variants.flatMap((variant) =>
    variant.segments.flatMap((segment) => {
      const matches = riskyEvidenceClaims(template.templateId, segment.text);
      return matches.length === 0 ? [] : [{
        templateId: template.templateId,
        variantIndex: variant.variantIndex,
        role: segment.role,
        text: segment.text,
        matches,
      }];
    })
  ));
  const demoRefs = rawTemplates.flatMap((template) => template.variants.flatMap((variant) =>
    variant.segments.filter((segment) => segment.role === "demo").map((segment) => ({
      templateId: template.templateId,
      variantIndex: variant.variantIndex,
      role: segment.role,
      text: segment.text,
      matches: [] as string[],
    }))
  ));
  const demosMentioningPriceRefs = demoRefs
    .filter((ref) => normalizeAuditText(ref.text).includes("placeholder harga"))
    .map((ref) => ({ ...ref, matches: ["rendered price"] }));
  const proofPriceRefs = demoRefs.flatMap((ref) => {
    const skeleton = proofPriceSkeleton(ref.text);
    return skeleton ? [{ ...ref, skeleton }] : [];
  });
  const maximumProofPriceSkeletonCount = Math.floor(
    SCRIPT_CATALOG_AUDIT_FIXTURE.expectedTotalHookCount * fixture.maximumProofPriceSkeletonRate
  );
  const skeletonOwners = new Map<string, { templateIds: Set<string>; refs: string[] }>();
  for (const ref of proofPriceRefs) {
    const entry = skeletonOwners.get(ref.skeleton) ?? { templateIds: new Set<string>(), refs: [] };
    entry.templateIds.add(ref.templateId);
    entry.refs.push(`${ref.templateId}#${ref.variantIndex}`);
    skeletonOwners.set(ref.skeleton, entry);
  }
  const repeatedProofPriceSkeletons = [...skeletonOwners.entries()]
    .filter(([, entry]) => entry.templateIds.size > 1)
    .map(([skeleton, entry]) => ({ skeleton, templateIds: [...entry.templateIds].sort(), refs: entry.refs.sort() }))
    .sort((left, right) => left.skeleton.localeCompare(right.skeleton));
  const demos = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) =>
      variant.segments.filter((segment) => segment.role === "demo").map((segment) => segment.normalized)
    )
  );
  const ctas = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) =>
      variant.segments.filter((segment) => segment.role === "cta").map((segment) => segment.normalized)
    )
  );
  // Satu segment.text adalah unit naskah mesin. Tidak dipecah lagi di titik
  // atau tanda seru karena itu akan membuat satu segmen panjang tampak seperti
  // banyak copy independen dan mudah menggelembungkan angka 150.
  const templatesMissingCopy = rawTemplates.filter((template) => !template.hasCopy).map((template) => template.templateId);
  const incompatibleFixtureTemplateIds = rawTemplates
    .filter((template) => !template.configuration.fixtureCompatible)
    .map((template) => template.templateId);
  const count4FailureTemplateIds = rawTemplates.filter((template) => !template.count4Passed).map((template) => template.templateId);
  const count4DemoFailureTemplateIds = rawTemplates.filter((template) => !template.count4DemoPassed).map((template) => template.templateId);
  const ctaOwners = new Map<string, Set<string>>();
  for (const template of rawTemplates) {
    for (const variant of template.variants) {
      for (const segment of variant.segments.filter((item) => item.role === "cta")) {
        const normalizedCta = normalizeCtaForOwnership(segment.text);
        const owners = ctaOwners.get(normalizedCta) ?? new Set<string>();
        owners.add(template.templateId);
        ctaOwners.set(normalizedCta, owners);
      }
    }
  }
  const crossTemplateCtaDuplicatePairs = [...ctaOwners.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([normalizedCta, owners]) => ({ normalizedCta, templateIds: [...owners].sort() }))
    .sort((left, right) => left.normalizedCta.localeCompare(right.normalizedCta));
  const validationFailureRefs = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) => variant.validation.passed ? [] : [{
      templateId: template.templateId,
      variantIndex: variant.variantIndex,
      errors: variant.validation.errors,
    }])
  );
  const deliveryFailureRefs = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) => variant.delivery.passed ? [] : [{
      templateId: template.templateId,
      variantIndex: variant.variantIndex,
      mode: variant.delivery.mode,
      allowedTagCount: variant.delivery.allowedTagCount,
      unknownTags: variant.delivery.unknownTags,
      failureReasons: variant.delivery.failureReasons,
    }])
  );
  const deliveryTagDistribution: Record<string, number> = Object.fromEntries(
    DELIVERY_TAGS.map((tag) => [tag, 0])
  );
  for (const template of rawTemplates) {
    for (const variant of template.variants) {
      if (variant.delivery.mode !== "voiced") continue;
      for (const tag of variant.delivery.allowedTags) deliveryTagDistribution[tag] += 1;
    }
  }
  const missingDeliveryTags = DELIVERY_TAGS.filter((tag) => deliveryTagDistribution[tag] === 0);
  const voicedTemplates = rawTemplates.filter((template) => template.configuration.tier !== "silent_caption");
  const emphasisCueCount = DELIVERY_EMPHASIS_TAGS.reduce(
    (total, tag) => total + (deliveryTagDistribution[tag] ?? 0),
    0
  );
  const missingEmphasisCueTemplateIds = voicedTemplates
    .filter((template) => !template.variants.some((variant) =>
      variant.delivery.allowedTags.some((tag) => (DELIVERY_EMPHASIS_TAGS as readonly string[]).includes(tag))
    ))
    .map((template) => template.templateId);
  const deliverySignatureFailureTemplateIds = rawTemplates
    .filter((template) => !template.deliveryTagSignaturesPassed)
    .map((template) => template.templateId);
  const unknownAudioTagRefs = rawTemplates.flatMap((template) =>
    template.variants.flatMap((variant) => variant.delivery.unknownTags.length === 0 ? [] : [{
      templateId: template.templateId,
      variantIndex: variant.variantIndex,
      tags: variant.delivery.unknownTags,
    }])
  );
  const targets = {
    templateCount: rawTemplates.length === fixture.expectedTemplateCount,
    everyTemplateHasCopy: templatesMissingCopy.length === 0,
    fixedHooksUnique: fixedHooks.length === fixture.expectedFixedHookCount
      && new Set(fixedHooks.map((hook) => hook.normalized)).size === fixture.expectedFixedHookCount,
    totalHooksUnique: allHookRefs.length === fixture.expectedTotalHookCount
      && new Set(allHookRefs.map((hook) => hook.normalized)).size === fixture.expectedTotalHookCount,
    enoughUniqueSegmentSentences: new Set(segmentSentences).size >= fixture.minimumUniqueSegmentSentences,
    enoughUniqueNonHookSegmentSentences: new Set(nonHookSegmentSentences).size >= fixture.minimumUniqueNonHookSegmentSentences,
    count4HasNoDuplicates: count4FailureTemplateIds.length === 0,
    count4DemosAreUnique: count4DemoFailureTemplateIds.length === 0,
    ctasDoNotRepeatAcrossTemplates: crossTemplateCtaDuplicatePairs.length === 0,
    fixturesMatchBestFor: incompatibleFixtureTemplateIds.length === 0,
    bodiesNotNearDuplicate: nearDuplicateBodyPairs.length === 0,
    noSharedBodyBlocks: repeatedBodyBlocks.length === 0,
    noSpokenProductionJargon: productionJargonRefs.length === 0,
    noUnsupportedFactualClaims: unsupportedClaimRefs.length === 0,
    noSpokenCreativeAnalysis: creativeAnalysisRefs.length === 0,
    riskyEvidenceTemplatesStayNeutral: semanticRiskRefs.length === 0,
    noDanglingFragments: danglingFragmentRefs.length === 0,
    demoPriceMentionsWithinLimit: demosMentioningPriceRefs.length <= fixture.maximumDemoPriceMentions,
    genericProofPriceSkeletonWithinLimit: proofPriceRefs.length <= maximumProofPriceSkeletonCount,
    proofPriceSkeletonsNotShared: repeatedProofPriceSkeletons.length === 0,
    hookPriceMentionsWithinLimit: hooksMentioningPriceRefs.length <= fixture.maximumHookPriceMentions,
    fixedHookPriceMentionsWithinLimit: fixedHooksMentioningPriceRefs.length <= fixture.maximumFixedHookPriceMentions,
    noBannedBoilerplateHookStarters: bannedBoilerplateHookRefs.length === 0,
    sharedHookPrefixesWithinCap: sharedHookPrefixes.length === 0,
    noIntraHookSemanticEchoes: intraHookEchoRefs.length === 0,
    noMechanicalSpokenPhrases: mechanicalPhraseRefs.length === 0,
    deliveryTagsValid: deliveryFailureRefs.length === 0,
    deliveryTagInventoryComplete: missingDeliveryTags.length === 0,
    deliverySignaturesUnique: deliverySignatureFailureTemplateIds.length === 0,
    everyVoicedTemplateHasEmphasisCue: missingEmphasisCueTemplateIds.length === 0,
    everyVariantPassesValidation: validationFailureRefs.length === 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    fixture,
    templates: rawTemplates,
    nearDuplicateHookPairs,
    summary: {
      templateCount: rawTemplates.length,
      templatesWithCopy: rawTemplates.length - templatesMissingCopy.length,
      fixedHookCount: fixedHooks.length,
      uniqueFixedHookCount: new Set(fixedHooks.map((hook) => hook.normalized)).size,
      totalHookCount: allHookRefs.length,
      uniqueTotalHookCount: new Set(allHookRefs.map((hook) => hook.normalized)).size,
      totalSegmentSentenceCount: segmentSentences.length,
      uniqueSegmentSentenceCount: new Set(segmentSentences).size,
      totalNonHookSegmentSentenceCount: nonHookSegmentSentences.length,
      uniqueNonHookSegmentSentenceCount: new Set(nonHookSegmentSentences).size,
      uniqueDemoCount: new Set(demos).size,
      totalDemoCount: demoRefs.length,
      uniqueCtaCount: new Set(ctas).size,
      count4DuplicateFailures: count4FailureTemplateIds.length,
      count4DemoDuplicateFailures: count4DemoFailureTemplateIds.length,
      deliveryTagDistribution,
      missingDeliveryTags,
      deliverySignatureFailureTemplateIds,
      deliveryFailureVariants: deliveryFailureRefs.length,
      validationFailureVariants: validationFailureRefs.length,
      templatesMissingCopy,
      count4FailureTemplateIds,
      count4DemoFailureTemplateIds,
      crossTemplateCtaDuplicatePairs,
      incompatibleFixtureTemplateIds,
      nearDuplicateBodyPairs,
      sharedBodyBlocks: repeatedBodyBlocks,
      productionJargonRefs,
      unsupportedClaimRefs,
      creativeAnalysisRefs,
      semanticRiskRefs,
      danglingFragmentRefs,
      demosMentioningPriceCount: demosMentioningPriceRefs.length,
      demosMentioningPriceRefs,
      proofPriceSkeletonCount: proofPriceRefs.length,
      maximumProofPriceSkeletonCount,
      repeatedProofPriceSkeletons,
      emphasisCueCount,
      voicedTemplatesWithEmphasisCue: voicedTemplates.length - missingEmphasisCueTemplateIds.length,
      missingEmphasisCueTemplateIds,
      hooksMentioningPriceCount: hooksMentioningPriceRefs.length,
      hooksMentioningPriceRefs,
      fixedHooksMentioningPriceCount: fixedHooksMentioningPriceRefs.length,
      fixedHooksMentioningPriceRefs,
      bannedBoilerplateHookRefs,
      sharedHookPrefixes,
      intraHookEchoRefs,
      mechanicalPhraseRefs,
      deliveryFailureRefs,
      unknownAudioTagRefs,
      validationFailureRefs,
      targets,
      passed: Object.values(targets).every(Boolean),
    },
  };
}
