import crypto from "node:crypto";
import fs from "node:fs";

export async function loadPaymentCanaryFounderAuthorityFromDeployment() {
  const recordPath=process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH?.trim()??"";
  const expectedSha256=process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256?.trim()??"";
  if(!recordPath.startsWith("/")||!/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error("PAYMENT_CANARY_FOUNDER_TRUST_NOT_CONFIGURED");
  }
  const bytes=fs.readFileSync(recordPath);
  if(crypto.createHash("sha256").update(bytes).digest("hex")!==expectedSha256) {
    throw new Error("PAYMENT_CANARY_FOUNDER_TRUST_DIGEST_MISMATCH");
  }
  const record=JSON.parse(bytes.toString("utf8")) as Record<string,unknown>;
  if(record.schema!=="payment-canary-founder-trust/v1"||record.approverIdentity!=="Founder/CEO"
      ||typeof record.keyId!=="string"||!record.keyId||typeof record.publicKeyPem!=="string") {
    throw new Error("PAYMENT_CANARY_FOUNDER_TRUST_RECORD_INVALID");
  }
  const key=crypto.createPublicKey(record.publicKeyPem);
  if(key.asymmetricKeyType!=="ed25519")throw new Error("PAYMENT_CANARY_FOUNDER_TRUST_KEY_INVALID");
  return {keyId:record.keyId,approverIdentity:"Founder/CEO" as const,publicKeyPem:record.publicKeyPem};
}
