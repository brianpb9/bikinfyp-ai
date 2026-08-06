// Unit test keamanan Midtrans: verifikasi signature webhook + idempotensi.
// Memakai SERVER_KEY dummy yang di-set SEBELUM import config.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.DB_PATH = `/tmp/racun-test-midtrans-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-midtrans-storage-${process.pid}`;
process.env.MIDTRANS_SERVER_KEY = "dummy-server-key-untuk-test";
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken } = await import("../lib/auth");
const { getBalance } = await import("../lib/credits");
const { POST: webhook } = await import("../app/api/webhooks/midtrans/route");

const SERVER_KEY = "dummy-server-key-untuk-test";
const db = getDb();
const user = findOrCreateUserByPhone("085555000111");
const token = await issueToken(user.id, user.phone ?? "");

function makePendingOrder(): string {
  const orderId = `racun-test-${uuid().slice(0, 13)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), user.id, "midtrans", orderId, 120000, 120000, "pending", JSON.stringify({ package_id: "hq10" }), now());
  return orderId;
}

function settlementPayload(orderId: string, signatureOverride?: string, gross = "120000.00") {
  const statusCode = "200";
  const sig =
    signatureOverride ??
    crypto.createHash("sha512").update(orderId + statusCode + gross + SERVER_KEY).digest("hex");
  return {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: gross,
    signature_key: sig,
    transaction_status: "settlement",
    fraud_status: "",
  };
}

function callWebhook(payload: unknown) {
  return webhook(
    new Request("http://localhost/api/webhooks/midtrans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

test("signature PALSU -> 401 dan saldo TIDAK berubah (lubang lama tertutup)", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const res = await callWebhook(settlementPayload(orderId, "signature-ngasal-123"));
  assert.equal(res.status, 401);
  assert.equal(getBalance(user.id), before, "saldo tidak boleh berubah");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "pending", "status pembayaran tidak boleh berubah");
});

test("signature VALID -> 200, kredit masuk, status paid", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const res = await callWebhook(settlementPayload(orderId));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.credited, true);
  assert.equal(getBalance(user.id), before + 120000);
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "paid");
});

test("signature valid dengan gross_amount salah -> 422, diaudit, dan saldo TIDAK berubah", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  // Signature benar untuk payload ini; yang ditolak adalah ikatan nominal ke
  // amount_idr yang tersimpan pada order lokal, bukan signature palsu.
  const res = await callWebhook(settlementPayload(orderId, undefined, "500000.00"));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "GROSS_AMOUNT_MISMATCH");
  assert.equal(getBalance(user.id), before, "gross_amount yang salah tak boleh mengkredit ledger");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "pending", "order tetap pending untuk rekonsiliasi, bukan diam-diam paid/failed");
  const audit = db.prepare("SELECT meta FROM audit_log WHERE action = 'webhook.gross_amount_rejected' AND entity_id = ? ORDER BY rowid DESC LIMIT 1").get(orderId) as { meta: string } | undefined;
  assert.ok(audit, "mismatch harus memiliki audit evidence");
  assert.deepEqual(JSON.parse(audit.meta), { order_id: orderId, gross_amount: "500000.00", expected_amount_idr: 120000 });
});

test("webhook sama 2x -> idempoten (saldo hanya +1x)", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  await callWebhook(settlementPayload(orderId));
  const res2 = await callWebhook(settlementPayload(orderId));
  const body2 = await res2.json();
  assert.equal(body2.duplicated, true);
  assert.equal(getBalance(user.id), before + 120000);
});

test("status deny/cancel/expire -> status failed, tanpa kredit", async () => {
  const orderId = makePendingOrder();
  const before = getBalance(user.id);
  const payload = settlementPayload(orderId);
  payload.transaction_status = "expire";
  // signature tetap valid atas field yang sama
  const res = await callWebhook(payload);
  assert.equal(res.status, 200);
  assert.equal(getBalance(user.id), before);
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  assert.equal(pay.status, "failed");
});

test("order tidak dikenal -> 200 ignored, tanpa side effect", async () => {
  const before = getBalance(user.id);
  const fakeOrder = `racun-tidak-ada-${uuid().slice(0, 8)}`;
  const res = await callWebhook(settlementPayload(fakeOrder));
  assert.equal(res.status, 200);
  assert.equal(getBalance(user.id), before);
});

// token dipakai agar tidak dianggap unused oleh lint (auth flow sama dengan produksi)
test("sanity: token dibuat", () => assert.ok(token.length > 20));
