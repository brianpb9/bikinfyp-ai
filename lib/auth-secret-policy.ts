const DEFAULT_DEV_SECRET = "dev-secret-racun-ai-jangan-dipakai-produksi";
const MIN_SECRET_BYTES = 32;

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretConfigurationError";
  }
}

export function assertAuthSecretSafe(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "AUTH_SECRET">> = process.env
): void {
  if (env.NODE_ENV !== "production") return;
  const secret = env.AUTH_SECRET ?? "";
  if (!secret) {
    throw new SecretConfigurationError("AUTH_SECRET wajib diisi di production — tidak ada nilai bawaan yang aman.");
  }
  if (secret === DEFAULT_DEV_SECRET) {
    throw new SecretConfigurationError("AUTH_SECRET masih memakai nilai bawaan pengembangan. Ganti sebelum deploy.");
  }
  const len = new TextEncoder().encode(secret).byteLength;
  if (len < MIN_SECRET_BYTES) {
    throw new SecretConfigurationError(
      `AUTH_SECRET terlalu pendek (${len} byte). Minimal ${MIN_SECRET_BYTES} byte acak.`
    );
  }
}

/** Read and validate on every use so runtime rotation/removal cannot be hidden
 * by an import-time snapshot. Outside production the established dev fallback
 * remains available. */
export function runtimeAuthSecret(): string {
  assertAuthSecretSafe(process.env);
  return process.env.AUTH_SECRET || DEFAULT_DEV_SECRET;
}
