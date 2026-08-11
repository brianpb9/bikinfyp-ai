import { Pool, type PoolConfig } from "pg";

// SATU pool per proses (masukan tester lewat Brian, 2026-08-11: "perbaikan
// tunggal dengan ROI terbesar" — dan itu benar).
//
// MASALAH YANG DIPERBAIKI
//
// Sebelum ini ada 48 tempat berbeda memanggil `new Pool({connectionString})`,
// hampir semuanya di dalam satu request, dan hampir semuanya diakhiri
// `pool.end()` di blok finally. Artinya: tiap permintaan HTTP membuka koneksi
// TCP + TLS baru ke Postgres, memakainya sekali, lalu membuangnya. Handshake
// TLS ke Postgres terkelola berjalan puluhan milidetik, jadi ini biaya tetap
// di SETIAP request — dan pada beban bersamaan, jumlah koneksi meledak sampai
// menabrak batas `max_connections` server. Target 100 pengguna tidak akan
// bertahan; itu bukan ramalan, itu aritmetika.
//
// Sekarang: satu Pool, disimpan di globalThis supaya bertahan melintasi
// hot-reload modul Next di dev (pola yang sama dengan __racunDb di lib/db.ts —
// tanpa itu, tiap penyimpanan berkas di dev membocorkan satu pool utuh).
//
// JANGAN PERNAH memanggil .end() pada pool ini dari kode request. Menutupnya
// mematikan seluruh proses, bukan satu permintaan. Karena itu closePool()
// hanya untuk teardown skrip/tes, dan repositori yang punya close() dibuat
// jadi no-op.

const g = globalThis as unknown as { __racunPgPools?: Map<string, Pool> };

function pools(): Map<string, Pool> {
  if (!g.__racunPgPools) g.__racunPgPools = new Map();
  return g.__racunPgPools;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/** Ukuran pool dibedakan web vs worker lewat env.
 *
 * Web melayani banyak permintaan pendek (bawaan 10); worker menjalankan sedikit
 * job panjang dan lebih baik menahan diri agar tidak menghabiskan jatah koneksi
 * milik web (bawaan 5). Keduanya sengaja jauh di bawah batas Postgres terkelola
 * supaya masih ada ruang untuk migrasi dan psql manual saat insiden. */
function poolSize(): number {
  return intFromEnv("PG_POOL_MAX", process.env.RACUN_ROLE === "worker" ? 5 : 10);
}

function baseConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: poolSize(),
    // Batas waktu EKSPLISIT. Tanpa ini, satu kueri yang menggantung menahan
    // koneksinya selamanya dan pool habis tanpa satu pun pesan error.
    connectionTimeoutMillis: intFromEnv("PG_CONNECT_TIMEOUT_MS", 10_000),
    idleTimeoutMillis: intFromEnv("PG_IDLE_TIMEOUT_MS", 30_000),
    // statement_timeout: kueri yang melewati batas dibatalkan server, bukan
    // dibiarkan menggantung. idle_in_transaction_session_timeout menutup
    // transaksi yang terlanjur dibuka lalu ditinggalkan (mis. proses mati di
    // tengah BEGIN) — itu jenis kebocoran yang menahan lock sampai restart.
    statement_timeout: intFromEnv("PG_STATEMENT_TIMEOUT_MS", 30_000),
    idle_in_transaction_session_timeout: intFromEnv("PG_IDLE_TX_TIMEOUT_MS", 15_000),
  } as PoolConfig;
}

/** Pool bersama untuk satu connection string. */
export function getPool(connectionString: string): Pool {
  const map = pools();
  let pool = map.get(connectionString);
  if (!pool) {
    pool = new Pool(baseConfig(connectionString));
    // Tanpa handler ini, error koneksi pada klien menganggur menjadi
    // unhandled 'error' event dan MEMATIKAN proses Node. Pool akan memulihkan
    // dirinya sendiri; yang perlu kita lakukan hanya mencatat.
    pool.on("error", (err) => console.error("[pg] error pada klien menganggur:", err.message));
    map.set(connectionString, pool);
  }
  return pool;
}

/** Hanya untuk teardown skrip/tes. Kode request TIDAK boleh memanggil ini. */
export async function closeAllPools(): Promise<void> {
  const map = pools();
  await Promise.all([...map.values()].map((p) => p.end().catch(() => undefined)));
  map.clear();
}
