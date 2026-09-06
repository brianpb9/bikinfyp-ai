// Verifikasi signature Duitku — jalur uang sungguhan, formula dari SDK resmi
// duitkupg/duitku-php: callback md5(merchantCode + amount + merchantOrderId + apiKey),
// createInvoice sha256(merchantCode + timestampMs + apiKey).
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-duitku-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-duitku-storage-${process.pid}`;
process.env.DUITKU_MERCHANT_CODE = "DTEST1";
process.env.DUITKU_API_KEY = "kunci-uji-duitku";
process.env.APP_BASE_URL = "https://aiugc.id";

const { verifyDuitkuCallbackSignature, createDuitkuInvoice, duitkuBase } = await import("../lib/duitku");

const sign = (merchantCode: string, amount: string, orderId: string, apiKey: string) =>
  crypto.createHash("md5").update(merchantCode + amount + orderId + apiKey).digest("hex");

test("callback dengan signature sah diterima", () => {
  const payload = {
    merchantCode: "DTEST1",
    amount: "60000",
    merchantOrderId: "racun-abc-123",
    signature: sign("DTEST1", "60000", "racun-abc-123", "kunci-uji-duitku"),
  };
  assert.equal(verifyDuitkuCallbackSignature(payload), true);
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
    const expected = crypto.createHash("sha256").update("DTEST1" + ts + "kunci-uji-duitku").digest("hex");
    assert.equal(c.headers["x-duitku-signature"], expected);
    assert.equal(c.body.paymentAmount, 60000);
    assert.equal(c.body.merchantOrderId, "racun-abc-123");
    assert.equal(c.body.callbackUrl, "https://aiugc.id/api/webhooks/duitku");
    assert.equal(c.body.returnUrl, "https://aiugc.id/kredit");
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
