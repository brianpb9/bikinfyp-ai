import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../scripts/managed-mobile-auth-hydration.ts", import.meta.url), "utf8");

test("managed mobile runner is exact-SHA, 375px, provider-free, and cleanup-bound", () => {
  assert.match(source, /RENDER_GIT_COMMIT[\s\S]*EXPECTED_SHA/);
  assert.match(source, /RACUN_DEPLOY_ENV[\s\S]*staging/);
  assert.match(source, /width: 375, height: 812/);
  assert.match(source, /width: 375, height: 520/);
  assert.match(source, /page\.route\("\*\*\/api\/auth\/request-otp"/);
  assert.match(source, /setTimeout\(resolve, 900\)/);
  assert.match(source, /wrong\.status\(\), 401/);
  assert.match(source, /correct\.status\(\), 200/);
  assert.match(source, /aria-expanded/);
  assert.match(source, /keyboard\.press\("Escape"\)/);
  assert.match(source, /document\.activeElement === element/);
  assert.match(source, /hydration\|content security policy\|csp\|evalerror/i);
  assert.match(source, /'koreksi'/);
  assert.match(source, /DELETE FROM otp_codes/);
  assert.match(source, /DELETE FROM org_members/);
  assert.match(source, /DELETE FROM organizations/);
  assert.match(source, /DELETE FROM users/);
  assert.doesNotMatch(source, /createDuitkuInvoice|createMidtransTransaction|enqueueJob/);
});
