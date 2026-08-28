// Unit test keamanan OTP EMAIL + gate dev route + checkout tanpa key.
// File ini TANPA MIDTRANS_SERVER_KEY (checkout harus 503 jelas) & TANPA RESEND_API_KEY (mock).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-security-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-security-storage-${process.pid}`;
process.env.RACUN_NO_DOTENV = "1";
delete process.env.MIDTRANS_SERVER_KEY;
delete process.env.RESEND_API_KEY;
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb } = await import("../lib/db");
const { findOrCreateUserByEmail, issueToken } = await import("../lib/auth");
const { generateCode, storeOtp, verifyOtp, isValidEmail } = await import("../lib/otp");
const { POST: requestOtp } = await import("../app/api/auth/request-otp/route");
const { POST: devLogin } = await import("../app/api/auth/dev-login/route");
const { POST: checkout } = await import("../app/api/credits/checkout/route");
const { POST: webhookStub } = await import("../app/api/webhooks/payment/route");

const db = getDb();

function jsonReq(url: string, body: unknown, cookie?: string) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test("OTP: kode salah 5x -> locked; kode benar setelah locked tetap ditolak", () => {
  const email = "salah@contoh.com";
  const code = generateCode();
  storeOtp(email, code);
  for (let i = 0; i < 5; i++) {
    const r = verifyOtp(email, "000000");
    assert.equal(r.ok, false);
  }
  const locked = verifyOtp(email, code);
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "too_many_attempts");
});

test("OTP: kode benar langsung -> ok; attempts_left turun per tebakan salah", () => {
  const email = "benar@contoh.com";
  const code = generateCode();
  storeOtp(email, code);
  const wrong = verifyOtp(email, "000000");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.attemptsLeft, 4);
  const right = verifyOtp(email, code);
  assert.equal(right.ok, true);
});

test("OTP: validasi format email dasar", () => {
  assert.ok(isValidEmail("nama@email.com"));
  assert.ok(!isValidEmail("bukan-email"));
  assert.ok(!isValidEmail("tanpa@tld"));
  assert.ok(!isValidEmail(""));
});

test("request-otp: email invalid -> 400 pesan jelas", async () => {
  const res = await requestOtp(jsonReq("/api/auth/request-otp", { email: "bukan-email" }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, "BAD_REQUEST");
  assert.match(body.message_id, /Email/);
});

test("request-otp: kirim ke-4 dalam 15 menit -> 429 pesan Indonesia", async () => {
  const email = "ratelimit@contoh.com";
  for (let i = 0; i < 3; i++) {
    const res = await requestOtp(jsonReq("/api/auth/request-otp", { email }));
    assert.equal(res.status, 200, `kirim ${i + 1} harus 200`);
  }
  const res4 = await requestOtp(jsonReq("/api/auth/request-otp", { email }));
  assert.equal(res4.status, 429);
  const body = await res4.json();
  assert.equal(body.code, "OTP_RATE_LIMITED");
  assert.match(body.message_id, /15 menit/);
});

test("request-otp: mode mock mengembalikan dev_hint, tidak membocorkan kode", async () => {
  const email = "mock@contoh.com";
  const res = await requestOtp(jsonReq("/api/auth/request-otp", { email }));
  const body = await res.json();
  assert.equal(body.mode, "mock");
  assert.ok(body.dev_hint);
  assert.ok(!JSON.stringify(body).match(/\b\d{6}\b/), "kode tidak boleh muncul di respons");
  // dan kode tersimpan sebagai HASH di DB (bukan mentah)
  const row = db.prepare("SELECT code_hash FROM otp_codes WHERE email = ?").get(email) as { code_hash: string };
  assert.ok(row.code_hash.length === 64, "yang tersimpan harus sha256 hash");
});

test("signup via email: user baru dapat bonus Rp12.000", () => {
  const user = findOrCreateUserByEmail("Baru@Contoh.com");
  assert.equal(user.email, "baru@contoh.com", "email dinormalisasi lowercase");
  const bal = db.prepare("SELECT COALESCE(SUM(delta),0) AS b FROM credit_ledger WHERE user_id = ?").get(user.id) as { b: number };
  assert.equal(bal.b, 12000);
  // idempoten: email sama -> user sama, bonus tidak dobel
  const again = findOrCreateUserByEmail("baru@contoh.com");
  assert.equal(again.id, user.id);
  const bal2 = db.prepare("SELECT COALESCE(SUM(delta),0) AS b FROM credit_ledger WHERE user_id = ?").get(user.id) as { b: number };
  assert.equal(bal2.b, 12000);
});

test("dev-login & webhook stub: 403 saat NODE_ENV=production", async () => {
  const original = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    const res = await devLogin(jsonReq("/api/auth/dev-login", { phone: "084444000555" }));
    assert.equal(res.status, 403);
    const res2 = await webhookStub(jsonReq("/api/webhooks/payment", { gateway_ref: "x", package_id: "hq5", phone: "084444000555" }));
    assert.equal(res2.status, 403);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = original;
  }
});

test("public checkout fails closed before pending row/provider while payments are not live", async () => {
  const user = findOrCreateUserByEmail("checkout@contoh.com");
  const token = await issueToken(user.id, user.email ?? "");
  const res = await checkout(jsonReq("/api/credits/checkout", { package_id: "hq5" }, `racun_token=${encodeURIComponent(token)}`));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, "PAYMENT_NOT_LIVE");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM payments WHERE user_id = ?").get(user.id) as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE actor = ? AND action LIKE 'payment.%'").get(user.id) as { n: number }).n, 0);
});
