import crypto from "node:crypto";

export const INTERNAL_PAYMENT_CANARY = Object.freeze({
  id: "production-payment-canary-v1",
  amountIdr: 10_000,
  entitlement: "INTERNAL_SETTLEMENT_PROOF_ONLY_NO_CUSTOMER_CREDITS",
  environment: "production" as const,
});

export type PaymentCanaryPinnedInput = {
  actorId: string;
  configuredTesterId: string;
  paymentMethod: string;
  configuredPaymentMethod: string;
  amountIdr: number;
  environment: "production" | "sandbox";
  prerequisites: {
    merchantReady: boolean;
    merchantReadinessSource: string;
    channelMinimumIdr: number;
    channelMinimumSource: string;
    settlementClass: string;
    settlementWindow: string;
    settlementSource: string;
    sourceBundleSha256: string;
    sourceEffectiveAt: string;
    sourceExpiresAt: string;
    authorityEvidence: {
      sourceBundleBase64: string;
      approvalReceiptBase64: string;
      approvalSignatureBase64: string;
      approvalKeyId: string;
    };
    approval: {
      approverIdentity: string;
      approvalReference: string;
      approvalReceiptSha256: string;
      effectiveAt: string;
      expiresAt: string;
      approvedLossCapIdr: number;
    };
    economics: {
      cogsIdr: number; feeIdr: number; taxIdr: number; netIdr: number; marginIdr: number;
      cogsSource: string; feeSource: string; taxSource: string;
    };
  };
};

export type PaymentCanaryReservation = PaymentCanaryPinnedInput & {
  canaryId: string; entitlement: string; prerequisiteReceiptSha256: string;
};

export type PaymentCanaryDeps = {
  /** Atomic durable singleton reservation; false means an issuance already exists. */
  reserveSingleton: (input: PaymentCanaryReservation) => Promise<boolean>;
  createInvoice: (input: {
    canaryId: string; amountIdr: number; paymentMethod: string; environment: "production";
  }) => Promise<{ providerRef: string; redirectUrl: string }>;
  markIssued: (input: { canaryId: string; providerRef: string; expectedState: "RESERVED" }) => Promise<void>;
  /** Ambiguous transport/provider outcomes are durable HOLD and never retried. */
  markHoldNoRetry: (input: {
    canaryId: string; reason: string; providerRef?: string;
    expectedStates: readonly ("RESERVED" | "ISSUED")[];
  }) => Promise<void>;
  now: () => Date;
  loadTrustedFounderAuthority: () => Promise<{
    keyId: string; approverIdentity: "Founder/CEO"; publicKeyPem: string;
  }>;
};

export class PaymentCanaryDenied extends Error {}

function requiredSource(value: string, code: string): string {
  const source=value.trim();
  if (!/^(https:\/\/|evidence:\/\/)[^\s]+$/.test(source)) throw new PaymentCanaryDenied(code);
  return source;
}

function requiredSha256(value: string, code: string): string {
  const hash=value.trim();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new PaymentCanaryDenied(code);
  return hash;
}

function requiredTime(value: string, code: string): number {
  const parsed=Date.parse(value);
  if (!Number.isFinite(parsed)) throw new PaymentCanaryDenied(code);
  return parsed;
}

function strictBase64(value:string,code:string):Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value) {
    throw new PaymentCanaryDenied(code);
  }
  return Buffer.from(value,"base64");
}

