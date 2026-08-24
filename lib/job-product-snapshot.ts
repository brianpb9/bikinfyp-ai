export const JOB_PRODUCT_SNAPSHOT_VERSION = 2 as const;
export const TRUSTED_BRAND_SOURCE = "products.raw_meta.brand" as const;

export interface JobProductSnapshot {
  version: 1 | typeof JOB_PRODUCT_SNAPSHOT_VERSION;
  productName: string;
  category: string;
  /** Harga ProductInput pada saat job diterima; sumber bridge SA6 immutable. */
  priceIdr: number | null;
  trustedBrand: { source: typeof TRUSTED_BRAND_SOURCE; value: string | null };
  productVisualDesc: string | null;
  brandBrief: string | null;
  claims: string[];
}

export class UnsafeLegacyProductSnapshot extends Error {
  readonly code = "PRODUCT_SNAPSHOT_LEGACY_UNSAFE";
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseJobProductSnapshot(raw: string, options: { requirePrice?: boolean } = {}): JobProductSnapshot {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("PRODUCT_SNAPSHOT_INVALID: snapshot metadata produk bukan JSON sah."); }
  const x = value as Partial<JobProductSnapshot> | null;
  const versionValid = x?.version === 1 || x?.version === JOB_PRODUCT_SNAPSHOT_VERSION;
  const priceValid = x?.version === 1
    ? x.priceIdr === undefined
    : Number.isSafeInteger(x?.priceIdr) && Number(x?.priceIdr) >= 0;
  if (!x || !versionValid
      || typeof x.productName !== "string" || !x.productName.trim()
      || typeof x.category !== "string" || !x.category.trim()
      || !priceValid
      || !x.trustedBrand || x.trustedBrand.source !== TRUSTED_BRAND_SOURCE
      || !nullableString(x.trustedBrand.value)
      || !nullableString(x.productVisualDesc)
      || !nullableString(x.brandBrief)
      || !Array.isArray(x.claims) || !x.claims.every((claim) => typeof claim === "string")) {
    throw new Error("PRODUCT_SNAPSHOT_INVALID: bentuk snapshot metadata produk tidak sah.");
  }
  if (x.version === 1 && options.requirePrice) {
    throw new UnsafeLegacyProductSnapshot(
      "PRODUCT_SNAPSHOT_LEGACY_UNSAFE: Story Ads snapshot v1 tidak memiliki harga admission immutable."
    );
  }
  return {
    version: x.version as 1 | typeof JOB_PRODUCT_SNAPSHOT_VERSION,
    productName: x.productName,
    category: x.category,
    priceIdr: x.version === 1 ? null : Number(x.priceIdr),
    trustedBrand: { source: TRUSTED_BRAND_SOURCE, value: x.trustedBrand.value },
    productVisualDesc: x.productVisualDesc,
    brandBrief: x.brandBrief,
    claims: [...x.claims],
  };
}

export function trustedBrandFromRawMeta(raw: string | null | undefined): string | null {
  try {
    const parsed = JSON.parse(raw ?? "{}") as { brand?: unknown };
    const brand = typeof parsed.brand === "string" ? parsed.brand.trim() : "";
    return brand || null;
  } catch {
    return null;
  }
}

export function claimsFromRaw(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("PRODUCT_SNAPSHOT_SOURCE_INVALID: claims produk bukan JSON sah."); }
  if (!Array.isArray(value) || !value.every((claim) => typeof claim === "string")) {
    throw new Error("PRODUCT_SNAPSHOT_SOURCE_INVALID: claims produk wajib array string.");
  }
  return [...value];
}

/**
 * Build the canonical bytes written by a job-admission transaction.
 *
 * This deliberately accepts the database-shaped product row, so every real
 * admission path uses the same strict source rules instead of reconstructing
 * a subtly different snapshot.  The returned JSON has already passed the
 * runtime parser used by workers and A6.
 */
export function createJobProductSnapshotRaw(product: {
  name: string;
  category: string;
  price_idr: number;
  raw_meta?: string | null;
  product_visual_desc?: string | null;
  brand_brief?: string | null;
  claims?: string | null;
}): string {
  const snapshot = parseJobProductSnapshot(JSON.stringify({
    version: JOB_PRODUCT_SNAPSHOT_VERSION,
    productName: product.name,
    category: product.category,
    priceIdr: product.price_idr,
    trustedBrand: { source: TRUSTED_BRAND_SOURCE, value: trustedBrandFromRawMeta(product.raw_meta) },
    productVisualDesc: product.product_visual_desc ?? null,
    brandBrief: product.brand_brief ?? null,
    claims: claimsFromRaw(product.claims),
  }));
  return JSON.stringify(snapshot);
}

export async function loadOrCreateJobProductSnapshot(input: {
  existingRaw: string | null;
  /** Lazy form prevents mutable product columns from being parsed on resume. */
  candidate: Omit<JobProductSnapshot, "version" | "priceIdr"> & { priceIdr: number }
    | (() => Omit<JobProductSnapshot, "version" | "priceIdr"> & { priceIdr: number });
  persistIfAbsentAndSafe: (candidateRaw: string) => Promise<string | null>;
  /** Story Ads membutuhkan price immutable; Affiliate/TVC v1 tetap resumable. */
  requirePrice?: boolean;
}): Promise<JobProductSnapshot> {
  if (input.existingRaw) return parseJobProductSnapshot(input.existingRaw, { requirePrice: input.requirePrice });
  const source = typeof input.candidate === "function" ? input.candidate() : input.candidate;
  const candidate = parseJobProductSnapshot(JSON.stringify({ version: JOB_PRODUCT_SNAPSHOT_VERSION, ...source }));
  const persisted = await input.persistIfAbsentAndSafe(JSON.stringify(candidate));
  if (!persisted) {
    throw new UnsafeLegacyProductSnapshot(
      "PRODUCT_SNAPSHOT_LEGACY_UNSAFE: job lama sudah punya jejak provider/output tanpa snapshot metadata produk."
    );
  }
  return parseJobProductSnapshot(persisted, { requirePrice: input.requirePrice });
}
