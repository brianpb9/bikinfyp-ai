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

test("PostgreSQL nyata: lock pool terisolasi, bounded, dan tahan >15s", {
  skip: URL_UJI ? false : "UJI_PG_URL kosong; unit dependency-backed tetap dijalankan",
  timeout: 45_000,
}, async () => {
  const previousAppMax = process.env.PG_POOL_MAX;
  const previousLockMax = process.env.PG_EVIDENCE_LOCK_POOL_MAX;
  process.env.PG_POOL_MAX = "1";
  process.env.PG_EVIDENCE_LOCK_POOL_MAX = "2";
  const { setMediaStorageForTests } = await import("../lib/storage");
  const {
    acquireAdmissionReferenceEvidence,
    setEvidenceLockDependenciesForTests,
    withProductEvidenceMutationLock,
  } = await import("../lib/job-admission-reference");
  const { getPool, closeAllPools } = await import("../lib/postgres/pool");
  const {
    getEvidenceLockPool,
    connectMatrixRunLockClient,
    closeEvidenceLockPools,
    releaseSessionAdvisoryLock,
  } = await import("../lib/postgres/evidence-lock-pool");

  const schema = `c8_lock_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: URL_UJI, max: 2 });
  const productIds = Array.from({ length: 4 }, () => crypto.randomUUID());
  const [productId] = productIds;
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
  let matrixRunClient: PoolClient | null = null;
  const connect = async (): Promise<PoolClient> => {
    const real = await getEvidenceLockPool(URL_UJI).connect();
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
    for (const id of productIds) {
      await admin.query(
        `INSERT INTO "${schema}".products (id,user_id,images) VALUES ($1,$2,$3)`,
        [id, userId, JSON.stringify([rel])],
      );
    }
    setEvidenceLockDependenciesForTests({
      postgresRuntimeEnabled: () => true,
      connect,
      // Simulates separate web processes; only PostgreSQL may serialize them.
      useProcessLocalLock: false,
    });

    matrixRunClient = await connectMatrixRunLockClient(URL_UJI);
    await matrixRunClient.query("SELECT pg_advisory_lock(hashtext($1))", ["matrix-run-max-one"]);
    const lease = await acquireAdmissionReferenceEvidence({
      productId,
      owner: { kind: "user", id: userId },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    });
    const appPool = getPool(URL_UJI);
    const appWhileLease = await Promise.race([
      appPool.query("SELECT 1 AS alive"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("app pool max=1 starved by evidence lease")), 1_000)),
    ]);
    assert.equal(appWhileLease.rows[0]?.alive, 1, "downstream DB gagal saat lease memegang lock pool");
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
    await matrixRunClient.query("SELECT pg_advisory_unlock(hashtext($1))", ["matrix-run-max-one"]);
    matrixRunClient.release();
    matrixRunClient = null;

    // The sole matrix pool must evict, not recycle, a session whose unlock
    // query failed. A subsequent run then obtains a fresh session and lock.
    const poisonedReal = await connectMatrixRunLockClient(URL_UJI);
    await poisonedReal.query("SELECT pg_advisory_lock(hashtext($1))", ["matrix-run-poison"]);
    const poisonedQuery = poisonedReal.query.bind(poisonedReal);
    const poisonedRelease = poisonedReal.release.bind(poisonedReal);
    const poisonedClient = {
      query: (async (sql: string, values?: unknown[]) => {
        if (sql.includes("pg_advisory_unlock")) throw new Error("INJECTED_MATRIX_UNLOCK_FAILURE");
        return poisonedQuery(sql, values);
      }) as PoolClient["query"],
      release: (error?: Error | boolean) => poisonedRelease(error),
    } as PoolClient;
    await releaseSessionAdvisoryLock({
      client: poisonedClient,
      sql: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
      values: ["matrix-run-poison"],
      label: "matrix-run-lock-test",
    });
    const replacement = await connectMatrixRunLockClient(URL_UJI);
    const reacquired = await replacement.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      ["matrix-run-poison"],
    );
    assert.equal(reacquired.rows[0]?.locked, true, "poisoned sole matrix connection was recycled");
    await releaseSessionAdvisoryLock({
      client: replacement,
      sql: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
      values: ["matrix-run-poison"],
      label: "matrix-run-lock-test",
    });

    // Two distinct products consume the complete conservative lock budget.
    // A third request must queue before provider/setup starts, while the
    // independent application pool (configured max=1) remains usable.
    const held = await Promise.all(productIds.slice(1, 3).map((id) => acquireAdmissionReferenceEvidence({
      productId: id,
      owner: { kind: "user", id: userId },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    })));
    let queuedProviderStarted = false;
    const queuedLeasePromise = acquireAdmissionReferenceEvidence({
      productId: productIds[3],
      owner: { kind: "user", id: userId },
      boundary: "A7",
      loadSqliteCandidateRels: () => [],
    }).then((queuedLease) => {
      queuedProviderStarted = true;
      return queuedLease;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(queuedProviderStarted, false, "saturated request reached provider before lock capacity");
    const downstream = await Promise.race([
      appPool.query("SELECT 2 AS alive"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("app pool starved by saturated lock pool")), 1_000)),
    ]);
    assert.equal(downstream.rows[0]?.alive, 2);
    await held[0].release();
    const queuedLease = await queuedLeasePromise;
    assert.equal(queuedProviderStarted, true, "queued request did not resume after capacity release");
    await queuedLease.release();
    await held[1].release();

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
    if (matrixRunClient) {
      await matrixRunClient.query("SELECT pg_advisory_unlock(hashtext($1))", ["matrix-run-max-one"]).catch(() => undefined);
      matrixRunClient.release();
    }
    await closeEvidenceLockPools();
    await closeAllPools();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await admin.end();
    if (previousAppMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = previousAppMax;
    if (previousLockMax === undefined) delete process.env.PG_EVIDENCE_LOCK_POOL_MAX;
    else process.env.PG_EVIDENCE_LOCK_POOL_MAX = previousLockMax;
  }
});
