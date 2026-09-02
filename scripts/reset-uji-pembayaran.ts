/**
 * RESET JEJAK UJI PEMBAYARAN — supaya pengujian bisa dimulai dari nol.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APA YANG DIHAPUS, DAN APA YANG TIDAK
 * ─────────────────────────────────────────────────────────────────────────────
 * DIHAPUS: pesanan (payments), isi pesanannya (pesanan_item), langganan, dan
 * seluruh baris kredit_video milik akun yang disebut.
 *
 * TIDAK DISENTUH: akun itu sendiri, job, naskah, produk, dan kredensial.
 * Menghapus akun akan memutus sesi yang sedang dipakai menguji, dan menghapus
 * pekerjaan yang tidak ada hubungannya dengan pembayaran hanya memperbesar
 * kerusakan kalau skrip ini dijalankan pada akun yang salah.
 *
 * TIDAK DISENTUH JUGA: credit_ledger (dompet rupiah warisan). Ia APPEND-ONLY
 * dan dijaga trigger database (migrations/postgres/0002) yang menolak UPDATE
 * maupun DELETE — sengaja, supaya catatan uang tidak bisa diubah bahkan oleh
 * kode yang melewati repository. Percobaan pertama skrip ini menghapusnya dan
 * ditolak trigger itu; yang salah skripnya, bukan penjagaannya.
 *
 * Membiarkannya tidak menimbulkan masalah: rupiah tidak lagi membeli apa pun,
 * dan sisa jatah video dihitung sepenuhnya dari kredit_video.
 *
 * SESUDAHNYA paket gratis dikembalikan — akun tanpa jatah apa pun tidak bisa
 * dipakai menguji apa pun, dan itulah gunanya reset ini.
 *
 * Berpagar sama seperti skrip pembersihan lain: butuh RESET_UJI=ya-saya-yakin,
 * dan --dry-run menghitung tanpa menghapus. Tanpa argumen email, ia menolak
 * berjalan — reset yang menyasar semua orang bukan reset, itu kehilangan data.
 */
import crypto from "node:crypto";
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { config } from "../lib/config";

const argumen = process.argv.slice(2);
const dryRun = argumen.includes("--dry-run");
const email = argumen.filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());

if (!email.length) {
  throw new Error("Sebutkan email akunnya: npx tsx scripts/reset-uji-pembayaran.ts orang@contoh.com [--dry-run]");
}
if (!dryRun && process.env.RESET_UJI !== "ya-saya-yakin") {
  throw new Error("Ditolak: setel RESET_UJI=ya-saya-yakin untuk benar-benar menghapus (atau pakai --dry-run).");
}

const pool = getPool(config.databaseUrl);
try {
  const { rows: pengguna } = await pool.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE lower(email) = ANY($1::text[])", [email],
  );
  const tidakAda = email.filter((e) => !pengguna.some((p) => p.email.toLowerCase() === e));
  for (const e of tidakAda) console.log(`TIDAK ADA akun dengan email ${e}`);
  if (!pengguna.length) throw new Error("tidak satu pun email ditemukan — periksa ejaannya");

  const ids = pengguna.map((p) => p.id);
  const hitung = async (sql: string) => Number((await pool.query<{ n: string }>(sql, [ids])).rows[0].n);

  const ringkas = {
    payments: await hitung("SELECT COUNT(*)::text AS n FROM payments WHERE user_id = ANY($1::text[])"),
    langganan: await hitung("SELECT COUNT(*)::text AS n FROM langganan WHERE user_id = ANY($1::text[])"),
    kredit_video: await hitung("SELECT COUNT(*)::text AS n FROM kredit_video WHERE user_id = ANY($1::text[])"),
    // credit_ledger DIHITUNG tapi TIDAK dihapus — lihat catatan di bawah.
    credit_ledger_dibiarkan: await hitung("SELECT COUNT(*)::text AS n FROM credit_ledger WHERE user_id = ANY($1::text[])"),
  };
  console.log(dryRun ? "== HITUNGAN SAJA (--dry-run) ==" : "== MENGHAPUS ==");
  for (const p of pengguna) console.log(`  akun: ${p.email}`);
  for (const [t, n] of Object.entries(ringkas)) console.log(`  ${t.padEnd(14)} ${n} baris`);

  if (dryRun) {
    console.log("\nTidak ada yang dihapus.");
  } else {
    // Satu transaksi: kalau ada yang gagal, TIDAK ADA yang terhapus — reset
    // separuh jalan meninggalkan akun dengan pesanan tanpa kredit, yaitu
    // keadaan yang justru sedang kita bersihkan.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM pesanan_item WHERE payment_id IN (SELECT gateway_ref FROM payments WHERE user_id = ANY($1::text[]))",
        [ids],
      );
      await client.query("DELETE FROM kredit_video WHERE user_id = ANY($1::text[])", [ids]);
      await client.query("DELETE FROM langganan WHERE user_id = ANY($1::text[])", [ids]);
      await client.query("DELETE FROM payments WHERE user_id = ANY($1::text[])", [ids]);

      // Paket gratis dikembalikan — akun tanpa jatah tidak bisa dipakai menguji.
      const waktu = new Date().toISOString();
      for (const p of pengguna) {
        await client.query(
          `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
           VALUES ($1,$2,$3,'topup',$4,'bonus',NULL,NULL,NULL,$5,$6)`,
          [crypto.randomUUID(), p.id, config.signupBonusJenis, config.signupBonusQty, "paket gratis (reset uji)", waktu],
        );
        await client.query(
          "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,'operator','uji.reset_pembayaran','users',$2,$3,$4)",
          [crypto.randomUUID(), p.id, JSON.stringify(ringkas), waktu],
        );
      }
      await client.query("COMMIT");
      console.log(`\nSelesai. Paket gratis (${config.signupBonusQty} ${config.signupBonusJenis}) dikembalikan ke ${pengguna.length} akun.`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
} finally {
  await closeAllPools();
}
