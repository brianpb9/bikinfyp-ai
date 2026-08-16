#!/usr/bin/env node
/**
 * Audit ledger SEBELUM migrasi 0030/0031. HANYA MEMBACA.
 *
 * VERSI PERTAMA SKRIP INI BERBAHAYA, dan bahayanya justru jenis yang paling
 * halus: ia bisa MENEMUKAN masalah lalu tetap mencetak "Lanjutkan". Bendera
 * "perlu keputusan manusia" hanya dinyalakan oleh query pertama, jadi grup
 * terminal yang memuat release — kasus yang MENGHENTIKAN migrasi — ditemukan
 * di query ketiga dan tetap diakhiri dengan lampu hijau.
 *
 * Skrip keselamatan yang bisa berkata aman padahal tidak lebih berbahaya
 * daripada tidak punya skrip sama sekali, karena ia menghentikan orang
 * memeriksa sendiri.
 *
 * Yang diperbaiki:
 *   - tiap pemeriksaan menyatakan SENDIRI apakah ia pemblokir;
 *   - exit code bukan nol kalau ada pemblokir (bisa dipakai di runbook/CI);
 *   - tanpa LIMIT — ini inventaris korban, bukan cuplikan;
 *   - membandingkan hold vs release SECARA NOMINAL, bukan sekadar "ada
 *     release" (refund parsial dulu dianggap selesai);
 *   - "capture palsu" diwajibkan delta < 0 (capture delta 0 itu SAH);
 *   - capture berdelta POSITIF ikut ditangkap — ia lolos audit lama tapi
 *     menggagalkan migrasi;
 *   - transaksi READ ONLY REPEATABLE READ supaya semua angka berasal dari
 *     satu snapshot yang sama, plus statement_timeout.
 *
 * Pakai:
 *   DATABASE_URL='postgres://...' node scripts/audit-ledger-sebelum-migrasi.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib diisi.");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 2 });

/**
 * pemblokir: true  = migrasi TIDAK BOLEH dijalankan sebelum ini diselesaikan
 * pemblokir: false = informasi; migrasi menanganinya sendiri
 */
