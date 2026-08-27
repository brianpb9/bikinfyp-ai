import { ApiError } from "./errors";

export interface DeclaredProductTypeSource {
  kind: "DECLARED_PRODUCT_TYPE";
  sourceId: string;
  token: string;
  version: 1;
}

export interface HumanProductTypeConfirmation {
  kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION";
  token: string;
  actorId: string;
  confirmedAt: string;
  version: 1;
  provenance: "USER_SELF_ASSERTION";
}

export interface ProductTypeBoundaryInput {
  declaredToken: string;
  trustedSignal: TrustedProductTypeSource | null;
}

export const C5_CATEGORY_IDS = Object.freeze([
  "beauty", "health", "fashion", "muslim_fashion", "home", "kitchen", "gadget",
  "electronics", "food", "kids", "jasa", "app", "toko",
] as const);

export type CategoryReviewReason = "CATEGORY_UNKNOWN" | "CATEGORY_AMBIGUOUS" | "CATEGORY_BUNDLE";
export type StructuredCategoryOutcome = "KNOWN" | "UNKNOWN" | "AMBIGUOUS" | "BUNDLE";

export interface CategoryReviewRecord {
  state: "CLEAR" | "QUARANTINED";
  reason: CategoryReviewReason | null;
  reviewedBy: string | null;
  reviewedRole: string | null;
  reviewedAt: string | null;
  version: number;
}

export interface CategoryReviewRelease {
  actorId: string;
  actorRole: string;
  reviewedAt: string;
  reason: string;
  expectedVersion: number;
}

const CATEGORY_ID_SET = new Set<string>(C5_CATEGORY_IDS);

export function isCanonicalC5Category(value: unknown): boolean {
  return CATEGORY_ID_SET.has(normalizeToken(value));
}

export function requireCanonicalC5Category(value: unknown): string {
  const category=normalizeToken(value);
  if (!CATEGORY_ID_SET.has(category)) throw new ApiError(422, {
    code:"CATEGORY_REVIEW_RESOLUTION_INVALID",
    message_id:"Rilis kategori wajib memilih tepat satu kategori kanonik.",
    message_en:"Category release requires exactly one canonical resolved category.",retryable:false,
  });
  return category;
}

export function parseStructuredCategoryOutcome(value: unknown): StructuredCategoryOutcome {
  const outcome = typeof value === "string" ? value.trim().toUpperCase() : "KNOWN";
  if (outcome === "KNOWN" || outcome === "UNKNOWN" || outcome === "AMBIGUOUS" || outcome === "BUNDLE") return outcome;
  throw new ApiError(422, {
    code: "CATEGORY_REVIEW_OUTCOME_INVALID",
    message_id: "Hasil klasifikasi kategori tidak dikenal.",
    message_en: "Unknown structured category outcome.",
    retryable: false,
  });
}

/** C5 accepts a structured classifier outcome only. It never guesses from text. */
export function deriveCategoryReview(
  category: unknown,
  outcome: StructuredCategoryOutcome = "KNOWN",
): CategoryReviewRecord {
  const token = normalizeToken(category);
  let reason: CategoryReviewReason | null = null;
  if (outcome === "BUNDLE") reason = "CATEGORY_BUNDLE";
  else if (outcome === "AMBIGUOUS") reason = "CATEGORY_AMBIGUOUS";
  else if (outcome === "UNKNOWN" || token === "default" || !CATEGORY_ID_SET.has(token)) reason = "CATEGORY_UNKNOWN";
  return Object.freeze({
    state: reason ? "QUARANTINED" : "CLEAR",
    reason,
    reviewedBy: null,
    reviewedRole: null,
    reviewedAt: null,
    version: 1,
  });
}

/** URL extraction category guesses are heuristic evidence, never an
 * authoritative structured classification. A client-provided KNOWN flag
 * cannot upgrade this result; only manual non-heuristic intake or C5 release
 * can produce CLEAR. */
export function deriveHeuristicCategoryReview(category: unknown): CategoryReviewRecord {
  return deriveCategoryReview(category, "UNKNOWN");
}

