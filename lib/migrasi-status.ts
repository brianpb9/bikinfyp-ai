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

/**
 * Apakah invarian uang BENAR-BENAR terpasang di database?
 *
 * Dua kelemahan yang ditutup fungsi ini, dan keduanya membuat gerbang uang
 * membuka diri sendiri:
 *
 * 1. pendingMigrations() mengembalikan [] (= "tidak ada yang tertinggal")
 *    ketika runtime bukan PostgreSQL ATAU DATABASE_URL kosong. Ia SUKSES
 *    secara logis, jadi try/catch di pemanggilnya tidak pernah jalan.
 *    Terbukti: production-mode dengan DATABASE_URL='' membuka admission.
 *
 * 2. Mempercayai isi schema_migrations berarti mempercayai CATATAN, bukan
 *    KENYATAAN. Baris migrasi yang tercatat sementara indeksnya hilang
 *    (restore parsial, drift, migrasi manual setengah jalan) tetap membuka
 *    intake.
 *
 * Karena itu yang diperiksa artefaknya langsung: indeks unik terminal, CHECK
 * yang melarang capture menggerakkan saldo, dan tipe 'regen' yang diizinkan.
 * Kalau ketiganya ada, invariannya nyata — apa pun kata tabel migrasi.
 */
export interface StatusInvarian { siap: boolean; alasan?: string }

export async function invarianUangTerpasang(): Promise<StatusInvarian> {
  // SQLite (pengembangan lokal): invariannya ada di lib/schema.sql dan dibuat
  // saat database dibangun, bukan lewat migrasi. Tidak ada yang perlu diperiksa.
  if (config.dbRuntime !== "postgres") {
    if (process.env.RACUN_DEPLOY_ENV === "production") {
      return { siap: false, alasan: "produksi berjalan tanpa runtime PostgreSQL — konfigurasi salah" };
    }
    return { siap: true };
  }
  if (!config.databaseUrl) {
    return { siap: false, alasan: "DATABASE_URL kosong — status invarian tidak dapat diperiksa" };
  }
  try {
    const pool = getPool(config.databaseUrl);
    const r = await pool.query<{ indeks: number; cek_capture: number; regen_ok: boolean }>(`
      SELECT
        (SELECT COUNT(*) FROM pg_indexes WHERE indexname='uniq_ledger_terminal_per_job')::int AS indeks,
        (SELECT COUNT(*) FROM pg_constraint WHERE conname='credit_ledger_capture_delta_check')::int AS cek_capture,
        (SELECT pg_get_constraintdef(oid) LIKE '%regen%' FROM pg_constraint WHERE conname='credit_ledger_type_check') AS regen_ok`);
    const b = r.rows[0];
    const kurang: string[] = [];
    if (!b || b.indeks < 1) kurang.push("indeks uniq_ledger_terminal_per_job");
    if (!b || b.cek_capture < 1) kurang.push("CHECK credit_ledger_capture_delta_check");
    if (!b || !b.regen_ok) kurang.push("tipe ledger 'regen'");
    return kurang.length === 0 ? { siap: true } : { siap: false, alasan: `belum terpasang: ${kurang.join(", ")}` };
  } catch (err) {
    // Gagal membaca = TIDAK TAHU = TIDAK BOLEH. Kegagalan membaca justru
    // sinyal databasenya sedang tidak sehat.
    return { siap: false, alasan: `status invarian tidak terbaca: ${(err as Error).message}` };
  }
}
