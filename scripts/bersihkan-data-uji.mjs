/**
 * BERSIHKAN DATA UJI — menghapus seluruh jejak transaksi, menyisakan akun.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA ADA, DAN KENAPA BERPAGAR
 * ─────────────────────────────────────────────────────────────────────────────
 * Diminta Brian 2 Sep 2026 saat sistem berpindah dari saldo rupiah ke kredit
 * per jenis video: saldo lama tidak bisa dibelanjakan di model baru, dan job
 * serta pesanan yang tercampur dua model membuat laporan mana pun tidak bisa
 * dibaca.
 *
 * Ini skrip yang MENGHAPUS. Karena itu:
 *   - butuh BERSIHKAN_DATA=ya-saya-yakin di env, bukan sekadar dijalankan;
 *   - menolak berjalan tanpa DATABASE_URL PostgreSQL;
 *   - menghitung dan MENAMPILKAN apa yang akan dihapus sebelum menghapus;
 *   - --dry-run menjalankan hitungannya saja.
 *
 * YANG TIDAK DIHAPUS: users, organizations, org_members, runtime_secrets
 * (kredensial partner), dan audit_log. Menghapus akun akan mengeluarkan Brian
 * dari dashboard-nya sendiri; menghapus audit menghapus catatan siapa
 * melakukan apa — justru yang paling dibutuhkan sesudah pembersihan.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const dryRun = process.argv.includes("--dry-run");

if (!dryRun && process.env.BERSIHKAN_DATA !== "ya-saya-yakin") {
  throw new Error("Ditolak: setel BERSIHKAN_DATA=ya-saya-yakin untuk benar-benar menghapus (atau pakai --dry-run).");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Butuh DATABASE_URL PostgreSQL.");
}

// URUTAN PENTING: anak lebih dulu, induk belakangan. Foreign key akan menolak
// urutan yang salah, dan penolakan di tengah meninggalkan pembersihan separuh
// jalan — lebih buruk daripada tidak dibersihkan sama sekali.
const URUTAN = [
  "events",
  "kredit_video",
  "pesanan_item",
  "langganan",
  "fyp_snapshots",
  "job_shots",
  "job_prompts",
  "provider_tasks",
  "outputs",
  "credit_ledger",
  "payments",
  "promo_jobs",
  "jobs",
  "scripts",
  "personas",
  "products",
];

const pool = new Pool({ connectionString: databaseUrl });
try {
  const ada = new Set(
    (await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )).rows.map((r) => r.table_name),
  );

  console.log(dryRun ? "== HITUNGAN SAJA (--dry-run) ==" : "== MENGHAPUS ==");
  let total = 0;
  for (const tabel of URUTAN) {
    if (!ada.has(tabel)) { console.log(`  ${tabel.padEnd(18)} (tidak ada)`); continue; }
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabel}`);
    console.log(`  ${tabel.padEnd(18)} ${rows[0].n} baris`);
    total += rows[0].n;
  }
  console.log(`  TOTAL              ${total} baris`);

  if (dryRun) { console.log("\nTidak ada yang dihapus."); }
  else {
    // Satu transaksi: kalau ada satu tabel yang gagal, TIDAK ADA yang terhapus.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const tabel of URUTAN) if (ada.has(tabel)) await client.query(`DELETE FROM ${tabel}`);
      await client.query("COMMIT");
      console.log(`\n${total} baris dihapus. users, organizations, dan runtime_secrets TIDAK disentuh.`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally { client.release(); }
  }

  const sisa = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  console.log(`Akun tersisa: ${sisa.rows[0].n}`);

  // PAKET GRATIS DIKEMBALIKAN setelah pembersihan.
  //
  // kredit_video ikut dikosongkan, jadi tanpa langkah ini setiap akun yang
  // tersisa berdiri tanpa jatah apa pun — termasuk akun yang dipakai menguji,
  // dan pembersihan yang meninggalkan sistem tidak bisa diuji bukan
  // pembersihan. Pendaftar BARU tetap menerimanya otomatis saat akun dibuat.
  if (!dryRun) {
    const { rows } = await pool.query("SELECT id FROM users");
    const waktu = new Date().toISOString();
    for (const u of rows) {
      await pool.query(
        `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
         VALUES ($1,$2,'premium','topup',1,'bonus',NULL,NULL,NULL,$3,$4)`,
        [randomUUID(), u.id, "paket gratis (setelah pembersihan data uji)", waktu],
      );
    }
    console.log(`Paket gratis dikembalikan ke ${rows.length} akun.`);
  }
} finally {
  await pool.end();
}
