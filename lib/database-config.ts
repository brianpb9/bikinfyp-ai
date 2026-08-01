/**
 * Database-runtime guard for the staged SQLite -> PostgreSQL migration.
 *
 * Checkpoint 1A deliberately keeps the SQLite adapter alive for local
 * development and tests. It must never become an implicit production
 * fallback while the PostgreSQL adapter is still being introduced.
 */
export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export function isPostgresDatabaseUrl(value: string | undefined): boolean {
  return Boolean(value && /^(postgres|postgresql):\/\//i.test(value));
}

/**
 * The current adapter is better-sqlite3. Calling this before opening it makes
 * a production misconfiguration fail closed instead of silently creating a
 * local database on an ephemeral disk.
 */
export function assertLegacySqliteRuntimeAllowed(
  env: Partial<Pick<NodeJS.ProcessEnv, "NODE_ENV" | "DATABASE_URL">> = process.env
): void {
  if (env.NODE_ENV !== "production") return;

  if (!env.DATABASE_URL) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL wajib di production; fallback SQLite (DB_PATH) ditolak."
    );
  }

  if (!isPostgresDatabaseUrl(env.DATABASE_URL)) {
    throw new DatabaseConfigurationError(
      "DATABASE_URL production harus memakai skema postgres:// atau postgresql://."
    );
  }

  throw new DatabaseConfigurationError(
    "Adapter SQLite dinonaktifkan di production. Lanjutkan checkpoint migrasi PostgreSQL sebelum menjalankan aplikasi production."
  );
}
