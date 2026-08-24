// Verifikasi signature Duitku — jalur uang sungguhan, formula dari SDK resmi
// Duitku POP saat ini: semua signature menggunakan HMAC-SHA256 dengan API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-duitku-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-duitku-storage-${process.pid}`;
process.env.DUITKU_MERCHANT_CODE = "DTEST1";
process.env.DUITKU_API_KEY = "kunci-uji-duitku";
process.env.APP_BASE_URL = "https://bikinfyp.com";

const {
  verifyDuitkuCallbackSignature,
  createDuitkuInvoice,
  duitkuBase,
  duitkuTransactionStatusDetailed,
  duitkuTransactionStatusUrl,
  buildDuitkuStatusEvidence,
} = await import("../lib/duitku");

const sign = (merchantCode: string, amount: string, orderId: string, apiKey: string) =>
  crypto.createHmac("sha256", apiKey).update(merchantCode + amount + orderId).digest("hex");

test("callback dengan signature sah diterima", () => {
  const payload = {
    merchantCode: "DTEST1",
    amount: "60000",
    merchantOrderId: "racun-abc-123",
    signature: sign("DTEST1", "60000", "racun-abc-123", "kunci-uji-duitku"),
  };
  assert.equal(verifyDuitkuCallbackSignature(payload), true);
});

test("HTTP 404 tanpa skema status Duitku menghasilkan HOLD, bukan bukti sukses", () => {
  const evidence = buildDuitkuStatusEvidence({
    httpStatus: 404,
    contentType: "application/json; charset=utf-8",
    bodySha256: "a".repeat(64),
    bodyKeys: ["Message"],
  }, {
    orderId: "bikinfyp-sandbox-verify-20260824154351-2a4e286b",
    amountIdr: 60000,
    providerReferenceSha256: "b".repeat(64),
  }, "2026-08-24T15:43:52.734Z");

  assert.equal(evidence.verification.outcome, "HOLD");
  assert.deepEqual(evidence.verification.blockers, [
    "HTTP_404",
    "MISSING_MERCHANT_ORDER_ID",
    "MISSING_REFERENCE",
    "MISSING_AMOUNT",
    "MISSING_STATUS_CODE",
    "MISSING_STATUS_MESSAGE",
  ]);
  assert.notEqual(evidence.verification.outcome, "PASS");
});

test("status JSON null, array, dan primitif aman diperlakukan sebagai record kosong", async () => {
  const realFetch = globalThis.fetch;
  try {
    for (const raw of ["null", "[]", "42", '"teks"']) {
      globalThis.fetch = (async () => new Response(raw, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
      const detail = await duitkuTransactionStatusDetailed("racun-shape-test");
      assert.deepEqual(detail.bodyKeys, []);
      assert.equal(detail.merchantOrderId, undefined);
      assert.equal(detail.statusCode, undefined);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("signature salah / field hilang / merchant lain semuanya ditolak", () => {
  const base = { merchantCode: "DTEST1", amount: "60000", merchantOrderId: "racun-abc-123" };
  assert.equal(verifyDuitkuCallbackSignature({ ...base, signature: "deadbeef" }), false);
  assert.equal(verifyDuitkuCallbackSignature({ ...base }), false);
  assert.equal(verifyDuitkuCallbackSignature({}), false);
  // Amount diganti penyerang -> signature tidak lagi cocok.
  assert.equal(
    verifyDuitkuCallbackSignature({
      ...base,
      amount: "1",
      signature: sign("DTEST1", "60000", "racun-abc-123", "kunci-uji-duitku"),
    }),
    false
  );
  // merchantCode bukan milik kita ditolak SEBELUM hitung hash.
  assert.equal(
    verifyDuitkuCallbackSignature({
      merchantCode: "ORANGLAIN",
      amount: "60000",
      merchantOrderId: "racun-abc-123",
      signature: sign("ORANGLAIN", "60000", "racun-abc-123", "kunci-uji-duitku"),
    }),
    false
  );
});

test("default non-produksi mengarah ke sandbox Duitku", () => {
  assert.equal(duitkuBase(), "https://api-sandbox.duitku.com");
});

test("createInvoice mengirim header signature yang benar dan membaca paymentUrl", async () => {
  const realFetch = globalThis.fetch;
  type Captured = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
  let captured: Captured | null = null;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    captured = {
      url: String(url),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(
      JSON.stringify({ statusCode: "00", statusMessage: "SUCCESS", reference: "D0001", paymentUrl: "https://app-sandbox.duitku.com/redirect/x" }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const res = await createDuitkuInvoice({ orderId: "racun-abc-123", packageId: "hq5", phone: "0812", email: "a@b.c" });
    assert.deepEqual(res, { providerRef: "D0001", redirectUrl: "https://app-sandbox.duitku.com/redirect/x" });
    const c = captured as Captured | null;
    assert.ok(c, "fetch harus terpanggil");
    assert.equal(c.url, "https://api-sandbox.duitku.com/api/merchant/createInvoice");
    assert.equal(c.headers["x-duitku-merchantcode"], "DTEST1");
    const ts = c.headers["x-duitku-timestamp"];
    const expected = crypto.createHmac("sha256", "kunci-uji-duitku").update("DTEST1" + ts).digest("hex");
    assert.equal(c.headers["x-duitku-signature"], expected);
    assert.equal(c.body.paymentAmount, 60000);
    assert.equal(c.body.merchantOrderId, "racun-abc-123");
    assert.equal(c.body.callbackUrl, "https://bikinfyp.com/api/webhooks/duitku");
    assert.equal(c.body.returnUrl, "https://bikinfyp.com/kredit");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("transactionStatus memakai endpoint webapi sandbox dan HMAC-SHA256", async () => {
  assert.equal(duitkuTransactionStatusUrl(), "https://sandbox.duitku.com/webapi/api/merchant/transactionStatus");
  const realFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedBody: Record<string, string> = {};
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      merchantOrderId: "racun-abc-123",
      statusCode: "01",
      statusMessage: "PENDING",
      reference: "D0001",
      amount: 60000,
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const detail = await duitkuTransactionStatusDetailed("racun-abc-123");
    assert.equal(capturedUrl, "https://sandbox.duitku.com/webapi/api/merchant/transactionStatus");
    assert.equal(capturedBody.merchantCode, "DTEST1");
    assert.equal(capturedBody.merchantOrderId, "racun-abc-123");
    assert.equal(
      capturedBody.signature,
      crypto.createHmac("sha256", "kunci-uji-duitku").update("DTEST1racun-abc-123").digest("hex")
    );
    assert.equal(detail.httpStatus, 200);
    assert.equal(detail.statusCode, "01");
    assert.deepEqual(detail.bodyKeys, ["amount", "merchantOrderId", "reference", "statusCode", "statusMessage"]);
    const evidence = buildDuitkuStatusEvidence(detail, {
      orderId: "racun-abc-123",
      amountIdr: 60000,
      providerReferenceSha256: crypto.createHash("sha256").update("D0001").digest("hex"),
    });
    assert.equal(evidence.verification.outcome, "PASS");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("statusCode selain 00 dilempar sebagai error, bukan sukses diam-diam", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ statusCode: "02", statusMessage: "Invalid signature" }), { status: 400 })) as typeof fetch;
  try {
    await assert.rejects(
      createDuitkuInvoice({ orderId: "racun-x", packageId: "hq5", phone: "", email: "" }),
      /duitku: HTTP 400/
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
