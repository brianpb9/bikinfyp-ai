/**
 * Applies the immutable PostgreSQL migrations from a Render pre-deploy hook.
 *
 * This is intentionally separate from scripts/migrate-postgres.sh: that shell
 * script is loopback-only for local safety, while this runner is fail-closed
 * unless the explicit staging deployment marker is present.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

if (process.env.RACUN_DEPLOY_ENV !== "staging") {
  throw new Error("Migrasi runtime ditolak: RACUN_DEPLOY_ENV harus bernilai staging.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Migrasi runtime memerlukan DATABASE_URL PostgreSQL.");
}

const migrationDir = path.join(process.cwd(), "migrations", "postgres");
const migrationNames = (await readdir(migrationDir))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();

if (migrationNames.length === 0) throw new Error("Tidak ada migration PostgreSQL.");

const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = [];
  const skipped = [];
  for (const name of migrationNames) {
    const version = name.slice(0, -".sql".length);
    const sql = await readFile(path.join(migrationDir, name), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE version = $1 FOR UPDATE",
        [version]
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Checksum migrasi berubah setelah diterapkan: ${name}`);
        }
        await client.query("COMMIT");
        skipped.push(name);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [version, checksum]);
      await client.query("COMMIT");
      applied.push(name);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  // Deliberately do not print DATABASE_URL or any connection data.
  console.log(JSON.stringify({ status: "PASS", applied, skipped }));
} finally {
  await pool.end();
}
