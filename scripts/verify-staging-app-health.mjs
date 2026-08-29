import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const STAGING_HEALTH_URL = "https://racun-ai-staging-web.onrender.com/api/health";

export function verifyStagingHealth(payload, expectedSha) {
  assert.match(expectedSha, /^[0-9a-f]{40}$/, "EXPECTED_APP_SHA must be a full SHA");
  assert.equal(payload?.ok, true, "public staging health must be ok");
  assert.equal(payload?.build_sha, expectedSha, "public staging build SHA mismatch");
  assert.equal(payload?.intake, "open", "public staging intake must be open for evidence");
  assert.equal(payload?.payments_env, "sandbox", "public staging payments must remain sandboxed");
  assert.equal(payload?.payments_live, false, "public staging payments must remain non-live");
  return { app_sha_verified: true, canonical_origin_verified: true, payments_non_live_verified: true };
}

export async function runStagingHealthPreflight({
  expectedSha = process.env.EXPECTED_APP_SHA ?? "",
  fetchImpl = fetch,
} = {}) {
  assert.match(expectedSha, /^[0-9a-f]{40}$/, "EXPECTED_APP_SHA must be a full SHA");
  const response = await fetchImpl(STAGING_HEALTH_URL, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, "public staging health must return 200");
  assert.equal(response.url, STAGING_HEALTH_URL, "public staging health origin/path mismatch");
  assert.equal(response.redirected, false, "public staging health must not redirect");
  return verifyStagingHealth(await response.json(), expectedSha);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runStagingHealthPreflight();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
