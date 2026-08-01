import assert from "node:assert/strict";
import test from "node:test";
import { MidtransCallbackNotConfigured, midtransNotificationUrl } from "../lib/midtrans";

test("callback Midtrans hanya dibentuk dari APP_BASE_URL HTTPS origin", () => {
  assert.equal(
    midtransNotificationUrl("https://racun-ai-staging-web.onrender.com"),
    "https://racun-ai-staging-web.onrender.com/api/webhooks/midtrans"
  );
});

for (const value of ["", "http://localhost:3000", "https://user:pass@example.com", "https://example.com/base", "https://example.com?host=evil"]) {
  test(`callback Midtrans fail-closed untuk APP_BASE_URL tidak aman: ${value || "kosong"}`, () => {
    assert.throws(() => midtransNotificationUrl(value), MidtransCallbackNotConfigured);
  });
}
