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

test("zero-value admission needs exact staging web identity, SHA, and existing-secret HMAC", () => {
  const signed = managedStagingTraceHeader(secret, sha);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), env), true);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), { ...env, RACUN_DEPLOY_ENV: "production" }), false);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), { ...env, RENDER_SERVICE_ID: "srv-sibling" }), false);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(signed), { ...env, RENDER_GIT_COMMIT: "b".repeat(40) }), false);
  const tampered = `${signed.slice(0, -1)}${signed.endsWith("0") ? "1" : "0"}`;
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(tampered), env), false);
  assert.equal(authorizedManagedStagingZeroValueAdmission(request(""), env), false);
});
