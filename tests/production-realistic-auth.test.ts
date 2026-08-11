// Production-like configuration must fail closed: no dev-login and no OTP
// mock when Resend credentials are absent. A real email smoke is a separate,
// credentialed command (scripts/smoke-production-auth.sh).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
// Node's ProcessEnv declares this property read-only in the current typings.
(process.env as Record<string, string | undefined>).NODE_ENV = "production";
// lib/secrets.ts menolak boot di production tanpa AUTH_SECRET yang layak.
process.env.AUTH_SECRET = "x".repeat(48);
process.env.ALLOW_DEV_LOGIN = "0";
process.env.PROVIDER_VIDEO = "byteplus";
delete process.env.RESEND_API_KEY;
delete process.env.MIDTRANS_SERVER_KEY;

const { POST: devLogin } = await import("../app/api/auth/dev-login/route");
const { sendOtpEmail } = await import("../lib/email-otp");
const { registeredVideoProviders } = await import("../lib/providers/registry");

test("production-like auth disables dev login and OTP mock when Resend is absent", async () => {
  const res = await devLogin(new Request("http://localhost/api/auth/dev-login", {
    method: "POST", headers: { "content-type": "application/json" }, body: '{"phone":"08123456789"}',
  }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "DEV_ROUTE_DISABLED");
  await assert.rejects(() => sendOtpEmail("real-user@example.test", "123456"), /RESEND_API_KEY/);
});

test("production-like video registry has no mock fallback", () => {
  assert.deepEqual(registeredVideoProviders(), ["byteplus-ark-seedance", "alibaba-dashscope-wan"]);
});
