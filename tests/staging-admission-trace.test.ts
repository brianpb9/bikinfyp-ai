import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_STAGING_TRACE_HEADER,
  MANAGED_STAGING_WEB_SERVICE_ID,
  authorizedManagedStagingZeroValueAdmission,
  managedStagingTraceHeader,
} from "../lib/staging-admission-trace";

const sha = "a".repeat(40);
const secret = "managed-staging-existing-auth-secret";
const env: NodeJS.ProcessEnv = { NODE_ENV: "production", RACUN_DEPLOY_ENV: "staging", RENDER_SERVICE_ID: MANAGED_STAGING_WEB_SERVICE_ID, RENDER_GIT_COMMIT: sha, AUTH_SECRET: secret };
const request = (value: string) => new Request("https://staging.invalid/api/jobs", { headers: { [MANAGED_STAGING_TRACE_HEADER]: value } });
const now = 1_788_000_000_000;
const intent = { userId: "trace-user", scriptId: "trace-script", format: "hands_only", qualityTier: "high_quality", durationS: 15 };

test("zero-value admission needs exact staging identity, request binding, and short expiry", () => {
  const signed = managedStagingTraceHeader(secret, sha, intent, { nowMs: now, nonce: "c".repeat(32) });
  assert.deepEqual(authorizedManagedStagingZeroValueAdmission(request(signed), intent, env, now), { nonce: "c".repeat(32), expiresAtMs: now + 300_000 });
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), intent, { ...env, RACUN_DEPLOY_ENV: "production" }, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), intent, { ...env, RENDER_SERVICE_ID: "srv-sibling" }, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), intent, { ...env, RENDER_GIT_COMMIT: "b".repeat(40) }, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), { ...intent, userId: "other-user" }, env, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), { ...intent, durationS: 30 }, env, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), intent, env, now + 300_001), null);
  const tampered = `${signed.slice(0, -1)}${signed.endsWith("0") ? "1" : "0"}`;
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(tampered), intent, env, now), null);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(""), intent, env, now), null);
});

test("canonical route atomically claims the nonce before zero-value admission", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../app/api/jobs/route.ts", import.meta.url), "utf8"));
  assert.match(source, /claimManagedStagingTraceNonce\(traceCapability\.nonce, traceCapability\.expiresAtMs\)/);
});
