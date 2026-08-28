import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INTERNAL_PAYMENT_CANARY, PaymentCanaryDenied, runProductionPaymentCanary } from "../lib/payment-production-canary";
import {loadPaymentCanaryFounderAuthorityFromDeployment} from "../lib/payment-canary-founder-trust";
import { TOPUP_PACKAGES } from "../lib/credits";

const {privateKey,publicKey}=crypto.generateKeyPairSync("ed25519");
const economics={cogsIdr:6_000,feeIdr:100,taxIdr:0,netIdr:9_900,marginIdr:3_900,
  cogsSource:"evidence://cogs",feeSource:"evidence://fee",taxSource:"evidence://tax"};
const sourceBundle={schema:"payment-canary-source-bundle/v1",merchantReadinessSource:"evidence://merchant-readiness",
  channelMinimumSource:"evidence://channel-minimum",settlementSource:"evidence://settlement",
  cogsSource:economics.cogsSource,feeSource:economics.feeSource,taxSource:economics.taxSource,
  effectiveAt:"2026-08-27T00:00:00.000Z",expiresAt:"2026-08-29T00:00:00.000Z",economics};
const sourceBundleBytes=Buffer.from(JSON.stringify(sourceBundle));
const sourceBundleSha256=crypto.createHash("sha256").update(sourceBundleBytes).digest("hex");
const signedApproval={schema:"payment-canary-founder-approval/v1",canaryId:"production-payment-canary-v1",
  approverIdentity:"Founder/CEO",approvalReference:"evidence://founder/payment-canary",sourceBundleSha256,
  approvedLossCapIdr:50_000,effectiveAt:"2026-08-27T00:00:00.000Z",expiresAt:"2026-08-29T00:00:00.000Z"};
const approvalReceiptBytes=Buffer.from(JSON.stringify(signedApproval));
const approvalReceiptSha256=crypto.createHash("sha256").update(approvalReceiptBytes).digest("hex");
const authorityEvidence={sourceBundleBase64:sourceBundleBytes.toString("base64"),
  approvalReceiptBase64:approvalReceiptBytes.toString("base64"),
  approvalSignatureBase64:crypto.sign(null,approvalReceiptBytes,privateKey).toString("base64"),approvalKeyId:"founder-test-v1"};
const loadTrustedFounderAuthority=async()=>({keyId:"founder-test-v1",approverIdentity:"Founder/CEO" as const,
  publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString()});
const valid = { actorId: "tester-1", configuredTesterId: "tester-1", paymentMethod: "VA",
  configuredPaymentMethod:"VA",amountIdr:10_000,environment:"production" as const,prerequisites:{
    merchantReady:true,merchantReadinessSource:"evidence://merchant-readiness",channelMinimumIdr:10_000,
    channelMinimumSource:"evidence://channel-minimum",settlementClass:"T+1",settlementWindow:"next banking day",
    settlementSource:"evidence://settlement",sourceBundleSha256,
    sourceEffectiveAt:"2026-08-27T00:00:00.000Z",sourceExpiresAt:"2026-08-29T00:00:00.000Z",authorityEvidence,
    approval:{approverIdentity:"Founder/CEO",
      approvalReference:"evidence://founder/payment-canary",approvalReceiptSha256,
      effectiveAt:"2026-08-27T00:00:00.000Z",expiresAt:"2026-08-29T00:00:00.000Z",approvedLossCapIdr:50_000},
    economics}};
const fixedNow = () => new Date("2026-08-28T00:00:00.000Z");

test("internal canary SKU is <=50k and absent from every public package export", () => {
  assert.equal(INTERNAL_PAYMENT_CANARY.amountIdr <= 50_000, true);
  assert.equal(TOPUP_PACKAGES.some((pkg) => String(pkg.id) === INTERNAL_PAYMENT_CANARY.id), false);
  assert.equal(INTERNAL_PAYMENT_CANARY.entitlement, "INTERNAL_SETTLEMENT_PROOF_ONLY_NO_CUSTOMER_CREDITS");
});

