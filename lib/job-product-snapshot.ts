export const JOB_PRODUCT_SNAPSHOT_VERSION = 1 as const;
export const TRUSTED_BRAND_SOURCE = "products.raw_meta.brand" as const;

export interface JobProductSnapshot {
  version: typeof JOB_PRODUCT_SNAPSHOT_VERSION;
  productName: string;
  category: string;
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

export function parseJobProductSnapshot(raw: string): JobProductSnapshot {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("PRODUCT_SNAPSHOT_INVALID: snapshot metadata produk bukan JSON sah."); }
  const x = value as Partial<JobProductSnapshot> | null;
  if (!x || x.version !== JOB_PRODUCT_SNAPSHOT_VERSION
      || typeof x.productName !== "string" || !x.productName.trim()
      || typeof x.category !== "string" || !x.category.trim()
      || !x.trustedBrand || x.trustedBrand.source !== TRUSTED_BRAND_SOURCE
      || !nullableString(x.trustedBrand.value)
      || !nullableString(x.productVisualDesc)
      || !nullableString(x.brandBrief)
      || !Array.isArray(x.claims) || !x.claims.every((claim) => typeof claim === "string")) {
    throw new Error("PRODUCT_SNAPSHOT_INVALID: bentuk snapshot metadata produk tidak sah.");
  }
  return {
    version: JOB_PRODUCT_SNAPSHOT_VERSION,
    productName: x.productName,
    category: x.category,
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

export async function loadOrCreateJobProductSnapshot(input: {
  existingRaw: string | null;
  /** Lazy form prevents mutable product columns from being parsed on resume. */
  candidate: Omit<JobProductSnapshot, "version"> | (() => Omit<JobProductSnapshot, "version">);
  persistIfAbsentAndSafe: (candidateRaw: string) => Promise<string | null>;
}): Promise<JobProductSnapshot> {
  if (input.existingRaw) return parseJobProductSnapshot(input.existingRaw);
  const source = typeof input.candidate === "function" ? input.candidate() : input.candidate;
  const candidate = parseJobProductSnapshot(JSON.stringify({ version: JOB_PRODUCT_SNAPSHOT_VERSION, ...source }));
  const persisted = await input.persistIfAbsentAndSafe(JSON.stringify(candidate));
  if (!persisted) {
    throw new UnsafeLegacyProductSnapshot(
      "PRODUCT_SNAPSHOT_LEGACY_UNSAFE: job lama sudah punya jejak provider/output tanpa snapshot metadata produk."
    );
  }
  return parseJobProductSnapshot(persisted);
}
