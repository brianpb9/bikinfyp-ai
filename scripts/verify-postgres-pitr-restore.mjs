/**
 * Read-only reconciliation for a Render PostgreSQL PITR drill.
 *
 * Compare the production source with its restored clone.  It intentionally
 * prints only aggregate counts and mismatch totals: no email, ledger entry,
 * credit balance, or credential is emitted into operational evidence.
 */
import pg from "pg";

const { Pool } = pg;
const sourceUrl = process.env.SOURCE_DATABASE_URL;
const restoredUrl = process.env.RESTORED_DATABASE_URL;
for (const [name, value] of Object.entries({ SOURCE_DATABASE_URL: sourceUrl, RESTORED_DATABASE_URL: restoredUrl })) {
  if (!value || !/^postgres(?:ql)?:\/\//i.test(value)) throw new Error(`${name} PostgreSQL wajib diisi.`);
}

const source = new Pool({ connectionString: sourceUrl });
const restored = new Pool({ connectionString: restoredUrl });
const query = async (pool, sql, values) => (await pool.query(sql, values)).rows;

async function publicTables(pool) {
  return (await query(pool, `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).map((row) => row.tablename);
}

async function tableCounts(pool, tables) {
  const result = {};
  for (const table of tables) {
    // table names come solely from pg_catalog, then are identifier-quoted.
    result[table] = Number((await query(pool, `SELECT count(*)::bigint AS count FROM public."${table.replaceAll('"', '""')}"`))[0].count);
  }
  return result;
}

async function migrations(pool) {
  const exists = (await query(pool, "SELECT to_regclass('public.schema_migrations') AS table"))[0].table;
  if (!exists) return null;
  return query(pool, "SELECT version, checksum FROM schema_migrations ORDER BY version");
}

async function balances(pool) {
  return query(pool, `
    SELECT u.id::text AS user_id, COALESCE(SUM(l.delta), 0)::bigint AS balance
    FROM users u
    LEFT JOIN credit_ledger l ON l.user_id=u.id
    GROUP BY u.id
    ORDER BY u.id
  `);
}

async function foreignKeyViolations(pool) {
  const constraints = await query(pool, `
    SELECT c.conname, n.nspname AS schema_name, rel.relname AS table_name,
      array_agg(att.attname ORDER BY key.ord) AS local_columns,
      rns.nspname AS ref_schema, rrel.relname AS ref_table,
      array_agg(ratt.attname ORDER BY key.ord) AS ref_columns
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=rel.relnamespace
    JOIN pg_class rrel ON rrel.oid=c.confrelid
    JOIN pg_namespace rns ON rns.oid=rrel.relnamespace
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=key.attnum
    JOIN LATERAL unnest(c.confkey) WITH ORDINALITY AS refkey(attnum, ord) ON refkey.ord=key.ord
    JOIN pg_attribute ratt ON ratt.attrelid=rrel.oid AND ratt.attnum=refkey.attnum
    WHERE c.contype='f' AND n.nspname='public'
    GROUP BY c.conname, n.nspname, rel.relname, rns.nspname, rrel.relname
    ORDER BY c.conname
  `);
  const results = [];
  for (const constraint of constraints) {
    // node-postgres can return a PostgreSQL text[] as either an array or its
    // wire representation depending on the installed type parser.
    const columns = (value) => Array.isArray(value)
      ? value
      : String(value).replace(/^\{/, "").replace(/\}$/, "").split(",");
    const localColumns = columns(constraint.local_columns);
    const refColumns = columns(constraint.ref_columns);
    const joins = localColumns.map((column, index) =>
      `child."${column.replaceAll('"', '""')}" = parent."${refColumns[index].replaceAll('"', '""')}"`).join(" AND ");
    const required = localColumns.map((column) => `child."${column.replaceAll('"', '""')}" IS NOT NULL`).join(" AND ");
    const count = Number((await query(pool, `SELECT count(*)::bigint AS count FROM "${constraint.schema_name}"."${constraint.table_name}" child LEFT JOIN "${constraint.ref_schema}"."${constraint.ref_table}" parent ON ${joins} WHERE ${required} AND parent."${refColumns[0].replaceAll('"', '""')}" IS NULL`))[0].count);
    results.push({ constraint: constraint.conname, violations: count });
  }
  return results;
}

try {
  const [sourceTables, restoredTables, sourceMigrations, restoredMigrations, sourceBalances, restoredBalances, sourceFks, restoredFks] = await Promise.all([
    publicTables(source), publicTables(restored), migrations(source), migrations(restored), balances(source), balances(restored), foreignKeyViolations(source), foreignKeyViolations(restored),
  ]);
  const allTables = [...new Set([...sourceTables, ...restoredTables])].sort();
  const [sourceCounts, restoredCounts] = await Promise.all([tableCounts(source, allTables), tableCounts(restored, allTables)]);
  const balanceMismatchCount = (() => {
    const sourceMap = new Map(sourceBalances.map((row) => [row.user_id, String(row.balance)]));
    const restoredMap = new Map(restoredBalances.map((row) => [row.user_id, String(row.balance)]));
    return [...new Set([...sourceMap.keys(), ...restoredMap.keys()])].filter((id) => sourceMap.get(id) !== restoredMap.get(id)).length;
  })();
  const result = {
    status: JSON.stringify(sourceTables) === JSON.stringify(restoredTables)
      && JSON.stringify(sourceCounts) === JSON.stringify(restoredCounts)
      && JSON.stringify(sourceMigrations) === JSON.stringify(restoredMigrations)
      && balanceMismatchCount === 0
      && [...sourceFks, ...restoredFks].every((row) => row.violations === 0) ? "PASS" : "FAIL",
    tables: { source: sourceCounts, restored: restoredCounts },
    migration_checksum_match: JSON.stringify(sourceMigrations) === JSON.stringify(restoredMigrations),
    balances: { source_users: sourceBalances.length, restored_users: restoredBalances.length, mismatched_users: balanceMismatchCount },
    foreign_key_violations: { source: sourceFks, restored: restoredFks },
  };
  console.log(JSON.stringify(result));
  if (result.status !== "PASS") process.exitCode = 1;
} finally {
  await Promise.all([source.end(), restored.end()]);
}