test("wrong tester, environment, amount, or method is denied before reservation/provider", async () => {
  let effects = 0;
  const deps = {
    reserveSingleton: async () => { effects++; return true; },
    createInvoice: async () => { effects++; return { providerRef: "ref", redirectUrl: "url" }; },
    markIssued: async () => { effects++; }, markHoldNoRetry: async () => { effects++; },
    now: fixedNow,
    loadTrustedFounderAuthority,
  };
  for (const input of [
    { ...valid, actorId: "intruder" },
    { ...valid, environment: "sandbox" as const },
    { ...valid, amountIdr: 10_001 },
    { ...valid, paymentMethod: " " },
    { ...valid, configuredPaymentMethod:"QRIS" },
    { ...valid, prerequisites:{...valid.prerequisites,merchantReady:false} },
    { ...valid, prerequisites:{...valid.prerequisites,merchantReadinessSource:""} },
    { ...valid, prerequisites:{...valid.prerequisites,channelMinimumIdr:10_001} },
    { ...valid, prerequisites:{...valid.prerequisites,settlementWindow:""} },
    { ...valid, prerequisites:{...valid.prerequisites,sourceBundleSha256:"short"} },
    { ...valid, prerequisites:{...valid.prerequisites,sourceExpiresAt:"2026-08-27T00:00:00.000Z"} },
    { ...valid, prerequisites:{...valid.prerequisites,approval:{...valid.prerequisites.approval,approverIdentity:"operator"}} },
    { ...valid, prerequisites:{...valid.prerequisites,approval:{...valid.prerequisites.approval,expiresAt:"2026-08-27T00:00:00.000Z"}} },
    { ...valid, prerequisites:{...valid.prerequisites,economics:{...valid.prerequisites.economics,marginIdr:3_901}} },
    { ...valid, prerequisites:{...valid.prerequisites,economics:{...valid.prerequisites.economics,cogsIdr:60_000,
      marginIdr:-50_100}} },
  ]) await assert.rejects(runProductionPaymentCanary(input, deps), PaymentCanaryDenied);
  assert.equal(effects, 0);
});

test("self-asserted hashes and attacker signatures are rejected before reservation/provider", async () => {
  let effects=0;
  const deps={reserveSingleton:async()=>{effects++;return true;},createInvoice:async()=>{effects++;return {providerRef:"x",redirectUrl:"x"};},
    markIssued:async()=>{effects++;},markHoldNoRetry:async()=>{effects++;},now:fixedNow,loadTrustedFounderAuthority};
  await assert.rejects(runProductionPaymentCanary({...valid,prerequisites:{...valid.prerequisites,
    sourceBundleSha256:"a".repeat(64)}},deps),/EVIDENCE_DIGEST_MISMATCH/);
  const attacker=crypto.generateKeyPairSync("ed25519");
  await assert.rejects(runProductionPaymentCanary({...valid,prerequisites:{...valid.prerequisites,
    authorityEvidence:{...authorityEvidence,approvalSignatureBase64:crypto.sign(null,approvalReceiptBytes,attacker.privateKey).toString("base64")}}},deps),
    /FOUNDER_SIGNATURE_INVALID/);
  assert.equal(effects,0);
});

