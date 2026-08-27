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
    || !Number.isFinite(Date.parse(confirmation.confirmedAt))) {
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
    confirmedAt: new Date(confirmation.confirmedAt).toISOString(),
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
