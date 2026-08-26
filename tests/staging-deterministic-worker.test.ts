import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_STAGING_WORKER_SERVICE_ID,
  managedStagingDeterministicWorkerGate,
} from "../lib/staging-deterministic-worker";

const sha = "0123456789abcdef0123456789abcdef01234567";
const stagingWorker: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  RACUN_WORKER_DETERMINISTIC: "1",
  RACUN_DEPLOY_ENV: "staging",
  RENDER_SERVICE_ID: MANAGED_STAGING_WORKER_SERVICE_ID,
  RACUN_STAGING_DETERMINISTIC_SHA: sha,
  RENDER_GIT_COMMIT: sha,
};

test("managed staging deterministic worker requires exact service identity and SHA", () => {
  assert.deepEqual(managedStagingDeterministicWorkerGate(stagingWorker), {
    allowed: true,
    reason: "exact_managed_staging_worker_sha",
  });
});

test("managed fixture fails closed in production", () => {
  const result = managedStagingDeterministicWorkerGate({ ...stagingWorker, RACUN_DEPLOY_ENV: "production" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "not_staging");
});

test("managed fixture fails closed on web or sibling service", () => {
  const result = managedStagingDeterministicWorkerGate({ ...stagingWorker, RENDER_SERVICE_ID: "srv-d9n28tijnfac73a87lt0" });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "wrong_service_identity");
});

test("managed fixture fails closed on wrong branch/SHA", () => {
  const result = managedStagingDeterministicWorkerGate({ ...stagingWorker, RENDER_GIT_COMMIT: "f".repeat(40) });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "wrong_live_sha");
});

test("managed fixture fails closed without exact staging identity", () => {
  const missingIdentity = { ...stagingWorker };
  delete missingIdentity.RENDER_SERVICE_ID;
  assert.equal(managedStagingDeterministicWorkerGate(missingIdentity).allowed, false);
  const missingSha = { ...stagingWorker };
  delete missingSha.RACUN_STAGING_DETERMINISTIC_SHA;
  assert.equal(managedStagingDeterministicWorkerGate(missingSha).allowed, false);
});

test("local disposable integration fixture remains available", () => {
  assert.deepEqual(managedStagingDeterministicWorkerGate({
    NODE_ENV: "test",
    RACUN_WORKER_DETERMINISTIC: "1",
  }), { allowed: true, reason: "local_non_production_fixture" });
});
