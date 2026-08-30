import crypto from "node:crypto";
import { mediaStorage } from "./storage";

export const STAGING_REFERENCE_RIGHTS_SCHEMA = "bikinfyp.staging-reference-rights/v1" as const;
export const stagingReferenceRightsRel = (rel: string) => `${rel}.rights.json`;
export const stagingReferenceRevocationRel = (rel: string) => `${stagingReferenceRightsRel(rel)}.revoked.json`;

type Declaration = {
  schema: typeof STAGING_REFERENCE_RIGHTS_SCHEMA;
  source_kind: "internally_created_synthetic";
  creation_tool: string;
  deterministic_source_sha256: string;
  prompt_sha256: string;
  negative_prompt_sha256: string;
  tool_terms_reference: string;
  tool_terms_sha256: string;
  tool_terms_accepted_at: string;
  no_external_image_inputs: true;
  no_third_party_logo_or_trade_dress: true;
  not_official_brand_source: true;
  rights_owner: string;
  rights_scope: "internal_staging_ai_and_derivatives_only";
  publication_permitted: false;
  term_ends_at: string;
  revocation_contact: string;
};

export type StagingReferenceRightsBinding = {
  receipt_key:string; receipt_sha256:string; reference_key:string; reference_sha256:string;
  scope:"internal_staging_ai_and_derivatives_only"; publication_permitted:false;
};

export type StagingReferenceRightsReceipt = Declaration & {
  receipt_id: string;
  issued_at: string;
  actor_principal_id: string;
  actor_role: "Founder/CEO";
  owning_user_id: string;
  owning_org_id: null;
  product_id: string;
  product_name: string;
  product_brand: string | null;
  upload_input_sha256: string;
  normalized_object: {
    storage_key: string;
    sha256: string;
    bytes: number;
    mime: "image/webp";
    version_id: null;
    version_id_status: "UNAVAILABLE_STORAGE_ABSTRACTION";
  };
  revocation: { storage_key:string; status_at_issuance:"NOT_REVOKED" };
};

const HEX64 = /^[0-9a-f]{64}$/;
const canonical = (value: unknown): unknown => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
    : value;
export const canonicalReferenceRightsJson = (value: unknown): string => JSON.stringify(canonical(value));
export const referenceRightsSha256 = (value: Buffer | string): string => crypto.createHash("sha256").update(value).digest("hex");

export function parseStagingReferenceRightsDeclaration(raw: unknown, actorId: string): Declaration | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (process.env.STAGING_INTERNAL_REFERENCE_INGESTION !== "1"
      || process.env.RACUN_DEPLOY_ENV !== "staging"
      || !process.env.RENDER_SERVICE_ID
      || process.env.RENDER_SERVICE_ID !== process.env.STAGING_INTERNAL_REFERENCE_SERVICE_ID) {
    throw new Error("STAGING_REFERENCE_RIGHTS_DISABLED");
  }
  if (process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE !== "Founder/CEO"
      || !process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID
      || actorId !== process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID) {
    throw new Error("STAGING_REFERENCE_RIGHTS_ACTOR_NOT_AUTHORIZED");
  }
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { throw new Error("STAGING_REFERENCE_RIGHTS_INVALID_JSON"); }
  }
  if (!value || typeof value !== "object") throw new Error("STAGING_REFERENCE_RIGHTS_INVALID");
  const d = value as Record<string, unknown>;
  const requiredText = ["creation_tool", "tool_terms_reference", "rights_owner", "revocation_contact"] as const;
  const requiredSha = ["deterministic_source_sha256", "prompt_sha256", "negative_prompt_sha256", "tool_terms_sha256"] as const;
  if (d.schema !== STAGING_REFERENCE_RIGHTS_SCHEMA || d.source_kind !== "internally_created_synthetic"
      || d.no_external_image_inputs !== true || d.no_third_party_logo_or_trade_dress !== true
      || d.not_official_brand_source !== true
      || d.rights_scope !== "internal_staging_ai_and_derivatives_only" || d.publication_permitted !== false
      || requiredText.some((key) => typeof d[key] !== "string" || !String(d[key]).trim())
      || requiredSha.some((key) => typeof d[key] !== "string" || !HEX64.test(String(d[key])))) {
    throw new Error("STAGING_REFERENCE_RIGHTS_INVALID");
  }
  for (const key of ["tool_terms_accepted_at", "term_ends_at"] as const) {
    if (typeof d[key] !== "string" || !Number.isFinite(Date.parse(d[key]))) throw new Error("STAGING_REFERENCE_RIGHTS_INVALID_TIME");
  }
  if (Date.parse(String(d.term_ends_at)) <= Date.now()) throw new Error("STAGING_REFERENCE_RIGHTS_EXPIRED");
  return d as Declaration;
}

