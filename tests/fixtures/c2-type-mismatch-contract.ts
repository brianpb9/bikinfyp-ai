/**
 * TEST-ONLY reference contract for C2 discovery.
 *
 * These opaque tokens deliberately do not define a product taxonomy. A future
 * policy owner must supply both the authoritative token and its provenance.
 * Engineering may only compare those supplied values at the boundary.
 */
export type TrustedTypeSignal = {
  token: string;
  provenance: string;
};

export type DeclaredTypeSource = {
  kind: "DECLARED_TYPE_SOURCE";
  sourceId: string;
  token: string;
};

export type TrustedTypeSource = {
  kind: "TRUSTED_TYPE_SOURCE";
  sourceId: string;
  token: string;
  provenance: string;
};

export type TypeBoundaryInput = {
  declaredToken: string;
  trustedSignal: TrustedTypeSignal | null;
};

export type TypeBoundaryDecision = "ADMIT" | "REJECT_MISMATCH" | "UNDETERMINED_POLICY_INPUT";

export function buildReferenceBoundaryInput(
  declared: DeclaredTypeSource,
  trusted: TrustedTypeSource | null,
): TypeBoundaryInput {
  if (trusted && declared.sourceId === trusted.sourceId) {
    throw new Error("C2_SOURCE_ALIAS: declared and trusted values must come from independent sources");
  }
  return {
    declaredToken: declared.token,
    trustedSignal: trusted ? { token: trusted.token, provenance: trusted.provenance } : null,
  };
}

export function referenceDecision(input: TypeBoundaryInput): TypeBoundaryDecision {
  if (!input.trustedSignal?.token.trim() || !input.trustedSignal.provenance.trim()) {
    return "UNDETERMINED_POLICY_INPUT";
  }
  return input.declaredToken.trim() === input.trustedSignal.token.trim()
    ? "ADMIT"
    : "REJECT_MISMATCH";
}

/** Mutation controls: neither function is production behavior. */
export const acceptEverythingMutation = (_input: TypeBoundaryInput): TypeBoundaryDecision => "ADMIT";
export const rejectEverythingMutation = (_input: TypeBoundaryInput): TypeBoundaryDecision => "REJECT_MISMATCH";