export async function runProductionPaymentCanary(input: PaymentCanaryPinnedInput, deps: PaymentCanaryDeps) {
  if (!input.configuredTesterId || input.actorId !== input.configuredTesterId) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_TESTER_DENIED");
  }
  if (input.environment !== INTERNAL_PAYMENT_CANARY.environment) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_PRODUCTION_ONLY");
  }
  if (input.amountIdr !== INTERNAL_PAYMENT_CANARY.amountIdr) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_AMOUNT_MISMATCH");
  }
  const paymentMethod = input.paymentMethod.trim();
  if (!paymentMethod) throw new PaymentCanaryDenied("PAYMENT_CANARY_METHOD_REQUIRED");
  if (!input.configuredPaymentMethod.trim() || paymentMethod !== input.configuredPaymentMethod.trim()) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_METHOD_NOT_PINNED");
  }
  const p=input.prerequisites;
  if (!p.merchantReady) throw new PaymentCanaryDenied("PAYMENT_CANARY_MERCHANT_NOT_READY");
  if (!Number.isInteger(p.channelMinimumIdr) || p.channelMinimumIdr <= 0
      || p.channelMinimumIdr > INTERNAL_PAYMENT_CANARY.amountIdr) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_CHANNEL_MINIMUM_INVALID");
  }
  const sources={
    merchantReadinessSource:requiredSource(p.merchantReadinessSource,"PAYMENT_CANARY_MERCHANT_SOURCE_MISSING"),
    channelMinimumSource:requiredSource(p.channelMinimumSource,"PAYMENT_CANARY_MINIMUM_SOURCE_MISSING"),
    settlementSource:requiredSource(p.settlementSource,"PAYMENT_CANARY_SETTLEMENT_SOURCE_MISSING"),
    cogsSource:requiredSource(p.economics.cogsSource,"PAYMENT_CANARY_COGS_SOURCE_MISSING"),
    feeSource:requiredSource(p.economics.feeSource,"PAYMENT_CANARY_FEE_SOURCE_MISSING"),
    taxSource:requiredSource(p.economics.taxSource,"PAYMENT_CANARY_TAX_SOURCE_MISSING"),
    sourceBundleSha256:requiredSha256(p.sourceBundleSha256,"PAYMENT_CANARY_SOURCE_BUNDLE_UNVERIFIABLE"),
  };
  if (!p.settlementClass.trim() || !p.settlementWindow.trim()) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_SETTLEMENT_CONTRACT_MISSING");
  }
  const e=p.economics;
  if (![e.cogsIdr,e.feeIdr,e.taxIdr,e.netIdr,e.marginIdr].every(Number.isInteger)
      || [e.cogsIdr,e.feeIdr,e.taxIdr].some((value)=>value<0)
      || e.netIdr !== input.amountIdr-e.feeIdr-e.taxIdr || e.marginIdr !== e.netIdr-e.cogsIdr) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_ECONOMICS_INVALID");
  }
  const approval=p.approval;
  const evidence=p.authorityEvidence;
  const sourceBundleBytes=strictBase64(evidence.sourceBundleBase64,"PAYMENT_CANARY_SOURCE_BUNDLE_INVALID");
  const approvalReceiptBytes=strictBase64(evidence.approvalReceiptBase64,"PAYMENT_CANARY_APPROVAL_RECEIPT_INVALID");
  const approvalSignature=strictBase64(evidence.approvalSignatureBase64,"PAYMENT_CANARY_APPROVAL_SIGNATURE_INVALID");
  if (crypto.createHash("sha256").update(sourceBundleBytes).digest("hex")!==sources.sourceBundleSha256
      || crypto.createHash("sha256").update(approvalReceiptBytes).digest("hex")!==approval.approvalReceiptSha256) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_EVIDENCE_DIGEST_MISMATCH");
  }
  const trusted=await deps.loadTrustedFounderAuthority();
  if (trusted.keyId!==evidence.approvalKeyId || trusted.approverIdentity!=="Founder/CEO"
      || !crypto.verify(null,approvalReceiptBytes,trusted.publicKeyPem,approvalSignature)) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_FOUNDER_SIGNATURE_INVALID");
  }
  const approverIdentity=approval.approverIdentity.trim();
  if (approverIdentity !== "Founder/CEO") throw new PaymentCanaryDenied("PAYMENT_CANARY_APPROVER_NOT_AUTHORIZED");
  const approvalReference=requiredSource(approval.approvalReference,"PAYMENT_CANARY_APPROVAL_REFERENCE_UNVERIFIABLE");
  const approvalReceiptSha256=requiredSha256(approval.approvalReceiptSha256,"PAYMENT_CANARY_APPROVAL_RECEIPT_UNVERIFIABLE");
  const nowMs=deps.now().getTime();
  const sourceEffectiveAt=requiredTime(p.sourceEffectiveAt,"PAYMENT_CANARY_SOURCE_EFFECTIVE_TIME_INVALID");
  const sourceExpiresAt=requiredTime(p.sourceExpiresAt,"PAYMENT_CANARY_SOURCE_EXPIRY_INVALID");
  const approvalEffectiveAt=requiredTime(approval.effectiveAt,"PAYMENT_CANARY_APPROVAL_EFFECTIVE_TIME_INVALID");
  const approvalExpiresAt=requiredTime(approval.expiresAt,"PAYMENT_CANARY_APPROVAL_EXPIRY_INVALID");
  if (!Number.isFinite(nowMs) || sourceEffectiveAt>nowMs || sourceExpiresAt<nowMs || sourceExpiresAt<=sourceEffectiveAt
      || approvalEffectiveAt>nowMs || approvalExpiresAt<nowMs
      || approvalExpiresAt<=approvalEffectiveAt) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_APPROVAL_NOT_CURRENT");
  }
  if (!Number.isInteger(approval.approvedLossCapIdr) || approval.approvedLossCapIdr<0
      || approval.approvedLossCapIdr>50_000 || Math.max(0,-e.marginIdr)>approval.approvedLossCapIdr) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_APPROVED_LOSS_CAP_EXCEEDED");
  }
  let sourceBundle:unknown, signedApproval:unknown;
  try { sourceBundle=JSON.parse(sourceBundleBytes.toString("utf8")); signedApproval=JSON.parse(approvalReceiptBytes.toString("utf8")); }
  catch { throw new PaymentCanaryDenied("PAYMENT_CANARY_SIGNED_EVIDENCE_JSON_INVALID"); }
  const expectedSourceBundle={schema:"payment-canary-source-bundle/v1",canaryId:INTERNAL_PAYMENT_CANARY.id,
    amountIdr:input.amountIdr,paymentMethod,merchantReady:p.merchantReady,channelMinimumIdr:p.channelMinimumIdr,
    settlementClass:p.settlementClass.trim(),settlementWindow:p.settlementWindow.trim(),
    merchantReadinessSource:sources.merchantReadinessSource,
    channelMinimumSource:sources.channelMinimumSource,settlementSource:sources.settlementSource,
    cogsSource:sources.cogsSource,feeSource:sources.feeSource,taxSource:sources.taxSource,
    effectiveAt:p.sourceEffectiveAt,expiresAt:p.sourceExpiresAt,economics:p.economics};
  if (JSON.stringify(sourceBundle)!==JSON.stringify(expectedSourceBundle)) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_SOURCE_BUNDLE_CONTENT_MISMATCH");
  }
  const expectedSignedApproval={schema:"payment-canary-founder-approval/v1",canaryId:INTERNAL_PAYMENT_CANARY.id,
    approverIdentity,approvalReference,sourceBundleSha256:sources.sourceBundleSha256,
    approvedLossCapIdr:approval.approvedLossCapIdr,effectiveAt:approval.effectiveAt,expiresAt:approval.expiresAt};
  if (JSON.stringify(signedApproval)!==JSON.stringify(expectedSignedApproval)) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_SIGNED_APPROVAL_CONTENT_MISMATCH");
  }
  const prerequisiteReceipt={paymentMethod,amountIdr:input.amountIdr,merchantReady:p.merchantReady,
    channelMinimumIdr:p.channelMinimumIdr,settlementClass:p.settlementClass.trim(),
    settlementWindow:p.settlementWindow.trim(),economics:p.economics,sources,sourceEffectiveAt:p.sourceEffectiveAt,
    sourceExpiresAt:p.sourceExpiresAt,
    approval:{approverIdentity,approvalReference,approvalReceiptSha256,effectiveAt:approval.effectiveAt,
      expiresAt:approval.expiresAt,approvedLossCapIdr:approval.approvedLossCapIdr}};
  const prerequisiteReceiptSha256=crypto.createHash("sha256").update(JSON.stringify(prerequisiteReceipt)).digest("hex");
  const pinned = {
    ...input,
    paymentMethod,
    canaryId: INTERNAL_PAYMENT_CANARY.id,
    entitlement: INTERNAL_PAYMENT_CANARY.entitlement,
    prerequisiteReceiptSha256,
  };
  if (!await deps.reserveSingleton(pinned)) {
    throw new PaymentCanaryDenied("PAYMENT_CANARY_ALREADY_ISSUED_NO_RETRY");
  }
  let providerRef: string | undefined;
  try {
    const issued = await deps.createInvoice({
      canaryId: pinned.canaryId,
      amountIdr: pinned.amountIdr,
      paymentMethod: pinned.paymentMethod,
      environment: "production",
    });
    providerRef=issued.providerRef.trim();
    if (!providerRef) throw new Error("AMBIGUOUS_PROVIDER_RESPONSE");
    let redirect:URL;
    try { redirect=new URL(issued.redirectUrl); }
    catch { throw new Error("AMBIGUOUS_PROVIDER_RESPONSE"); }
    if (redirect.protocol!=="https:") throw new Error("AMBIGUOUS_PROVIDER_RESPONSE");
    await deps.markIssued({ canaryId: pinned.canaryId, providerRef, expectedState:"RESERVED" });
    return { outcome: "ISSUED" as const, providerRef, redirectUrl:redirect.href, pinned };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "AMBIGUOUS_PROVIDER_ERROR";
    await deps.markHoldNoRetry({ canaryId: pinned.canaryId, reason, providerRef,
      expectedStates:providerRef ? ["RESERVED","ISSUED"] : ["RESERVED"] });
    return { outcome: "HOLD_NO_RETRY" as const, providerRef, pinned };
  }
}
