/**
 * Real PostgreSQL regression for the C8 provider/setup evidence lease.
 *
 * Run against a disposable database:
 *   UJI_PG_URL=postgres://... npx tsx --test tests/pg-admission-evidence-lock.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";

process.env.RACUN_NO_DOTENV = "1";

const URL_UJI = process.env.UJI_PG_URL ?? "";

test("PostgreSQL nyata: advisory lease >15s menahan DELETE lalu cleanup mengusir sesi rusak", {
  skip: URL_UJI ? false : "UJI_PG_URL kosong; unit dependency-backed tetap dijalankan",
  timeout: 35_000,
}, async () => {
  const { setMediaStorageForTests } = await import("../lib/storage");
  const {
    acquireAdmissionReferenceEvidence,
    setEvidenceLockDependenciesForTests,
    withProductEvidenceMutationLock,
  } = await import("../lib/job-admission-reference");

  const schema = `c8_lock_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: URL_UJI, max: 2 });
  const evidencePool = new Pool({
    connectionString: URL_UJI,
    max: 2,
    idle_in_transaction_session_timeout: 15_000,
  });
  const productId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rel = "uploads/pg-real/packshot.webp";
  const bytes = Buffer.from("PACKSHOT-POSTGRES-REAL");
  const sidecar = Buffer.from(JSON.stringify({
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    jenis: "product_photo",
    layakReferensi: true,
    rasioAreaTeks: 0,
    jumlahKata: 0,
    alasan: "packshot",
    versiBukti: 1,
  }));
  const stored = new Map<string, Buffer>([[rel, bytes], [`${rel}.meta.json`, sidecar]]);
  setMediaStorageForTests({
    async put(key, body) { stored.set(key, Buffer.from(body)); },
    async delete(key) { stored.delete(key); },
    async get(key) {
      const body = stored.get(key);
      return body ? { body, size: body.length } : null;
    },
    async stat(key) {
      const body = stored.get(key);
      return body ? { size: body.length } : null;
    },
    async materialize() { return null; },
  });

  let injectUnlockFailure = false;
  const connect = async (): Promise<PoolClient> => {
    const real = await evidencePool.connect();
    await real.query(`SET search_path TO "${schema}"`);
    const originalQuery = real.query.bind(real);
    const originalRelease = real.release.bind(real);
    return {
      query: (async (sql: string, values?: unknown[]) => {
        if (injectUnlockFailure && sql.includes("pg_advisory_unlock")) {
          injectUnlockFailure = false;
          throw new Error("INJECTED_REAL_UNLOCK_FAILURE");
        }
        return originalQuery(sql, values);
      }) as PoolClient["query"],
      release: (error?: Error | boolean) => originalRelease(error),
    } as PoolClient;
  };

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`CREATE TABLE "${schema}".products (id text PRIMARY KEY, user_id text, org_id text, images text NOT NULL)`);
    await admin.query(
      `INSERT INTO "${schema}".products (id,user_id,images) VALUES ($1,$2,$3)`,
      [productId, userId, JSON.stringify([rel])],
    );
    setEvidenceLockDependenciesForTests({
      postgresRuntimeEnabled: () => true,
      connect,
      // Simulates separate web processes; only PostgreSQL may serialize them.
      useProcessLocalLock: false,
    });

    const lease = await acquireAdmissionReferenceEvidence({
      productId,
      owner: { kind: "user", id: userId },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    });
    let mutationFinished = false;
    const deletion = withProductEvidenceMutationLock(productId, async (client) => {
      await client!.query("UPDATE products SET images='[]' WHERE id=$1", [productId]);
      mutationFinished = true;
    });

    // Exceeds the real pool's configured 15 second idle transaction timeout.
    // A BEGIN/FOR SHARE implementation loses its lock here.
    await new Promise((resolve) => setTimeout(resolve, 15_250));
    assert.equal(mutationFinished, false, "DELETE escaped while provider/setup lease was live");
    await lease.release();
    await deletion;
    assert.equal(mutationFinished, true);
    const current = await admin.query(`SELECT images FROM "${schema}".products WHERE id=$1`, [productId]);
    assert.deepEqual(JSON.parse(current.rows[0].images), []);

    // Release after provider effects must never surface a late COMMIT/unlock
    // error. The error release path destroys the real pooled connection; the
    // server then releases its session advisory lock for another connection.
    await admin.query(`UPDATE "${schema}".products SET images=$2 WHERE id=$1`, [productId, JSON.stringify([rel])]);
    const brokenLease = await acquireAdmissionReferenceEvidence({
      productId,
      owner: { kind: "user", id: userId },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    });
    injectUnlockFailure = true;
    await brokenLease.release();

    const probe = await admin.connect();
    try {
      const deadline = Date.now() + 5_000;
      let acquired = false;
      do {
        const result = await probe.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 881731)) AS locked",
          [productId],
        );
        acquired = result.rows[0]?.locked === true;
        if (!acquired) await new Promise((resolve) => setTimeout(resolve, 25));
      } while (!acquired && Date.now() < deadline);
      assert.equal(acquired, true, "evicted session retained advisory lock");
      await probe.query("SELECT pg_advisory_unlock(hashtextextended($1, 881731))", [productId]);
    } finally {
      probe.release();
    }
  } finally {
    setEvidenceLockDependenciesForTests(undefined);
    setMediaStorageForTests(undefined);
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await evidencePool.end();
    await admin.end();
  }
});