test("deployment Founder trust record is pinned by immutable byte digest", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"payment-founder-trust-")),file=path.join(dir,"trust.json");
  const bytes=Buffer.from(JSON.stringify({schema:"payment-canary-founder-trust/v1",keyId:"founder-test-v1",
    approverIdentity:"Founder/CEO",publicKeyPem:publicKey.export({type:"spki",format:"pem"}).toString()}));
  const oldPath=process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH;
  const oldHash=process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256;
  try {
    fs.writeFileSync(file,bytes);process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH=file;
    process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256=crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal((await loadPaymentCanaryFounderAuthorityFromDeployment()).keyId,"founder-test-v1");
    process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256="f".repeat(64);
    await assert.rejects(loadPaymentCanaryFounderAuthorityFromDeployment(),/TRUST_DIGEST_MISMATCH/);
  } finally {
    if(oldPath===undefined)delete process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH;
    else process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_PATH=oldPath;
    if(oldHash===undefined)delete process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256;
    else process.env.PAYMENT_CANARY_FOUNDER_TRUST_RECORD_SHA256=oldHash;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test("singleton prevents a second invoice and pins exact method/amount/env/ref", async () => {
  let reserved = false; let providerCalls = 0; let issued: unknown;
  const deps = {
    reserveSingleton: async (input: any) => { if (reserved) return false; reserved = true;
      assert.deepEqual({...input,prerequisiteReceiptSha256:"HASH"}, {
        ...valid, canaryId: "production-payment-canary-v1", entitlement: "INTERNAL_SETTLEMENT_PROOF_ONLY_NO_CUSTOMER_CREDITS",
        prerequisiteReceiptSha256:"HASH"});
      assert.match(input.prerequisiteReceiptSha256,/^[0-9a-f]{64}$/);return true; },
    createInvoice: async (input: unknown) => { providerCalls++; assert.deepEqual(input, {
      canaryId: "production-payment-canary-v1", amountIdr: 10_000, paymentMethod: "VA", environment: "production",
    }); return { providerRef: "provider-ref-pinned", redirectUrl: "https://provider.invalid/pay" }; },
    markIssued: async (input: unknown) => { issued = input; }, markHoldNoRetry: async () => assert.fail("success became HOLD"),
    now: fixedNow,
    loadTrustedFounderAuthority,
  };
  assert.equal((await runProductionPaymentCanary(valid, deps)).outcome, "ISSUED");
  assert.deepEqual(issued, { canaryId: "production-payment-canary-v1", providerRef: "provider-ref-pinned",
    expectedState:"RESERVED" });
  await assert.rejects(runProductionPaymentCanary(valid, deps), /ALREADY_ISSUED_NO_RETRY/);
  assert.equal(providerCalls, 1);
});

test("ambiguous provider result is durable HOLD_NO_RETRY", async () => {
  let hold: unknown;
  const result = await runProductionPaymentCanary(valid, {
    reserveSingleton: async () => true,
    createInvoice: async () => { throw new Error("timeout after request bytes sent"); },
    markIssued: async () => assert.fail("ambiguous result became issued"),
    markHoldNoRetry: async (input) => { hold = input; },
    now: fixedNow,
    loadTrustedFounderAuthority,
  });
  assert.equal(result.outcome, "HOLD_NO_RETRY");
  assert.deepEqual(hold, { canaryId: "production-payment-canary-v1", reason: "timeout after request bytes sent",
    providerRef:undefined,expectedStates:["RESERVED"] });
});

test("provider reference survives markIssued failure for guarded reconciliation HOLD", async () => {
  let hold: unknown;
  const result=await runProductionPaymentCanary(valid,{
    reserveSingleton:async()=>true,
    createInvoice:async()=>({providerRef:"ref-known",redirectUrl:"https://provider.invalid/pay"}),
    markIssued:async()=>{throw new Error("db write failed");},
    markHoldNoRetry:async(input)=>{hold=input;},
    now:fixedNow,
    loadTrustedFounderAuthority,
  });
  assert.equal(result.outcome,"HOLD_NO_RETRY");
  assert.equal(result.providerRef,"ref-known");
  assert.deepEqual(hold,{canaryId:"production-payment-canary-v1",reason:"db write failed",providerRef:"ref-known",
    expectedStates:["RESERVED","ISSUED"]});
});

test("migration enforces database singleton and no-retry state", () => {
  const sql = fs.readFileSync(new URL("../migrations/postgres/0040_payment_production_canary.sql", import.meta.url), "utf8");
  assert.match(sql, /singleton_id TEXT PRIMARY KEY/);
  assert.match(sql, /amount_idr = 10000/);
  assert.match(sql, /payments_env = 'production'/);
  assert.match(sql, /channel_minimum_idr <= amount_idr/);
  assert.match(sql, /prerequisite_receipt_sha256/);
  assert.match(sql, /approval_receipt_sha256/);
  assert.match(sql, /approved_loss_cap_idr/);
  assert.match(sql, /source_bundle_sha256/);
  assert.match(sql, /source_expires_at/);
  assert.match(sql, /approval_key_id/);
  assert.match(sql, /settlement_class/);
  assert.match(sql, /HOLD_NO_RETRY/);
  assert.match(sql, /no_retry = TRUE/);
  assert.match(sql, /REVOKE ALL/);
});
