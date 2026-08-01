/**
 * Checkpoint 1D only: copy a SQLite snapshot into a PostgreSQL database that
 * has already received the versioned migrations, then prove the copy is
 * complete.  It deliberately has no imports from runtime repositories/routes.
 *
 * Required environment:
 *   SQLITE_SOURCE_PATH=/absolute/path/to/racun.db
 *   DATABASE_URL=postgresql://... (loopback guard is enforced by the shell)
 */
import Database from "better-sqlite3";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

const tables = [
  "users",
  "products",
  "personas",
  "scripts",
  "jobs",
  "outputs",
  "credit_ledger",
  "payments",
  "otp_codes",
  "audit_log",
] as const;

type Table = (typeof tables)[number];
const columns: Record<Table, readonly string[]> = {
  users: ["id", "phone", "email", "name", "tier", "locale", "created_at"],
  products: ["id", "user_id", "source_url", "name", "price_idr", "category", "product_visual_desc", "images", "raw_meta", "created_at"],
  personas: ["id", "user_id", "name", "creator_category", "voice_id", "register", "created_at"],
  scripts: ["id", "job_id", "product_id", "hook_family", "emotion", "register", "segments", "caption", "hashtags", "validation_result", "quality_tier", "approved_by_user_at", "edited_by_user", "created_at"],
  jobs: ["id", "user_id", "product_id", "persona_id", "script_id", "format", "quality_tier", "duration_s", "state", "provider_video", "provider_voice", "cost_actual_idr", "qc_result", "output_url", "qc_retry_count", "created_at", "completed_at", "state_changed_at"],
  outputs: ["job_id", "video_url", "caption", "hashtags", "suggested_post_time", "compliance_checklist"],
  credit_ledger: ["id", "user_id", "delta", "type", "job_id", "payment_id", "created_at"],
  payments: ["id", "user_id", "gateway", "gateway_ref", "amount_idr", "credits", "status", "raw_payload", "created_at"],
  otp_codes: ["id", "email", "code_hash", "expires_at", "attempts", "created_at"],
  audit_log: ["id", "actor", "action", "entity", "entity_id", "meta", "created_at"],
};

const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const sourcePath = path.resolve(process.env.SQLITE_SOURCE_PATH ?? "");
const databaseUrl = process.env.DATABASE_URL;
if (!process.env.SQLITE_SOURCE_PATH || !fs.existsSync(sourcePath)) throw new Error("SQLITE_SOURCE_PATH harus menunjuk file SQLite yang ada.");
if (!databaseUrl) throw new Error("DATABASE_URL PostgreSQL wajib diisi.");

function sourceForeignKeyErrors(db: Database.Database) {
  return db.prepare("PRAGMA foreign_key_check").all() as unknown[];
}

function sourceBalances(db: Database.Database) {
  return db.prepare(`SELECT u.id AS user_id, COALESCE(SUM(l.delta), 0) AS balance
    FROM users u LEFT JOIN credit_ledger l ON l.user_id = u.id
    GROUP BY u.id ORDER BY u.id`).all() as { user_id: string; balance: number }[];
}

async function targetForeignKeyErrors(client: Client) {
  const checks: Record<string, string> = {
    credit_ledger_user: "SELECT l.id FROM credit_ledger l LEFT JOIN users u ON u.id=l.user_id WHERE u.id IS NULL",
    payments_user: "SELECT p.id FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL",
    products_user: "SELECT p.id FROM products p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL",
    personas_user: "SELECT p.id FROM personas p LEFT JOIN users u ON u.id=p.user_id WHERE u.id IS NULL",
    scripts_product: "SELECT s.id FROM scripts s LEFT JOIN products p ON p.id=s.product_id WHERE p.id IS NULL",
    jobs_user: "SELECT j.id FROM jobs j LEFT JOIN users u ON u.id=j.user_id WHERE u.id IS NULL",
    jobs_product: "SELECT j.id FROM jobs j LEFT JOIN products p ON p.id=j.product_id WHERE p.id IS NULL",
    jobs_persona: "SELECT j.id FROM jobs j LEFT JOIN personas p ON p.id=j.persona_id WHERE j.persona_id IS NOT NULL AND p.id IS NULL",
    jobs_script: "SELECT j.id FROM jobs j LEFT JOIN scripts s ON s.id=j.script_id WHERE s.id IS NULL",
    outputs_job: "SELECT o.job_id FROM outputs o LEFT JOIN jobs j ON j.id=o.job_id WHERE j.id IS NULL",
  };
  const result: Record<string, number> = {};
  for (const [name, query] of Object.entries(checks)) result[name] = (await client.query(query)).rowCount ?? 0;
  return result;
}

