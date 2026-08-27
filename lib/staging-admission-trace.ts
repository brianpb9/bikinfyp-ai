import crypto from "node:crypto";

export const MANAGED_STAGING_WEB_SERVICE_ID = "srv-d9n28tijnfac73a87lt0";
export const MANAGED_STAGING_TRACE_TASK = "P0-POST-E2-PARITY-ADMISSION-WORKER-TRACE-20260826";
export const MANAGED_STAGING_TRACE_HEADER = "x-racun-managed-staging-trace";
export const MANAGED_STAGING_TRACE_TTL_MS = 5 * 60_000;

export type ManagedStagingTraceIntent = {
  userId: string;
  scriptId: string;
  format: string;
  qualityTier: string;
  durationS: number;
};

type ManagedStagingTraceAuthorizationContext = {
  env: NodeJS.ProcessEnv;
  nowMs: number;
};
let authorizationContextForTests: ManagedStagingTraceAuthorizationContext | undefined;

/** Lets an HTTP test exercise the real production signature verifier without
 * globally switching NODE_ENV to production (which correctly disables the
 * SQLite adapter). Never called by application runtime code. */
export function setManagedStagingTraceAuthorizationContextForTests(
  context?: ManagedStagingTraceAuthorizationContext,
): void {
  authorizationContextForTests = context;
}

function signature(secret: string, sha: string, expiresAtMs: number, nonce: string, intent: ManagedStagingTraceIntent): string {
  const bound = JSON.stringify({ task: MANAGED_STAGING_TRACE_TASK, sha, expiresAtMs, nonce, ...intent });
  return crypto.createHmac("sha256", secret).update(bound).digest("hex");
}

export function managedStagingTraceHeader(
  secret: string,
  sha: string,
  intent: ManagedStagingTraceIntent,
  options: { nowMs?: number; nonce?: string } = {},
): string {
  const expiresAtMs = (options.nowMs ?? Date.now()) + MANAGED_STAGING_TRACE_TTL_MS;
  const nonce = options.nonce ?? crypto.randomBytes(16).toString("hex");
  return `${MANAGED_STAGING_TRACE_TASK}:${sha}:${expiresAtMs}:${nonce}:${signature(secret, sha, expiresAtMs, nonce, intent)}`;
}

/** Existing AUTH_SECRET authenticates the internal request; this adds no key. */
export function authorizedManagedStagingZeroValueAdmission(
  request: Request,
  intent: ManagedStagingTraceIntent,
  env: NodeJS.ProcessEnv = authorizationContextForTests?.env ?? process.env,
  nowMs = authorizationContextForTests?.nowMs ?? Date.now(),
): { nonce: string; expiresAtMs: number } | null {
  if (env.NODE_ENV !== "production" || env.RACUN_DEPLOY_ENV !== "staging") return null;
  if (env.RENDER_SERVICE_ID !== MANAGED_STAGING_WEB_SERVICE_ID) return null;
  const liveSha = env.RENDER_GIT_COMMIT?.trim() ?? "";
  const secret = env.AUTH_SECRET ?? "";
  if (!/^[0-9a-f]{40}$/.test(liveSha) || secret.length < 16) return null;
  const raw = request.headers.get(MANAGED_STAGING_TRACE_HEADER) ?? "";
  const parts = raw.split(":");
  if (parts.length !== 5 || parts[0] !== MANAGED_STAGING_TRACE_TASK || parts[1] !== liveSha) return null;
  const expiresAtMs = Number(parts[2]);
  const nonce = parts[3];
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs > nowMs + MANAGED_STAGING_TRACE_TTL_MS) return null;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(parts[4])) return null;
  const expected = signature(secret, liveSha, expiresAtMs, nonce, intent);
  if (!crypto.timingSafeEqual(Buffer.from(parts[4], "hex"), Buffer.from(expected, "hex"))) return null;
  return { nonce, expiresAtMs };
}
