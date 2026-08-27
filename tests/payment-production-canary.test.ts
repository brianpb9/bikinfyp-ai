import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { INTERNAL_PAYMENT_CANARY, PaymentCanaryDenied, runProductionPaymentCanary } from "../lib/payment-production-canary";
import { TOPUP_PACKAGES } from "../lib/credits";

const valid = { actorId: "tester-1", configuredTesterId: "tester-1", paymentMethod: "VA",
  configuredPaymentMethod:"VA",amountIdr:10_000,environment:"production" as const,prerequisites:{
    merchantReady:true,merchantReadinessSource:"fixture://merchant-readiness",channelMinimumIdr:10_000,
    channelMinimumSource:"fixture://channel-minimum",settlementClass:"T+1",settlementWindow:"next banking day",
    settlementSource:"fixture://settlement",economics:{cogsIdr:6_000,feeIdr:100,taxIdr:0,netIdr:9_900,
      marginIdr:3_900,cogsSource:"fixture://cogs",feeSource:"fixture://fee",taxSource:"fixture://tax"}}};

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
    { ...valid, prerequisites:{...valid.prerequisites,economics:{...valid.prerequisites.economics,marginIdr:3_901}} },
  ]) await assert.rejects(runProductionPaymentCanary(input, deps), PaymentCanaryDenied);
  assert.equal(effects, 0);
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
  };
  assert.equal((await runProductionPaymentCanary(valid, deps)).outcome, "ISSUED");
  assert.deepEqual(issued, { canaryId: "production-payment-canary-v1", providerRef: "provider-ref-pinned" });
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
  });
  assert.equal(result.outcome, "HOLD_NO_RETRY");
  assert.deepEqual(hold, { canaryId: "production-payment-canary-v1", reason: "timeout after request bytes sent" });
});

test("migration enforces database singleton and no-retry state", () => {
  const sql = fs.readFileSync(new URL("../migrations/postgres/0040_payment_production_canary.sql", import.meta.url), "utf8");
  assert.match(sql, /singleton_id TEXT PRIMARY KEY/);
  assert.match(sql, /amount_idr = 10000/);
  assert.match(sql, /payments_env = 'production'/);
  assert.match(sql, /channel_minimum_idr <= amount_idr/);
  assert.match(sql, /prerequisite_receipt_sha256/);
  assert.match(sql, /settlement_class/);
  assert.match(sql, /HOLD_NO_RETRY/);
  assert.match(sql, /no_retry = TRUE/);
  assert.match(sql, /REVOKE ALL/);
});
