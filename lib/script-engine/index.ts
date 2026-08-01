// Mesin skrip (FSD F-02): hasilkan 3 varian skrip 15 dtk dari 3 keluarga hook berbeda.
// Deterministik berbasis template; LLM opsional via LLM_API_KEY (fallback template bila kosong).

import {
  CATEGORY_HOOK_PRIORITY, CATEGORY_NOUN, CATEGORY_PAIN, CATEGORY_PROOF,
  HOOK_BY_CODE, type HookCode,
} from "../config/hooks";
import { COMPLIANCE_CHECKLIST } from "../config/compliance";
import { REGISTERS, type Register } from "./registers";
import { renderSegmentsForTier, formatHargaNatural, type SegmentDraft, type TemplateCtx } from "./templates";
import { validateScript, type ValidationResult } from "./validator";
import { buildCaption, buildHashtags, suggestedPostTime } from "./caption";
import { getDb } from "../db";

export interface ProductInput {
  id: string;
  name: string;
  price_idr: number;
  category: string;
}

export interface GeneratedScript {
  hook_family: HookCode;
  emotion: string;
  register: Register;
  quality_tier: "silent_caption" | "high_quality" | "super_hq";
  segments: SegmentDraft[];
  caption: string;
  hashtags: string[];
  validation: ValidationResult;
}

const MAX_REGEN = 2; // FSD F-02.3: regenerate maksimal 2x

const CATEGORY_SPACE: Record<string, string> = {
  beauty: "Meja skincare", fashion: "Isi lemari", muslim_fashion: "Isi lemari",
  home: "Dapur", kitchen: "Dapur", gadget: "Meja kerja", food: "Stok cemilan",
  kids: "Ruang main", default: "Rumah",
};
const CATEGORY_AKTIVITAS: Record<string, string> = {
  beauty: "skincare-an malem", fashion: "mix and match baju", muslim_fashion: "styling hijab",
  home: "beres-beres rumah", kitchen: "masak tiap hari", gadget: "ganti-ganti aksesori hp",
  food: "jajan online", kids: "belanja kebutuhan anak", default: "belanja online",
};
const CATEGORY_IDENTITAS: Record<string, string> = {
  beauty: "tim glowing", fashion: "anak ootd", muslim_fashion: "anak hijab",
  home: "tim rumah rapi", kitchen: "tim masak rumahan", gadget: "anak gadget",
  food: "anak jajan", kids: "bunda kekinian", default: "anak tiktok",
};

function pick(category: string, table: Record<string, string>): string {
  return table[category] ?? table.default;
}

/** Pilih 3 keluarga hook berbeda; keluarga yang dipakai produk sama <7 hari diturunkan (F-02.2 #3). */
export function pickHookFamilies(category: string, productId: string): HookCode[] {
  const priority = CATEGORY_HOOK_PRIORITY[category] ?? CATEGORY_HOOK_PRIORITY.default;
  let recent: string[] = [];
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    recent = (
      getDb()
        .prepare("SELECT DISTINCT hook_family FROM scripts WHERE product_id = ? AND created_at > ?")
        .all(productId, since) as { hook_family: string }[]
    ).map((r) => r.hook_family);
  } catch {
    /* DB belum siap (tes unit murni) — abaikan deprioritasi */
  }
  const fresh = priority.filter((h) => !recent.includes(h));
  const ordered = [...fresh, ...priority.filter((h) => recent.includes(h))];
  const chosen: HookCode[] = [];
  for (const h of ordered) {
    if (chosen.length >= 3) break;
    if (!chosen.includes(h)) chosen.push(h);
  }
  return chosen;
}

function buildCtx(product: ProductInput, register: Register): TemplateCtx {
  const cat = product.category;
  return {
    reg: REGISTERS[register],
    harga: formatHargaNatural(product.price_idr),
    produk: product.name,
    noun: pick(cat, CATEGORY_NOUN),
    pain: pick(cat, CATEGORY_PAIN),
    proof: pick(cat, CATEGORY_PROOF),
    space: pick(cat, CATEGORY_SPACE),
    aktivitas: pick(cat, CATEGORY_AKTIVITAS),
    identitas: pick(cat, CATEGORY_IDENTITAS),
  };
}

function generateOne(
  product: ProductInput,
  register: Register,
  emotion: string,
  family: HookCode,
  tier: "silent_caption" | "high_quality" | "super_hq"
): GeneratedScript {
  const ctx = buildCtx(product, register);
  let segments = renderSegmentsForTier(family, ctx, tier);
  let validation = validateScript(
    { hook_family: family, register, segments, productName: product.name, priceIdr: product.price_idr, qualityTier: tier },
    "strict"
  );
  // Regenerate maks 2x bila gagal (FSD F-02.3). Template kami deterministik, jadi
  // "regenerate" = normalisasi teks; bila tetap gagal, bagian bermasalah ditandai
  // di validation_result dan skrip tetap dikembalikan untuk diperbaiki pengguna.
  for (let attempt = 0; attempt < MAX_REGEN && !validation.passed; attempt++) {
    segments = normalizeSegments(segments);
    validation = validateScript(
      { hook_family: family, register, segments, productName: product.name, priceIdr: product.price_idr, qualityTier: tier },
      "strict"
    );
  }
  const reg = REGISTERS[register];
  return {
    hook_family: family,
    emotion,
    register,
    quality_tier: tier,
    segments,
    caption: buildCaption({ produk: product.name, proof: ctx.proof, reg }),
    hashtags: buildHashtags(product.category),
    validation,
  };
}

/** Normalisasi ringan antar-attempt: rapikan spasi/tanda baca ganda. */
function normalizeSegments(segments: SegmentDraft[]): SegmentDraft[] {
  return segments.map((s) => ({
    ...s,
    text: s.text.replace(/\s{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim(),
  }));
}

/** Generator utama: 3 varian, masing-masing beda keluarga hook. */
export function generateScripts(opts: {
  product: ProductInput;
  register: Register;
  emotion?: string;
  qualityTier?: "silent_caption" | "high_quality" | "super_hq";
}): GeneratedScript[] {
  const { product, register } = opts;
  const emotion = opts.emotion ?? "senang";
  const tier = opts.qualityTier ?? "silent_caption";
  const families = pickHookFamilies(product.category, product.id);
  return families.map((f) => generateOne(product, register, emotion, f, tier));
}

export function outputExtras(category: string) {
  return { suggested_post_time: suggestedPostTime(category), compliance_checklist: COMPLIANCE_CHECKLIST };
}

export { HOOK_BY_CODE };
