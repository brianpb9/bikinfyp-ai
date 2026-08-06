// Rate limit per-kunci (IP/user) yang selamat multi-instance (2026-08-06).
// Mode redis (production, RACUN_QUEUE_MODE=redis): INCR + EXPIRE — hitungan
// dibagi antar instance web. Selain itu: fallback in-memory (dev/1 instance).
// Fail-open: Redis bermasalah tidak boleh memblokir user (endpoint yang
// dilindungi adalah funnel publik murah, bukan jalur uang).

import IORedis from "ioredis";

const memory = new Map<string, { count: number; resetAt: number }>();
let redis: IORedis | null | undefined; // undefined = belum dicoba, null = tidak tersedia

function getRedis(): IORedis | null {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  if (process.env.RACUN_QUEUE_MODE !== "redis" || !url) {
    redis = null;
    return redis;
  }
  redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
  redis.on("error", () => undefined); // jangan crash proses karena telemetry-limiter
  return redis;
}

/** true = boleh lanjut; false = lewat batas. */
export async function allowRate(bucket: string, key: string, max: number, windowSec: number): Promise<boolean> {
  const redisClient = getRedis();
  if (redisClient) {
    try {
      const k = `rl:${bucket}:${key}`;
      const n = await redisClient.incr(k);
      if (n === 1) await redisClient.expire(k, windowSec);
      return n <= max;
    } catch {
      /* fail-open ke memori */
    }
  }
  const now = Date.now();
  const memKey = `${bucket}:${key}`;
  const b = memory.get(memKey);
  if (!b || b.resetAt < now) {
    memory.set(memKey, { count: 1, resetAt: now + windowSec * 1000 });
    return true;
  }
  b.count++;
  return b.count <= max;
}
