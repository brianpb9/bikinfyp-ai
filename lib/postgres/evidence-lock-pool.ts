import { Pool, type PoolClient, type PoolConfig } from "pg";

const g = globalThis as unknown as {
  __racunEvidenceLockPools?: Map<string, Pool>;
  __racunMatrixRunLockPools?: Map<string, Pool>;
};

function pools(): Map<string, Pool> {
  if (!g.__racunEvidenceLockPools) g.__racunEvidenceLockPools = new Map();
  return g.__racunEvidenceLockPools;
}

function matrixPools(): Map<string, Pool> {
  if (!g.__racunMatrixRunLockPools) g.__racunMatrixRunLockPools = new Map();
  return g.__racunMatrixRunLockPools;
}

function positiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * Evidence leases intentionally have their own tiny connection budget. They
 * can live for an entire provider call, so borrowing from the application pool
 * would let valid requests deadlock while trying to persist their own result.
 */
function lockPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    // Keep the additional database budget conservative even if an accidental
    // environment value is excessive. More requests queue before provider work.
    max: Math.min(positiveInt("PG_EVIDENCE_LOCK_POOL_MAX", 2), 4),
    connectionTimeoutMillis: positiveInt("PG_EVIDENCE_LOCK_QUEUE_TIMEOUT_MS", 120_000),
    idleTimeoutMillis: positiveInt("PG_EVIDENCE_LOCK_IDLE_MS", 30_000),
    statement_timeout: positiveInt("PG_STATEMENT_TIMEOUT_MS", 30_000),
    idle_in_transaction_session_timeout: positiveInt("PG_IDLE_TX_TIMEOUT_MS", 15_000),
  } as PoolConfig;
}

export function getEvidenceLockPool(connectionString: string): Pool {
  const map = pools();
  let pool = map.get(connectionString);
  if (!pool) {
    pool = new Pool(lockPoolConfig(connectionString));
    pool.on("error", (error) => {
      // Never log the connection string; managed URLs contain credentials.
      console.error("[pg-evidence-lock] idle client error:", error.message);
    });
    map.set(connectionString, pool);
  }
  return pool;
}

export async function connectEvidenceLockClient(connectionString: string): Promise<PoolClient> {
  return getEvidenceLockPool(connectionString).connect();
}

/** Matrix idempotency holds one session lock for its complete expansion. Keep
 * that single connection outside both the app pool and evidence pool, or two
 * concurrent matrices could each hold one lock-pool slot while waiting for a
 * second evidence slot. */
export function getMatrixRunLockPool(connectionString: string): Pool {
  const map = matrixPools();
  let pool = map.get(connectionString);
  if (!pool) {
    pool = new Pool({ ...lockPoolConfig(connectionString), max: 1 });
    pool.on("error", (error) => {
      console.error("[pg-matrix-run-lock] idle client error:", error.message);
    });
    map.set(connectionString, pool);
  }
  return pool;
}

export async function connectMatrixRunLockClient(connectionString: string): Promise<PoolClient> {
  return getMatrixRunLockPool(connectionString).connect();
}

/** Unlock a session lock without ever returning a possibly lock-bearing client
 * to its pool. Cleanup errors are observable but never replace work that has
 * already completed; an error release destroys the PostgreSQL session. */
export async function releaseSessionAdvisoryLock(input: {
  client: PoolClient;
  sql: string;
  values: unknown[];
  label: string;
}): Promise<void> {
  let unlockError: Error | null = null;
  try {
    const result = await input.client.query<{ unlocked: boolean }>(input.sql, input.values);
    if (!result.rows[0]?.unlocked) throw new Error(`${input.label} advisory lock was not held`);
  } catch (error) {
    unlockError = error instanceof Error ? error : new Error(String(error));
  }
  if (unlockError) {
    try { input.client.release(unlockError); }
    catch (releaseError) { console.error(`[${input.label}] failed to evict lock client:`, releaseError); }
    console.error(`[${input.label}] advisory unlock failed:`, unlockError);
    return;
  }
  try { input.client.release(); }
  catch (releaseError) { console.error(`[${input.label}] failed to return unlocked client:`, releaseError); }
}

/** Test/script teardown only. Request handlers must never close global pools. */
export async function closeEvidenceLockPools(): Promise<void> {
  const active = [...pools().values(), ...matrixPools().values()];
  pools().clear();
  matrixPools().clear();
  await Promise.all(active.map((pool) => pool.end().catch(() => undefined)));
}