export function effectiveCategoryReviewRole(input: {
  configuredRole: string;
  configuredPrincipalId: string;
  membershipRole: "owner" | "member";
  actorId: string;
}): { effectiveRole: string; membershipRole: "owner" | "member"; founderPrincipalId: string | null } {
  const principalId=input.configuredPrincipalId.trim() || null;
  const founderBound = input.configuredRole === "Founder/CEO"
    && input.membershipRole === "owner"
    && principalId === input.actorId;
  return Object.freeze({
    effectiveRole: founderBound ? "Founder/CEO" : input.membershipRole,
    membershipRole: input.membershipRole,
    founderPrincipalId: principalId,
  });
}

export function assertCategoryReviewClear(record: Partial<CategoryReviewRecord> | null | undefined, category?:unknown): void {
  if (record?.state !== "CLEAR" || record.reason !== null || !Number.isInteger(record.version) || Number(record.version) < 1
    || (category !== undefined && !isCanonicalC5Category(category))) {
    throw new ApiError(422, {
      code: "CATEGORY_REVIEW_REQUIRED",
      message_id: "Kategori produk perlu ditinjau manusia yang berwenang sebelum proses dilanjutkan.",
      message_en: "Authorized human category review is required before continuing.",
      retryable: false,
    });
  }
}

export function categoryReviewForMutation(
  current: Partial<CategoryReviewRecord> | null | undefined,
  category: unknown,
  outcome: StructuredCategoryOutcome,
  currentCategory?:unknown,
): CategoryReviewRecord {
  const candidate = deriveCategoryReview(category, outcome);
  const currentVersion = Number.isInteger(current?.version) && Number(current?.version) >= 1 ? Number(current?.version) : 1;
  if (candidate.state === "QUARANTINED") {
    if (current?.state === "QUARANTINED" && current.reason === candidate.reason) {
      return Object.freeze({state:"QUARANTINED",reason:candidate.reason,reviewedBy:null,reviewedRole:null,reviewedAt:null,version:currentVersion});
    }
    return Object.freeze({...candidate,version:currentVersion + 1});
  }
  // Ordinary edits and product-type self-confirmation never clear an existing C5 quarantine.
  if (current?.state === "QUARANTINED") {
    return Object.freeze({
      state:"QUARANTINED",
      reason:current.reason === "CATEGORY_AMBIGUOUS" || current.reason === "CATEGORY_BUNDLE" ? current.reason : "CATEGORY_UNKNOWN",
      reviewedBy:null,reviewedRole:null,reviewedAt:null,version:currentVersion,
    });
  }
  // A Founder release is bound to the reviewed canonical category. An
  // ordinary E3/E7 mutation cannot carry that provenance onto another value.
  if (current?.state === "CLEAR" && currentVersion >= 2
    && normalizeToken(category) !== normalizeToken(currentCategory)) {
    return Object.freeze({state:"QUARANTINED",reason:"CATEGORY_UNKNOWN",reviewedBy:null,
      reviewedRole:null,reviewedAt:null,version:currentVersion + 1});
  }
  return Object.freeze({state:"CLEAR",reason:null,reviewedBy:current?.reviewedBy ?? null,
    reviewedRole:current?.reviewedRole ?? null,reviewedAt:current?.reviewedAt ?? null,version:currentVersion});
}

/**
 * Produces the only legal C5 release transition. Persistence must compare-and-set
 * state=QUARANTINED and version=expectedVersion in the same transaction as its
 * append-only audit insert; ordinary product-type confirmation never calls this.
 */
export function authorizeCategoryReviewRelease(
  current: CategoryReviewRecord,
  release: CategoryReviewRelease,
  configuredRole = process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE ?? "",
): CategoryReviewRecord {
  const requiredRole = configuredRole.trim();
  if (requiredRole !== "Founder/CEO" || release.actorRole !== "Founder/CEO") {
    throw new ApiError(403, {
      code: "CATEGORY_REVIEW_ROLE_FORBIDDEN",
      message_id: "Peran peninjau kategori belum disetel atau tidak cocok.",
      message_en: "The authorized category-review role is missing or does not match.",
      retryable: false,
    });
  }
  if (current.state !== "QUARANTINED" || current.reason === null || release.expectedVersion !== current.version
    || !release.actorId.trim() || !release.reason.trim() || !isCanonicalTimestamp(release.reviewedAt)) {
    throw new ApiError(409, {
      code: "CATEGORY_REVIEW_RELEASE_CONFLICT",
      message_id: "Status tinjauan kategori berubah atau bukti rilis belum lengkap.",
      message_en: "Category-review state changed or release evidence is incomplete.",
      retryable: false,
    });
  }
  return Object.freeze({
    state: "CLEAR",
    reason: null,
    reviewedBy: release.actorId,
    reviewedRole: release.actorRole,
    reviewedAt: release.reviewedAt,
    version: current.version + 1,
  });
}

