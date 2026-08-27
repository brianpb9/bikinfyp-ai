import { ApiError } from "./errors";
import {
  parseJobProductSnapshot,
  UnsafeLegacyProductSnapshot,
  JOB_PRODUCT_SNAPSHOT_VERSION,
  type JobProductSnapshot,
} from "./job-product-snapshot";
import {
  parseJobReferenceManifest,
  UnsafeLegacyReferenceSnapshot,
  REFERENCE_MANIFEST_VERSION,
  type JobReferenceManifest,
} from "./job-reference-manifest";
import { isCanonicalC5Category } from "./product-type-boundary";

export type LegacyJobQuarantineReason =
  | "REFERENCE_MANIFEST_MISSING"
  | "REFERENCE_MANIFEST_MALFORMED"
  | "REFERENCE_MANIFEST_UNSUPPORTED_VERSION"
  | "REFERENCE_MANIFEST_INVALID_OCR_OR_HASH"
  | "PRODUCT_SNAPSHOT_MISSING"
  | "PRODUCT_SNAPSHOT_MALFORMED"
  | "PRODUCT_SNAPSHOT_UNSUPPORTED_VERSION"
  | "PRODUCT_TYPE_QUARANTINED"
  | "CATEGORY_REVIEW_QUARANTINED"
  | "CATEGORY_REVIEW_GENERATION_MISMATCH";

export type ProductTypeProvenance = {
  category?: string | null;
  product_type_token?: string | null;
  product_type_confirmed_token?: string | null;
  product_type_confirmed_by?: string | null;
  product_type_confirmed_at?: string | Date | null;
  product_type_version?: number | null;
  product_type_state?: string | null;
  category_review_state?: string | null;
  category_review_reason?: string | null;
  category_reviewed_by?: string | null;
  category_reviewed_role?: string | null;
  category_reviewed_at?: string | Date | null;
  category_review_version?: number | null;
};

export type LegacyJobEvidenceClassification =
  | {
      status: "CURRENT";
      manifest: JobReferenceManifest;
      productSnapshot: JobProductSnapshot;
    }
  | {
      status: "QUARANTINED";
      reason: LegacyJobQuarantineReason;
    };

export const LEGACY_REFERENCE_REASON =
  "REF_MANIFEST_LEGACY_UNSAFE: job tidak memiliki manifest referensi current yang dapat diverifikasi; worker gagal tertutup.";
export const LEGACY_PRODUCT_REASON =
  "PRODUCT_SNAPSHOT_LEGACY_UNSAFE: job tanpa snapshot promo v3 tidak boleh memakai row produk mutable.";

function jsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function canonicalTypeState(value: ProductTypeProvenance): boolean {
  const declared = value.product_type_token?.normalize("NFKC").trim().toLocaleLowerCase("und") ?? "";
  const confirmed = value.product_type_confirmed_token?.normalize("NFKC").trim().toLocaleLowerCase("und") ?? "";
  const actor = value.product_type_confirmed_by?.trim() ?? "";
  const rawAt = value.product_type_confirmed_at;
  const parsedAt = rawAt instanceof Date ? rawAt : new Date(rawAt ?? Number.NaN);
  const canonicalAt = Number.isFinite(parsedAt.getTime())
    && (rawAt instanceof Date || parsedAt.toISOString() === rawAt);
  return value.product_type_state === "CONFIRMED"
    && value.product_type_version === 1
    && Boolean(declared && confirmed && actor && canonicalAt)
    && declared === confirmed;
}

/**
 * Pure, read-only classification of the immutable evidence required by a
 * current job. It never reads products, storage, a database, or the network,
 * and therefore cannot turn legacy rows into current rows as a side effect.
 */