const PEMERIKSAAN = [
  {
    nama: "Job gagal yang hold-nya TIDAK dikembalikan penuh",
    pemblokir: true,
    catatan:
      "Pengguna kehilangan uang untuk video yang tidak pernah diterima. Migrasi TIDAK memperbaiki ini — ia hanya memperbaiki label. Kembalikan manual, per kasus.",
    sql: `
      SELECT j.id AS job_id, j.user_id, j.org_id, j.state,
             COALESCE(SUM(-l.delta) FILTER (WHERE l.type='hold'), 0)    AS hold_idr,
             COALESCE(SUM(l.delta)  FILTER (WHERE l.type='release'), 0) AS release_idr,
             COALESCE(SUM(-l.delta) FILTER (WHERE l.type='regen'), 0)   AS regen_idr,
             COALESCE(SUM(-l.delta) FILTER (WHERE l.type='capture' AND l.delta < 0), 0) AS capture_negatif_idr
      FROM jobs j JOIN credit_ledger l ON l.job_id = j.id
      WHERE j.state IN ('REFUNDED','FAILED')
      GROUP BY j.id, j.user_id, j.org_id, j.state
      -- NOMINAL, bukan "ada release": refund PARSIAL dulu lolos karena satu
      -- baris release dianggap menutup seluruh hold.
      HAVING COALESCE(SUM(-l.delta) FILTER (WHERE l.type='hold'), 0)
           > COALESCE(SUM(l.delta)  FILTER (WHERE l.type='release'), 0)
      ORDER BY 5 DESC`,
  },
  {
    nama: "Grup terminal ganda yang MENYENTUH SALDO (ada release, atau delta bukan nol)",
    pemblokir: true,
    catatan:
      "Migrasi 0031 akan BERHENTI pada grup ini — itu memang disengaja. Rekonsiliasi manual dulu; jangan dipaksa.",
    sql: `
      SELECT job_id,
             COUNT(*)                                   AS terminal,
             COUNT(*) FILTER (WHERE type='release')     AS ada_release,
             COUNT(*) FILTER (WHERE delta <> 0)         AS delta_bukan_nol,
             SUM(delta)                                 AS total_delta
      FROM credit_ledger
      WHERE type IN ('capture','release') AND job_id IS NOT NULL
      GROUP BY job_id
      HAVING COUNT(*) > 1
         AND (COUNT(*) FILTER (WHERE type='release') > 0
              OR COUNT(*) FILTER (WHERE delta <> 0) > 0)
      ORDER BY 2 DESC`,
  },
  {
    nama: "Capture berdelta POSITIF",
    pemblokir: true,
    catatan:
      "Bentuk ini tidak pernah ditulis kode mana pun dan tidak tercakup pelabelan ulang 0030 (yang hanya menangani delta < 0). Ia akan menabrak CHECK baru. Telusuri asalnya sebelum migrasi.",
    sql: `SELECT id, job_id, user_id, delta, created_at
          FROM credit_ledger WHERE type='capture' AND delta > 0 ORDER BY created_at`,
  },
  {
    nama: "Capture berdelta negatif (biaya regenerate salah label)",
    pemblokir: false,
    catatan: "Dilabeli ulang jadi 'regen' oleh migrasi 0030. Saldo TIDAK berubah — hanya labelnya.",
    sql: `SELECT job_id, COUNT(*) AS jumlah, SUM(delta) AS total_delta
          FROM credit_ledger WHERE type='capture' AND delta < 0
          GROUP BY job_id ORDER BY 2 DESC`,
  },
  {
    nama: "Capture ganda berdelta NOL",
    pemblokir: false,
    catatan: "Diarsipkan lalu dibersihkan otomatis oleh 0031. Tidak menggerakkan saldo.",
    sql: `
      SELECT job_id, COUNT(*) AS terminal FROM credit_ledger
      WHERE type IN ('capture','release') AND job_id IS NOT NULL
      GROUP BY job_id
      HAVING COUNT(*) > 1
         AND COUNT(*) FILTER (WHERE type='release') = 0
         AND COUNT(*) FILTER (WHERE delta <> 0) = 0
      ORDER BY 2 DESC`,
  },
  {
    nama: "Job READY yang hold-nya belum ter-capture",
    pemblokir: false,
    catatan: "Dirapikan reconciler. Capture berdelta nol — saldo tidak bergerak.",
    sql: `
      SELECT j.id AS job_id, j.user_id FROM jobs j
      WHERE j.state='READY'
        AND EXISTS (SELECT 1 FROM credit_ledger h WHERE h.job_id=j.id AND h.type='hold')
        AND NOT EXISTS (SELECT 1 FROM credit_ledger t WHERE t.job_id=j.id AND t.type IN ('capture','release'))
      ORDER BY j.id`,
  },
];

const client = await pool.connect();
let pemblokirDitemukan = [];

try {
  // Satu snapshot untuk SEMUA pemeriksaan: tanpa ini, angka dari query pertama
  // dan ketiga bisa berasal dari keadaan database yang berbeda, dan kesimpulan
  // gabungannya tidak pernah benar-benar pernah ada.
  await client.query("SET statement_timeout = '60s'");
  await client.query("BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ");

  for (const p of PEMERIKSAAN) {
    const r = await client.query(p.sql);
    const tanda = p.pemblokir ? "[PEMBLOKIR]" : "[info]";
    console.log(`\n=== ${tanda} ${p.nama} — ${r.rowCount} baris`);
    console.log(`    ${p.catatan}`);
    if (r.rowCount === 0) { console.log("    (tidak ada)"); continue; }
    if (p.pemblokir) pemblokirDitemukan.push(`${p.nama} (${r.rowCount})`);
    // TANPA potongan: ini inventaris korban, bukan cuplikan.
    for (const baris of r.rows) console.log("   ", JSON.stringify(baris));
  }

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => undefined);
  console.error("\nAUDIT GAGAL:", err.message);
  console.error("Gagal memeriksa bukan izin untuk lanjut. Jangan jalankan migrasi.");
  client.release();
  await pool.end();
  process.exit(2);
} finally {
  client.release();
  await pool.end();
}

console.log("\n────────────────────────────────────────");
if (pemblokirDitemukan.length > 0) {
  console.log("MIGRASI JANGAN DIJALANKAN. Pemblokir yang ditemukan:");
  for (const b of pemblokirDitemukan) console.log(`  - ${b}`);
  console.log("\nSelesaikan rekonsiliasinya dulu, lalu jalankan audit ini lagi.");
  process.exit(1);
}
console.log("Tidak ada pemblokir. Lanjutkan dengan dry-run migrasi.");
process.exit(0);
