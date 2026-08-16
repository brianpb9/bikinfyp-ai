/**
 * Status migrasi PostgreSQL, di-cache.
 *
 * Dulu hidup di dalam app/api/health. Dipindah ke sini karena PEMAKAINYA
 * sekarang dua: health yang MELAPORKAN, dan gerbang intake yang MENOLAK
 * pekerjaan berbayar selama invarian uang belum terpasang. Dua salinan
 * pembacaan skema akan menyimpang, dan yang menyimpang di sini menentukan
 * apakah uang boleh bergerak.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { getPool } from "./postgres/pool";

// Deteksi migrasi tertinggal (pelajaran insiden 2026-08-06 malam: deploy kode
// ber-skema-baru + migrasi production yang manual = 500 massal TANPA alarm;
// health tetap "ok" karena tidak pernah membandingkan skema). Cek di-cache 5
// menit; hasilnya DIEKSPOS di payload + console.error, tapi TIDAK membuat 503 —
// health-fail bikin Render restart-loop dan justru memperparah insiden.
let migrationCache: { at: number; pending: string[] } | null = null;
export async function pendingMigrations(): Promise<string[]> {
  if (config.dbRuntime !== "postgres" || !config.databaseUrl) return [];
  if (migrationCache && Date.now() - migrationCache.at < 5 * 60 * 1000) return migrationCache.pending;
  const dir = path.join(process.cwd(), "migrations", "postgres");
  const files = fs.readdirSync(dir).filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
  const pool = getPool(config.databaseUrl);
  try {
    const applied = new Set(
      (await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version)
    );
    const pending = files.filter((f) => !applied.has(f.replace(/\.sql$/, "")));
    migrationCache = { at: Date.now(), pending };
    if (pending.length > 0)
      console.error(`[health] MIGRASI TERTINGGAL (${pending.length}): ${pending.join(", ")} — jalankan runbook migrate:postgres-production.`);
    return pending;
  } catch (e) {
    // Tabel schema_migrations belum ada = SEMUA file pending.
    console.error("[health] gagal membaca schema_migrations:", e);
    migrationCache = { at: Date.now(), pending: files };
    return files;
  } finally {
    /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
  }
}

/**
 * Render liveness/readiness endpoint.  It deliberately exposes no secrets and
 * does not accept traffic-control changes.  A configuration failure returns
 * 503 so Render health checks do not mark a misconfigured deployment healthy.
 */
