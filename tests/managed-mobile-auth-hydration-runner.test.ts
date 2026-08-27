import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/managed-mobile-auth-hydration.ts", import.meta.url), "utf8");

test("managed mobile runner is exact-SHA, 375px, provider-free, and cleanup-bound", () => {
  assert.match(source, /RENDER_GIT_COMMIT[\s\S]*EXPECTED_SHA/);
  assert.match(source, /RACUN_DEPLOY_ENV[\s\S]*staging/);
  assert.match(source, /width: 375, height: 812/);
  assert.match(source, /width: 375, height: 520/);
  assert.match(source, /page\.route\("\*\*\/api\/\*\*"/);
  assert.match(source, /request\.method\(\) === "GET"/);
  assert.match(source, /route\.abort\("blockedbyclient"\)/);
  assert.match(source, /\/api\/auth\/verify-otp/);
  assert.match(source, /otpStarted/);
  assert.match(source, /releaseOtpRoute/);
  assert.match(source, /wrong\.status\(\), 401/);
  assert.match(source, /correct\.status\(\), 200/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /keyboard\.press\("Escape"\)/);
  assert.match(source, /document\.activeElement === element/);
  assert.match(source, /hydration\|content security policy\|csp\|evalerror/i);
  assert.match(source, /'koreksi'/);
  assert.match(source, /history_rows_preserved/);
  assert.doesNotMatch(source, /DELETE FROM (credit_ledger|audit_log|users)/);
  assert.match(source, /DELETE FROM otp_codes/);
  assert.match(source, /DELETE FROM org_members/);
  assert.match(source, /DELETE FROM organizations/);
  assert.match(source, /RETAINED TEST IDENTITY/);
  assert.match(source, /onboarded_at/);
  assert.match(source, /orgInserted = true[\s\S]*INSERT INTO org_members[\s\S]*membershipInserted = true/);
  assert.match(source, /SELECT id FROM users WHERE email=\$1/);
  assert.match(source, /cleanupErrors/);
  assert.match(source, /private-r2/);
  assert.match(source, /sha256/);
  assert.match(source, /PENDING_INDEPENDENT_REVIEW/);
  assert.match(source, /points_claimed: 0/);
  assert.match(source, /fullPage: false/);
  assert.match(source, /visualViewport/);
  assert.match(source, /focused_visible/);
  assert.match(source, /payments_live, false/);
  for (const endpoint of ["/api/scripts/generate", "/api/dashboard/campaign/generate", "/api/dashboard/campaign/confirm",
    "/api/dashboard/matrix", "/api/jobs", "/api/promo/jobs", "/api/credits/checkout", "/api/credits/topup"]) {
    assert.match(source, new RegExp(endpoint.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(source, /createDuitkuInvoice|createMidtransTransaction|enqueueJob/);
});
