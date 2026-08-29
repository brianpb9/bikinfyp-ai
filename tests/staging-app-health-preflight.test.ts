import assert from "node:assert/strict";
import test from "node:test";
import { runStagingHealthPreflight, STAGING_HEALTH_URL } from "../scripts/verify-staging-app-health.mjs";

const sha = "acf1fd49fadc3387c3ae6a13f711689f1e0d9397";
const response = (payload: unknown, status = 200, url = STAGING_HEALTH_URL, redirected = false): Response => {
  const result = Response.json(payload, { status });
  Object.defineProperties(result, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return result;
};
const liveAcfHealthFixture = {
  ok: true,
  intake: "open",
  payments_provider: "duitku",
  payments_env: "sandbox",
  payments_live: false,
  build_sha: sha,
  klasifikasi: { mampu: true, biner: { ffmpeg: true, ffprobe: true, tesseract: true }, bahasaOcr: true, smoke: true },
};

test("public preflight binds exact staging SHA and non-live payment safety", async () => {
  let requested = "";
  const result = await runStagingHealthPreflight({ expectedSha: sha, fetchImpl: async (url) => {
    requested = String(url);
    return response(liveAcfHealthFixture);
  }});
  assert.equal(requested, STAGING_HEALTH_URL);
  assert.deepEqual(result, { app_sha_verified: true, canonical_origin_verified: true, payments_non_live_verified: true });
});

test("wrong origin, deployed SHA, safety state, and HTTP status fail closed", async () => {
  for (const [name, payload, status, url] of [
    ["origin", liveAcfHealthFixture, 200, "https://example.invalid/api/health"],
    ["sha", { ...liveAcfHealthFixture, build_sha: "b".repeat(40) }, 200, STAGING_HEALTH_URL],
    ["ok", { ...liveAcfHealthFixture, ok: false }, 200, STAGING_HEALTH_URL],
    ["payments", { ...liveAcfHealthFixture, payments_live: true }, 200, STAGING_HEALTH_URL],
    ["payments-env", { ...liveAcfHealthFixture, payments_env: "production" }, 200, STAGING_HEALTH_URL],
    ["intake", { ...liveAcfHealthFixture, intake: "maintenance" }, 200, STAGING_HEALTH_URL],
    ["status", liveAcfHealthFixture, 503, STAGING_HEALTH_URL],
  ] as const) {
    await assert.rejects(
      runStagingHealthPreflight({ expectedSha: sha, fetchImpl: async () => response(payload, status, url) }),
      { name: "AssertionError" },
      name
    );
  }
  await assert.rejects(runStagingHealthPreflight({ expectedSha: sha,
    fetchImpl: async () => response(liveAcfHealthFixture, 200, STAGING_HEALTH_URL, true) }));
});

test("malformed expected SHA fails before network", async () => {
  let calls = 0;
  await assert.rejects(runStagingHealthPreflight({ expectedSha: "not-a-sha", fetchImpl: async () => {
    calls++;
    return response({});
  }}));
  assert.equal(calls, 0);
});