export async function persistStagingReferenceRightsReceipt(input: {
  declaration: Declaration;
  actorId: string;
  productId: string;
  productName: string;
  productBrand: string | null;
  sourceBytes: Buffer;
  rel: string;
  now: string;
}): Promise<{ receipt: StagingReferenceRightsReceipt; storageKey: string; sha256: string }> {
  const issuedAtMs = Date.parse(input.now);
  const acceptedAtMs = Date.parse(input.declaration.tool_terms_accepted_at);
  const termEndsAtMs = Date.parse(input.declaration.term_ends_at);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(acceptedAtMs) || !Number.isFinite(termEndsAtMs)
      || acceptedAtMs > issuedAtMs || issuedAtMs >= termEndsAtMs) {
    throw new Error("STAGING_REFERENCE_RIGHTS_CHRONOLOGY_INVALID");
  }
  const stored = await mediaStorage().get(input.rel);
  if (!stored) throw new Error("STAGING_REFERENCE_OBJECT_MISSING");
  const sourceSha = referenceRightsSha256(input.sourceBytes);
  if (sourceSha !== input.declaration.deterministic_source_sha256) throw new Error("STAGING_REFERENCE_SOURCE_DIGEST_MISMATCH");
  const storageKey = stagingReferenceRightsRel(input.rel);
  const receipt: StagingReferenceRightsReceipt = {
    ...input.declaration,
    receipt_id: crypto.randomUUID(), issued_at: input.now,
    actor_principal_id: input.actorId, actor_role: "Founder/CEO",
    owning_user_id: input.actorId, owning_org_id: null,
    product_id: input.productId, product_name: input.productName, product_brand: input.productBrand,
    upload_input_sha256: sourceSha,
    normalized_object: {
      storage_key: input.rel, sha256: referenceRightsSha256(stored.body), bytes: stored.body.length,
      mime: "image/webp", version_id: null, version_id_status: "UNAVAILABLE_STORAGE_ABSTRACTION",
    },
    revocation:{storage_key:stagingReferenceRevocationRel(input.rel),status_at_issuance:"NOT_REVOKED"},
  };
  const body = canonicalReferenceRightsJson(receipt);
  await mediaStorage().put(storageKey, Buffer.from(body), "application/json");
  return { receipt, storageKey, sha256: referenceRightsSha256(body) };
}

export function stagingReferenceRightsBindingFromRawMeta(raw: string | null | undefined): StagingReferenceRightsBinding | null {
  let parsed:unknown;
  try { parsed=raw ? JSON.parse(raw) : {}; } catch { throw new Error("PRODUCT_RAW_META_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("PRODUCT_RAW_META_INVALID");
  const value=(parsed as Record<string,unknown>).staging_reference_rights;
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("STAGING_REFERENCE_RIGHTS_BINDING_INVALID");
  const b=value as Record<string,unknown>;
  if (typeof b.receipt_key !== "string" || !b.receipt_key.endsWith(".rights.json")
      || typeof b.reference_key !== "string" || !b.reference_key
      || typeof b.receipt_sha256 !== "string" || !HEX64.test(b.receipt_sha256)
      || typeof b.reference_sha256 !== "string" || !HEX64.test(b.reference_sha256)
      || b.scope !== "internal_staging_ai_and_derivatives_only" || b.publication_permitted !== false) {
    throw new Error("STAGING_REFERENCE_RIGHTS_BINDING_INVALID");
  }
  return b as StagingReferenceRightsBinding;
}

export async function verifyStagingReferenceRightsBinding(input:{
  binding:StagingReferenceRightsBinding; referenceRel:string; now:string;
}):Promise<StagingReferenceRightsReceipt> {
  if (process.env.RACUN_DEPLOY_ENV !== "staging") throw new Error("STAGING_REFERENCE_RIGHTS_ENV_INVALID");
  if (input.binding.reference_key !== input.referenceRel
      || input.binding.receipt_key !== stagingReferenceRightsRel(input.referenceRel)) throw new Error("STAGING_REFERENCE_RIGHTS_KEY_MISMATCH");
  const object=await mediaStorage().get(input.binding.receipt_key);
  if (!object) throw new Error("STAGING_REFERENCE_RIGHTS_RECEIPT_MISSING");
  const raw=object.body.toString("utf8");
  if (referenceRightsSha256(raw) !== input.binding.receipt_sha256) throw new Error("STAGING_REFERENCE_RIGHTS_RECEIPT_TAMPERED");
  let receipt:unknown;
  try { receipt=JSON.parse(raw); } catch { throw new Error("STAGING_REFERENCE_RIGHTS_RECEIPT_INVALID"); }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || canonicalReferenceRightsJson(receipt) !== raw) throw new Error("STAGING_REFERENCE_RIGHTS_RECEIPT_INVALID");
  const r=receipt as StagingReferenceRightsReceipt;
  const nowMs=Date.parse(input.now),issuedMs=Date.parse(r.issued_at),acceptedMs=Date.parse(r.tool_terms_accepted_at),termMs=Date.parse(r.term_ends_at);
  if (r.schema !== STAGING_REFERENCE_RIGHTS_SCHEMA || r.source_kind !== "internally_created_synthetic"
      || r.rights_scope !== input.binding.scope || r.publication_permitted !== false
      || r.normalized_object?.storage_key !== input.referenceRel
      || r.normalized_object?.sha256 !== input.binding.reference_sha256
      || r.revocation?.storage_key !== stagingReferenceRevocationRel(input.referenceRel)
      || r.revocation?.status_at_issuance !== "NOT_REVOKED"
      || !Number.isFinite(nowMs) || !Number.isFinite(issuedMs) || !Number.isFinite(acceptedMs) || !Number.isFinite(termMs)
      || acceptedMs > issuedMs || issuedMs >= termMs || nowMs >= termMs) throw new Error("STAGING_REFERENCE_RIGHTS_RECEIPT_INVALID_OR_EXPIRED");
  if (await mediaStorage().get(stagingReferenceRevocationRel(input.referenceRel))) throw new Error("STAGING_REFERENCE_RIGHTS_REVOKED");
  const stored=await mediaStorage().get(input.referenceRel);
  if (!stored || referenceRightsSha256(stored.body) !== input.binding.reference_sha256
      || stored.body.length !== r.normalized_object.bytes) throw new Error("STAGING_REFERENCE_RIGHTS_OBJECT_MISMATCH");
  return r;
}
