import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/managed-mobile-auth-hydration.ts", import.meta.url), "utf8");
const evidenceDockerfile = fs.readFileSync(new URL("../Dockerfile.mobile-evidence", import.meta.url), "utf8");

test("managed mobile runner is exact-SHA, 375px, provider-free, and cleanup-bound", () => {
  assert.match(source, /EVIDENCE_SOURCE_SHA[\s\S]*EXPECTED_SHA/);
  assert.match(source, /health\.build_sha, EXPECTED_SHA/);
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
  assert.match(source, /DELETE FROM org_members WHERE id=\$1/);
  assert.match(source, /DELETE FROM organizations WHERE id=\$1/);
  assert.match(source, /RETAINED TEST IDENTITY/);
  assert.match(source, /onboarded_at/);
  assert.match(source, /INSERT INTO organizations[\s\S]*INSERT INTO org_members/);
  assert.match(source, /SELECT id FROM users WHERE email=\$1/);
  assert.match(source, /cleanupErrors/);
  assert.match(source, /private-r2/);
  assert.match(source, /config\.storageMode, "r2"/);
  assert.match(source, /storage\.stat/);
  assert.match(source, /storage\.get/);
  assert.match(source, /R2 readback SHA mismatch/);
  assert.match(source, /managed-mobile-auth-hydration-manifest\/v1/);
  assert.match(source, /manifest_key/);
  assert.match(source, /manifest_sha256/);
  assert.ok(source.indexOf('cleanupStep("pool"') < source.indexOf("const cleanup = receipt.cleanup"),
    "pool close outcome must precede final cleanup result");
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

test("mobile evidence runner has a truthful exact-SHA external image contract", () => {
  assert.match(evidenceDockerfile, /ARG EVIDENCE_SOURCE_SHA/);
  assert.match(evidenceDockerfile, /org\.opencontainers\.image\.revision=\$EVIDENCE_SOURCE_SHA/);
  assert.match(evidenceDockerfile, /npx playwright install --with-deps chromium/);
  assert.match(evidenceDockerfile, /playwright['"]\)\.chromium\.executablePath/);
  assert.match(evidenceDockerfile, /ENTRYPOINT \["npx", "tsx", "scripts\/managed-mobile-auth-hydration\.ts"\]/);
});