export function classifyLegacyJobEvidence(input: {
  approvedReferenceManifest: string | null | undefined;
  jobProductSnapshot: string | null | undefined;
  productType?: ProductTypeProvenance | null;
}): LegacyJobEvidenceClassification {
  if (!input.approvedReferenceManifest) {
    return { status: "QUARANTINED", reason: "REFERENCE_MANIFEST_MISSING" };
  }
  const manifestValue = jsonObject(input.approvedReferenceManifest);
  if (!manifestValue) {
    return { status: "QUARANTINED", reason: "REFERENCE_MANIFEST_MALFORMED" };
  }
  if (manifestValue.version !== REFERENCE_MANIFEST_VERSION) {
    return { status: "QUARANTINED", reason: "REFERENCE_MANIFEST_UNSUPPORTED_VERSION" };
  }
  let manifest: JobReferenceManifest;
  try {
    manifest = parseJobReferenceManifest(input.approvedReferenceManifest);
  } catch {
    const refs = Array.isArray(manifestValue.references) ? manifestValue.references : [];
    const invalidOcrOrHash = refs.some((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const ref = entry as Record<string, unknown>;
      return ref.labelOcrStatus !== "READABLE"
        || ref.labelOcrVersion !== 1
        || typeof ref.sha256 !== "string"
        || !/^[0-9a-f]{64}$/.test(ref.sha256);
    });
    return {
      status: "QUARANTINED",
      reason: invalidOcrOrHash
        ? "REFERENCE_MANIFEST_INVALID_OCR_OR_HASH"
        : "REFERENCE_MANIFEST_MALFORMED",
    };
  }

  if (!input.jobProductSnapshot) {
    return { status: "QUARANTINED", reason: "PRODUCT_SNAPSHOT_MISSING" };
  }
  const snapshotValue = jsonObject(input.jobProductSnapshot);
  if (!snapshotValue) {
    return { status: "QUARANTINED", reason: "PRODUCT_SNAPSHOT_MALFORMED" };
  }
  if (snapshotValue.version !== JOB_PRODUCT_SNAPSHOT_VERSION) {
    return { status: "QUARANTINED", reason: "PRODUCT_SNAPSHOT_UNSUPPORTED_VERSION" };
  }
  let productSnapshot: JobProductSnapshot;
  try {
    productSnapshot = parseJobProductSnapshot(input.jobProductSnapshot, { requirePromo: true });
  } catch {
    return { status: "QUARANTINED", reason: "PRODUCT_SNAPSHOT_MALFORMED" };
  }

  if (input.productType !== undefined && (!input.productType || !canonicalTypeState(input.productType))) {
    return { status: "QUARANTINED", reason: "PRODUCT_TYPE_QUARANTINED" };
  }
  if (input.productType !== undefined && (input.productType?.category_review_state !== "CLEAR"
    || !isCanonicalC5Category(productSnapshot.category))) {
    return { status: "QUARANTINED", reason: "CATEGORY_REVIEW_QUARANTINED" };
  }
  if (input.productType !== undefined && (
    productSnapshot.category !== input.productType?.category
    || productSnapshot.categoryReviewVersion !== input.productType?.category_review_version
  )) {
    return { status: "QUARANTINED", reason: "CATEGORY_REVIEW_GENERATION_MISMATCH" };
  }
  return { status: "CURRENT", manifest, productSnapshot };
}

/** Preserve the existing public/runtime errors while sharing one classifier. */
export function requireCurrentJobEvidence(input: Parameters<typeof classifyLegacyJobEvidence>[0]): {
  manifest: JobReferenceManifest;
  productSnapshot: JobProductSnapshot;
} {
  const result = classifyLegacyJobEvidence(input);
  if (result.status === "CURRENT") return result;
  switch (result.reason) {
    case "REFERENCE_MANIFEST_MISSING":
    case "REFERENCE_MANIFEST_UNSUPPORTED_VERSION":
      throw new UnsafeLegacyReferenceSnapshot(LEGACY_REFERENCE_REASON);
    case "REFERENCE_MANIFEST_MALFORMED":
    case "REFERENCE_MANIFEST_INVALID_OCR_OR_HASH":
      return { // parse again only to retain canonical OCR/manifest error semantics
        manifest: parseJobReferenceManifest(input.approvedReferenceManifest ?? ""),
        productSnapshot: parseJobProductSnapshot(input.jobProductSnapshot ?? "", { requirePromo: true }),
      };
    case "PRODUCT_SNAPSHOT_MISSING":
    case "PRODUCT_SNAPSHOT_UNSUPPORTED_VERSION":
      throw new UnsafeLegacyProductSnapshot(LEGACY_PRODUCT_REASON);
    case "PRODUCT_SNAPSHOT_MALFORMED":
      return {
        manifest: parseJobReferenceManifest(input.approvedReferenceManifest ?? ""),
        productSnapshot: parseJobProductSnapshot(input.jobProductSnapshot ?? "", { requirePromo: true }),
      };
    case "PRODUCT_TYPE_QUARANTINED":
      throw new ApiError(422, {
        code: "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
        message_id: "Jenis produk belum dikonfirmasi. Konfirmasi jenis produk sebelum lanjut.",
        message_en: "Product type confirmation is required before continuing.",
        retryable: false,
      });
    case "CATEGORY_REVIEW_QUARANTINED":
    case "CATEGORY_REVIEW_GENERATION_MISMATCH":
      throw new ApiError(422, {
        code: "CATEGORY_REVIEW_REQUIRED",
        message_id: "Kategori produk masih dikarantina dan perlu rilis peninjau manusia berwenang.",
        message_en: "Product category remains quarantined pending authorized human review.",
        retryable: false,
      });
  }
}
