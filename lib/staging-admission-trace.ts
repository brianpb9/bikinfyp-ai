import crypto from "node:crypto";

export const MANAGED_STAGING_WEB_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
export const MANAGED_STAGING_TRACE_TASK = "P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826";
export const MANAGED_STAGING_TRACE_HEADER = "x-racun-managed-staging-trace";

function signature(secret: string, sha: string): string {
  return crypto.createHmac("sha256", secret).update(`${MANAGED_STAGING_TRACE_TASK}:${sha}`).digest("hex");
}

export function managedStagingTraceHeader(secret: string, sha: string): string {
  return `${MANAGED_STAGING_TRACE_TASK}:${sha}:${signature(secret, sha)}`;
}

/** Existing AUTH_SECRET authenticates the internal request; this adds no key. */
export function authorizedManagedStagingZeroValueAdmission(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV !== "production" || env.RACUN_DEPLOY_ENV !== "staging") return false;
  if (env.RENDER_SERVICE_ID !== MANAGED_STAGING_WEB_SERVICE_ID) return false;
  const liveSha = env.RENDER_GIT_COMMIT?.trim() ?? "";
  const secret = env.AUTH_SECRET ?? "";
  if (!/^[0-9a-f]{40}$/.test(liveSha) || secret.length < 16) return false;
  const raw = request.headers.get(MANAGED_STAGING_TRACE_HEADER) ?? "";
  const parts = raw.split(":");
  if (parts.length !== 3 || parts[0] !== MANAGED_STAGING_TRACE_TASK || parts[1] !== liveSha) return false;
  const expected = signature(secret, liveSha);
  if (!/^[0-9a-f]{64}$/.test(parts[2])) return false;
  return crypto.timingSafeEqual(Buffer.from(parts[2], "hex"), Buffer.from(expected, "hex"));
}
