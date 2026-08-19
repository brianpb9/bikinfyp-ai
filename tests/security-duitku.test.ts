// Unit test keamanan webhook Duitku: verifikasi signature + ikatan nominal +
// idempotensi — cermin dari security-midtrans.test.ts, karena gateway baru
// tidak boleh membuka ulang lubang yang sudah ditutup di gateway lama.
// Kredensial dummy di-set SEBELUM import config.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-duitku-webhook-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-duitku-webhook-storage-${process.pid}`;
process.env.DUITKU_MERCHANT_CODE = "DTEST1";
process.env.DUITKU_API_KEY = "kunci-uji-duitku";
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { getBalance } = await import("../lib/credits");
const { POST: webhook } = await import("../app/api/webhooks/duitku/route");

const MERCHANT_CODE = "DTEST1";
const API_KEY = "kunci-uji-duitku";
const db = getDb();
const user = findOrCreateUserByPhone("085555000222");

function makePendingOrder(): string {
  const orderId = `racun-test-${uuid().slice(0, 13)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), user.id, "duitku", orderId, 120000, 120000, "pending", JSON.stringify({ package_id: "hq10" }), now());
  return orderId;
}

function callbackPayload(orderId: string, opts?: { signatureOverride?: string; amount?: string; resultCode?: string }) {
  const amount = opts?.amount ?? "120000";
  const sig =
    opts?.signatureOverride ??
    crypto.createHash("md5").update(MERCHANT_CODE + amount + orderId + API_KEY).digest("hex");
  return {
    merchantCode: MERCHANT_CODE,
    amount,
    merchantOrderId: orderId,
    productDetail: "10x AI Bersuara BikinFYP AI",
    additionalParam: "",
    paymentCode: "SP",
    resultCode: opts?.resultCode ?? "00",
    merchantUserId: "",
    reference: "DTEST-REF-001",
    signature: sig,
    spUserHash: "",
  };
}

function callWebhook(payload: Record<string, string>) {
  return webhook(
    new Request("http://localhost/api/webhooks/duitku", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(payload).toString(),
    })
  );
}

test("signature PALSU -> 401 dan saldo TIDAK berubah", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const res = await callWebhook(callbackPayload(orderId, { signatureOverride: "signature-ngasal-123" }));
  assert.equal(res.status, 401);
  assert.equal(getBalance(user.id), before, "saldo tidak boleh berubah");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "pending", "status pembayaran tidak boleh berubah");
});

test("signature VALID resultCode 00 -> 200, kredit masuk, status paid", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const res = await callWebhook(callbackPayload(orderId));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.credited, true);
  assert.equal(getBalance(user.id), before + 120000);
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "paid");
});

test("signature valid dengan amount salah -> 422, diaudit, saldo TIDAK berubah", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  // Signature benar untuk payload ini; yang ditolak adalah ikatan nominal ke
  // amount_idr order lokal — signature sah tidak membuktikan payload milik order ini.
  const res = await callWebhook(callbackPayload(orderId, { amount: "500000" }));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "GROSS_AMOUNT_MISMATCH");
  assert.equal(getBalance(user.id), before, "amount yang salah tak boleh mengkredit ledger");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "pending", "order tetap pending untuk rekonsiliasi");
  const auditRow = db.prepare("SELECT meta FROM audit_log WHERE action = 'webhook.gross_amount_rejected' AND entity_id = ? ORDER BY rowid DESC LIMIT 1").get(orderId) as { meta: string } | undefined;
  assert.ok(auditRow, "mismatch harus memiliki audit evidence");
  assert.deepEqual(JSON.parse(auditRow.meta), { merchant_order_id: orderId, amount: "500000", expected_amount_idr: 120000 });
});

test("callback sama 2x -> idempoten (saldo hanya +1x)", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  await callWebhook(callbackPayload(orderId));
  const res2 = await callWebhook(callbackPayload(orderId));
  const body2 = await res2.json();
  assert.equal(body2.duplicated, true);
  assert.equal(getBalance(user.id), before + 120000);
});

test("resultCode 01 (gagal) -> status failed, tanpa kredit", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const res = await callWebhook(callbackPayload(orderId, { resultCode: "01" }));
  assert.equal(res.status, 200);
  assert.equal(getBalance(user.id), before);
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "failed");
});

test("resultCode 01 SETELAH paid tidak menurunkan status paid", async () => {
  const orderId = makePendingOrder();
  await callWebhook(callbackPayload(orderId));
  const res = await callWebhook(callbackPayload(orderId, { resultCode: "01" }));
  assert.equal(res.status, 200);
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "paid", "status paid final tidak boleh dimundurkan callback susulan");
});

test("order tidak dikenal -> 200 ignored, tanpa side effect", async () => {
  const before = getBalance(user.id);
  const res = await callWebhook(callbackPayload(`racun-tidak-ada-${uuid().slice(0, 8)}`));
  assert.equal(res.status, 200);
  assert.equal(getBalance(user.id), before);
});

test("callback merchantCode lain -> 401 walau signature konsisten dengan kuncinya sendiri", async () => {
  const orderId = makePendingOrder();
  const sig = crypto.createHash("md5").update("ORANGLAIN" + "120000" + orderId + API_KEY).digest("hex");
  const res = await callWebhook({ ...callbackPayload(orderId), merchantCode: "ORANGLAIN", signature: sig });
  assert.equal(res.status, 401);
});
