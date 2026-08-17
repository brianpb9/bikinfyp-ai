/**
 * Batalkan SEMUA job render yang belum terminal, kembalikan hold-nya.
 *
 * Dipakai saat pipeline diganti dan keluaran lama tidak boleh diselesaikan
 * lalu ditagihkan. Bukan skrip sehari-hari — ia memindahkan uang nyata.
 *
 * MEMAKAI failJob(), BUKAN SQL TANGAN. Fungsi itu melakukan FAILED -> release
 * -> REFUNDED dalam SATU transaksi serializable, menolak melepas job yang
 * ledgernya sudah punya catatan terminal, dan mengunci wallet yang benar
 * (pool org untuk job Enterprise, baris user untuk retail). Menulis ulang
 * langkah itu dengan UPDATE tangan berarti mengulang setiap pelajaran yang
 * sudah dibayar mahal di berkas itu.
 *
 * Jalankan:
 *   DATABASE_URL=... CONFIRM=YA npx tsx scripts/batalkan-render-berjalan.ts
 *
 * Tanpa CONFIRM=YA ia hanya MELAPORKAN apa yang akan dibatalkan.
 */
import { PgJobsRepository } from "../lib/postgres/jobs";
import { getPool } from "../lib/postgres/pool";
import { config } from "../lib/config";

const ALASAN = process.env.ALASAN ?? "pipeline upgrade";
const jalan = process.env.CONFIRM === "YA";

const url = config.databaseUrl;
if (!/^postgres(ql)?:\/\//i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib.");
  process.exit(1);
}

const pool = getPool(url);
const jobs = new PgJobsRepository(url, { stateTimeoutsMin: config.stateTimeoutsMin });

const { rows } = await pool.query<{
  id: string; state: string; user_id: string; org_id: string | null; hold: string; terminal: string;
}>(`
  SELECT j.id, j.state, j.user_id, j.org_id,
         COALESCE(-SUM(cl.delta) FILTER (WHERE cl.type='hold'), 0)::text AS hold,
         COUNT(*) FILTER (WHERE cl.type IN ('capture','release'))::text  AS terminal
  FROM jobs j LEFT JOIN credit_ledger cl ON cl.job_id = j.id
  WHERE j.state NOT IN ('READY','FAILED','REFUNDED')
  GROUP BY j.id, j.state, j.user_id, j.org_id
  ORDER BY j.created_at
`);

console.log(`${rows.length} job belum terminal:`);
for (const r of rows) {
  console.log(
    `  ${r.id}  ${r.state.padEnd(18)} hold Rp${Number(r.hold).toLocaleString("id-ID")}` +
      `${Number(r.terminal) > 0 ? " (ledger sudah terminal — tidak ada yang dilepas)" : ""}` +
      `${r.org_id ? "  [Enterprise]" : "  [retail]"}`
  );
}

if (!jalan) {
  const total = rows.filter((r) => Number(r.terminal) === 0).reduce((a, r) => a + Number(r.hold), 0);
  console.log(`\nMODE LAPOR SAJA. Dengan CONFIRM=YA: ${rows.length} job dibatalkan, ~Rp${total.toLocaleString("id-ID")} dilepas.`);
  process.exit(0);
}

let dibatalkan = 0;
let dilepas = 0;
const gagal: string[] = [];
for (const r of rows) {
  try {
    const hasil = await jobs.failJob(r.id, ALASAN);
    if (hasil.changed) {
      dibatalkan++;
      dilepas += hasil.refunded;
      console.log(`  DIBATALKAN ${r.id} — dilepas Rp${hasil.refunded.toLocaleString("id-ID")}`);
    } else {
      // Bukan galat: job bisa saja selesai sendiri di antara pembacaan dan
      // pembatalan. Yang penting ia TIDAK dihitung sebagai dibatalkan.
      console.log(`  DILEWATI   ${r.id} — sudah terminal sebelum sempat dibatalkan`);
    }
  } catch (err) {
    gagal.push(`${r.id}: ${(err as Error).message}`);
    console.error(`  GAGAL      ${r.id} — ${(err as Error).message}`);
  }
}

console.log(`\n${dibatalkan} job dibatalkan · Rp${dilepas.toLocaleString("id-ID")} dikembalikan · ${gagal.length} gagal`);
if (gagal.length) process.exitCode = 1;