interface TrustedProductTypeSource {
  kind: "TRUSTED_TYPE_SOURCE";
  token: string;
  sourceId: string;
  actorId: string;
  confirmedAt: string;
  version: 1;
  provenance: "USER_SELF_ASSERTION";
}

const issuedConfirmations = new WeakSet<object>();

function normalizeToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLocaleLowerCase("und");
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function policyError(code: "TYPE_MISMATCH" | "PRODUCT_TYPE_CONFIRMATION_REQUIRED", messageId: string, messageEn: string): ApiError {
  return new ApiError(422, { code, message_id: messageId, message_en: messageEn, retryable: false });
}

export function buildAuthoritativeTypeBoundaryInput(
  declared: DeclaredProductTypeSource,
  confirmation: HumanProductTypeConfirmation | null,
): ProductTypeBoundaryInput {
  const declaredToken = normalizeToken(declared?.token);
  if (declared?.kind !== "DECLARED_PRODUCT_TYPE" || declared.version !== 1 || !declared.sourceId.trim() || !declaredToken) {
    throw policyError(
      "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
      "Jenis produk canonical belum lengkap. Isi jenis produk lalu konfirmasi lagi.",
      "A canonical product type declaration is required.",
    );
  }
  if (confirmation === null) return { declaredToken, trustedSignal: null };
  if (confirmation.kind !== "HUMAN_PRODUCT_TYPE_CONFIRMATION"
    || confirmation.version !== 1
    || confirmation.provenance !== "USER_SELF_ASSERTION"
    || !confirmation.actorId.trim()
    || !isCanonicalTimestamp(confirmation.confirmedAt)) {
    throw policyError(
      "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
      "Konfirmasi jenis produk belum sah. Konfirmasi ulang dengan akunmu.",
      "A valid authenticated product type confirmation is required.",
    );
  }
  const confirmedToken = normalizeToken(confirmation.token);
  if (!confirmedToken) {
    throw policyError(
      "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
      "Jenis produk yang dikonfirmasi masih kosong. Isi lalu konfirmasi lagi.",
      "The confirmed product type is empty.",
    );
  }
  const trusted: TrustedProductTypeSource = Object.freeze({
    kind: "TRUSTED_TYPE_SOURCE",
    token: confirmedToken,
    sourceId: `authenticated-user:${confirmation.actorId}`,
    actorId: confirmation.actorId,
    confirmedAt: confirmation.confirmedAt,
    version: 1,
    provenance: "USER_SELF_ASSERTION",
  });
  issuedConfirmations.add(trusted);
  return Object.freeze({ declaredToken, trustedSignal: trusted });
}

export async function validateAuthoritativeProductType<T>(
  input: ProductTypeBoundaryInput,
  onAdmit: () => T | Promise<T>,
): Promise<T> {
  if (!input.trustedSignal || !issuedConfirmations.has(input.trustedSignal)) {
    throw policyError(
      "PRODUCT_TYPE_CONFIRMATION_REQUIRED",
      "Jenis produk belum dikonfirmasi. Konfirmasi jenis produk sebelum lanjut.",
      "Product type confirmation is required before continuing.",
    );
  }
  if (input.declaredToken !== input.trustedSignal.token) {
    throw policyError(
      "TYPE_MISMATCH",
      "Jenis produk yang diisi tidak cocok dengan konfirmasi. Samakan keduanya sebelum lanjut.",
      "Declared and confirmed product types do not match.",
    );
  }
  return await onAdmit();
}
