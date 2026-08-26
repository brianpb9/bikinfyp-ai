/**
 * Narrow managed-STAGING exception for a zero-provider worker trace.
 *
 * This is intentionally not a general feature flag.  A committed SHA must be
 * named explicitly and the process must be the one canonical staging worker.
 * Leaving the variables behind after a deploy is therefore fail-closed.
 */
export const MANAGED_STAGING_WORKER_SERVICE_ID = "srv-d9n28ue417fc73ch2b60";

export type DeterministicWorkerGate = {
  allowed: boolean;
  reason: string;
};

export function managedStagingDeterministicWorkerGate(
  env: NodeJS.ProcessEnv = process.env,
): DeterministicWorkerGate {
  if (env.RACUN_WORKER_DETERMINISTIC !== "1") {
    return { allowed: false, reason: "fixture_not_requested" };
  }

  // Keep the original local-test seam. It is useful for disposable databases
  // and cannot affect a deployed production-mode process.
  if (env.NODE_ENV !== "production") {
    return { allowed: true, reason: "local_non_production_fixture" };
  }

  if (env.RACUN_DEPLOY_ENV !== "staging") {
    return { allowed: false, reason: "not_staging" };
  }
  if (env.RENDER_SERVICE_ID !== MANAGED_STAGING_WORKER_SERVICE_ID) {
    return { allowed: false, reason: "wrong_service_identity" };
  }

  const expectedSha = env.RACUN_STAGING_DETERMINISTIC_SHA?.trim();
  const liveSha = env.RENDER_GIT_COMMIT?.trim();
  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    return { allowed: false, reason: "missing_or_invalid_expected_sha" };
  }
  if (!liveSha || liveSha !== expectedSha) {
    return { allowed: false, reason: "wrong_live_sha" };
  }
  return { allowed: true, reason: "exact_managed_staging_worker_sha" };
}
