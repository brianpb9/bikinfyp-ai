// Laporan funnel dari tabel events (+ milestone audit_log) — jawab "aktivasi
// naik berapa %" dengan ANGKA, bukan estimasi. Jalankan kapan saja:
//   npx tsx scripts/funnel-report.ts [hari]   (default 30 hari terakhir)
// Di production (Postgres): jalankan dari Render Shell dengan DATABASE_URL ter-set;
// runner memilih sumber sesuai RACUN_DB_RUNTIME.
import { config } from "../lib/config";

const days = Number(process.argv[2] ?? 30);
const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

const STEPS = [
  ["landing_view", "Lihat landing"],
  ["try_view", "Buka /coba"],
  ["try_generated", "Dapat skrip gratis"],
  ["try_signup_click", "Klik daftar dari coba"],
  ["signup_success", "Berhasil daftar"],
  ["gaya_view", "Masuk pilih gaya"],
  ["approve_click", "Setujui skrip"],
  ["proses_ready", "Video jadi (READY)"],
  ["download_click", "Unduh video"],
  ["report_saved", "Lapor hasil posting"],
] as const;

async function rows(): Promise<{ name: string; uniq: number; total: number }[]> {
  if (config.dbRuntime === "postgres") {
    const pg = await import("pg");
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl });
    try {
      const r = await pool.query(
        `SELECT name, COUNT(DISTINCT COALESCE(user_id, anon_id)) AS uniq, COUNT(*) AS total
         FROM events WHERE created_at >= $1 GROUP BY name`,
        [sinceIso]
      );
      return r.rows.map((x) => ({ name: x.name, uniq: Number(x.uniq), total: Number(x.total) }));
    } finally {
      await pool.end();
    }
  }
  const { getDb } = await import("../lib/db");
  return getDb()
    .prepare(
      `SELECT name, COUNT(DISTINCT COALESCE(user_id, anon_id)) AS uniq, COUNT(*) AS total
       FROM events WHERE created_at >= ? GROUP BY name`
    )
    .all(sinceIso) as { name: string; uniq: number; total: number }[];
}

const byName = new Map((await rows()).map((r) => [r.name, r]));
console.log(`\nFUNNEL ${days} HARI TERAKHIR (unik per user/anon; sejak ${sinceIso.slice(0, 10)})\n`);
let prev: number | null = null;
for (const [name, label] of STEPS) {
  const r = byName.get(name);
  const uniq = r?.uniq ?? 0;
  const conv = prev && prev > 0 ? ` · ${Math.round((uniq / prev) * 100)}% dari langkah sebelumnya` : "";
  console.log(`  ${label.padEnd(24)} ${String(uniq).padStart(5)} unik (${r?.total ?? 0} event)${conv}`);
  if (uniq > 0) prev = uniq;
}
console.log(
  "\nCatatan: landing->coba->daftar = funnel akuisisi; gaya->ready->unduh = funnel produk;\n" +
    "lapor hasil = bahan predicted-vs-actual Skor FYP. Event server-side lain ada di audit_log."
);