async function main() {
  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const client = new Client({ connectionString: databaseUrl });
  try {
    for (const table of tables) {
      const actual = (sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((row) => row.name);
      for (const column of columns[table]) if (!actual.includes(column)) throw new Error(`SQLite sumber ${table} tidak punya kolom wajib ${column}.`);
    }
    const sqliteFk = sourceForeignKeyErrors(sqlite);
    if (sqliteFk.length) throw new Error(`SQLite sumber memiliki ${sqliteFk.length} FK orphan; rehearsal dihentikan.`);

    await client.connect();
    const targetInitialCounts: Record<string, number> = {};
    for (const table of tables) targetInitialCounts[table] = Number((await client.query(`SELECT count(*)::int AS count FROM ${quote(table)}`)).rows[0].count);
    if (Object.values(targetInitialCounts).some(Boolean)) throw new Error("Target PostgreSQL rehearsal harus kosong setelah migration.");

    await client.query("BEGIN");
    try {
      for (const table of tables) {
        const names = columns[table];
        const rows = sqlite.prepare(`SELECT ${names.map(quote).join(", ")} FROM ${quote(table)}`).all() as Record<string, unknown>[];
        if (!rows.length) continue;
        const placeholders = names.map((_, index) => `$${index + 1}`).join(", ");
        const sql = `INSERT INTO ${quote(table)} (${names.map(quote).join(", ")}) VALUES (${placeholders})`;
        for (const row of rows) await client.query(sql, names.map((name) => row[name]));
        // Test hook for the rehearsal harness: proves a failed copy leaves no
        // partial rows because all inserts share the transaction above.
        if (process.env.REHEARSAL_FAIL_AFTER_TABLE === table) throw new Error(`Forced rehearsal failure after ${table}`);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    const counts: Record<string, { sqlite: number; postgres: number }> = {};
    for (const table of tables) {
      const source = Number((sqlite.prepare(`SELECT count(*) AS count FROM ${quote(table)}`).get() as { count: number }).count);
      const target = Number((await client.query(`SELECT count(*)::int AS count FROM ${quote(table)}`)).rows[0].count);
      counts[table] = { sqlite: source, postgres: target };
      if (source !== target) throw new Error(`Jumlah baris berbeda pada ${table}: SQLite=${source}, PostgreSQL=${target}`);
    }

    const sqliteBalance = sourceBalances(sqlite).map(({ user_id, balance }) => ({ user_id, balance: String(balance) }));
    const postgresBalance = (await client.query(`SELECT u.id AS user_id, COALESCE(SUM(l.delta), 0)::text AS balance
      FROM users u LEFT JOIN credit_ledger l ON l.user_id = u.id GROUP BY u.id ORDER BY u.id`)).rows;
    if (JSON.stringify(sqliteBalance) !== JSON.stringify(postgresBalance)) throw new Error("Saldo per user berbeda antara SQLite dan PostgreSQL.");

    const postgresFk = await targetForeignKeyErrors(client);
    if (Object.values(postgresFk).some(Boolean)) throw new Error(`PostgreSQL memiliki FK orphan: ${JSON.stringify(postgresFk)}`);
    process.stdout.write(`${JSON.stringify({ source: sourcePath, counts, balances_checked: sqliteBalance.length, sqlite_fk_orphans: sqliteFk.length, postgres_fk_orphans: postgresFk })}\n`);
  } finally {
    sqlite.close();
    await client.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
