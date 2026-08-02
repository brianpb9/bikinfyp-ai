/**
 * Production-only PostgreSQL migration runner.
 *
 * This is deliberately not a relaxation of migrate-postgres-runtime.mjs:
 * that runner remains staging-only. Production requires an environment marker,
 * an explicit acknowledgement, and supports a non-mutating dry-run.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
if (args.some((arg) => arg !== "--dry-run")) {
  throw new Error("Argumen tidak dikenal. Gunakan hanya --dry-run.");
}
if (process.env.RACUN_DEPLOY_ENV !== "production") {
  throw new Error("Migrasi production ditolak: RACUN_DEPLOY_ENV harus bernilai production.");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Migrasi production memerlukan DATABASE_URL PostgreSQL.");
}
const migrationDir = path.join(process.cwd(), "migrations", "postgres");
const names = (await readdir(migrationDir)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
if (!names.length) throw new Error("Tidak ada migration PostgreSQL.");
const migrations = await Promise.all(names.map(async (name) => ({
  name,
  version: name.slice(0, -4),
  sql: await readFile(path.join(migrationDir, name), "utf8"),
})));
for (const migration of migrations) migration.checksum = createHash("sha256").update(migration.sql).digest("hex");

const pool = new Pool({ connectionString: databaseUrl });
try {
  const hasLedger = (await pool.query("SELECT to_regclass('public.schema_migrations') AS table")).rows[0].table !== null;
  if (!hasLedger && dryRun) {
    console.log(JSON.stringify({ status: "DRY_RUN", schema_migrations: "absent", would_apply: names, skipped: [] }));
    process.exitCode = 0;
  } else {
    // Apply approval is required only if this invocation would change schema.
    // This lets a later checksum-only verification run without retaining a
    // dangerous approval token in the service environment.
    const recorded = hasLedger
      ? await pool.query("SELECT version, checksum FROM schema_migrations")
      : { rows: [] };
    const recordedChecksums = new Map(recorded.rows.map((row) => [row.version, row.checksum]));
    const pending = migrations.filter((migration) => {
      const checksum = recordedChecksums.get(migration.version);
      if (checksum && checksum !== migration.checksum) {
        throw new Error(`Checksum migrasi berubah setelah diterapkan: ${migration.name}`);
      }
      return !checksum;
    });
    if (!dryRun && pending.length && process.env.RACUN_PRODUCTION_MIGRATION_CONFIRM !== "APPLY_PRODUCTION_MIGRATIONS") {
      throw new Error("Apply ditolak: set RACUN_PRODUCTION_MIGRATION_CONFIRM=APPLY_PRODUCTION_MIGRATIONS setelah approval eksplisit.");
    }
    if (!hasLedger) await pool.query("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const applied = [];
    const skipped = [];
    for (const migration of migrations) {
      const existing = await pool.query("SELECT checksum FROM schema_migrations WHERE version=$1", [migration.version]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`Checksum migrasi berubah setelah diterapkan: ${migration.name}`);
        skipped.push(migration.name);
        continue;
      }
      if (dryRun) { applied.push(migration.name); continue; }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Lock and re-check prevents two approved deploy hooks applying twice.
        const locked = await client.query("SELECT checksum FROM schema_migrations WHERE version=$1 FOR UPDATE", [migration.version]);
        if (locked.rowCount) {
          if (locked.rows[0].checksum !== migration.checksum) throw new Error(`Checksum migrasi berubah setelah diterapkan: ${migration.name}`);
          skipped.push(migration.name);
        } else {
          await client.query(migration.sql);
          await client.query("INSERT INTO schema_migrations (version,checksum) VALUES ($1,$2)", [migration.version, migration.checksum]);
          applied.push(migration.name);
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
    }
    console.log(JSON.stringify({ status: dryRun ? "DRY_RUN" : "PASS", ...(dryRun ? { would_apply: applied } : { applied }), skipped }));
  }
} finally { await pool.end(); }
