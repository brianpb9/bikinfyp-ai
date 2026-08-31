const crypto = require("node:crypto");

const canonical = (value) => Object.fromEntries(
  Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
);

/**
 * Return a non-secret identity for the physical PostgreSQL cluster/database.
 * No host, URL, username, address, or credential leaves this function.
 */
async function postgresRuntimeBinding(queryable) {
  const result = await queryable.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num') AS server_version_num,
           (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier
  `);
  const row = result.rows[0];
  if (!row?.database_name || !row?.server_version_num || !row?.system_identifier) {
    throw new Error("POSTGRES_RUNTIME_BINDING_INCOMPLETE");
  }
  const privateIdentity = canonical({
    database_name: String(row.database_name),
    server_version_num: String(row.server_version_num),
    system_identifier: String(row.system_identifier),
  });
  return {
    sha256: crypto.createHash("sha256").update(JSON.stringify(privateIdentity)).digest("hex"),
    components: ["database_name", "server_version_num", "system_identifier"],
  };
}

module.exports = { postgresRuntimeBinding };
