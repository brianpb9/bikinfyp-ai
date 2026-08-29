import assert from "node:assert/strict";
import test from "node:test";
import { runStagingHealthPreflight, STAGING_HEALTH_URL } from "../scripts/verify-staging-app-health.mjs";

const sha = "a".repeat(40);
const response = (payload: unknown, status = 200) => ({ status, json: async () => payload });

test("public preflight binds exact staging SHA and non-live payment safety", async () => {
  let requested = "";
  const result = await runStagingHealthPreflight({ expectedSha: sha, fetchImpl: async (url) => {
    requested = String(url);
    return response({ build_sha: sha, deploy_env: "staging", payments_live: false });
  }});
  assert.equal(requested, STAGING_HEALTH_URL);
  assert.deepEqual(result, { app_sha_verified: true, staging_verified: true, payments_non_live_verified: true });
});

test("wrong deployed SHA, environment, payment safety, and HTTP status fail closed", async () => {
  for (const [name, payload, status] of [
    ["sha", { build_sha: "b".repeat(40), deploy_env: "staging", payments_live: false }, 200],
    ["environment", { build_sha: sha, deploy_env: "production", payments_live: false }, 200],
    ["payments", { build_sha: sha, deploy_env: "staging", payments_live: true }, 200],
    ["status", { build_sha: sha, deploy_env: "staging", payments_live: false }, 503],
  ] as const) {
    await assert.rejects(runStagingHealthPreflight({ expectedSha: sha, fetchImpl: async () => response(payload, status) }),
      undefined, name);
  }
});

test("malformed expected SHA fails before network", async () => {
  let calls = 0;
  await assert.rejects(runStagingHealthPreflight({ expectedSha: "not-a-sha", fetchImpl: async () => {
    calls++;
    return response({});
  }}));
  assert.equal(calls, 0);
});
