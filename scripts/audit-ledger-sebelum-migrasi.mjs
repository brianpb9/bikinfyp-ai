#!/usr/bin/env node
/**
 * Audit ledger SEBELUM migrasi 0030/0031 dijalankan. HANYA MEMBACA.
 *
 * Migrasi memperbaiki LABEL, dan itu memang yang seharusnya ia lakukan — ia
 * tidak boleh menyentuh saldo siapa pun. Tapi pelabelan yang benar tidak
 * otomatis memperbaiki UANG yang sudah salah tempat sebelumnya, dan ada satu
 * pola yang perlu dilihat manusia dulu:
 *
 *   job REFUNDED + ada hold + ada "capture" berdelta negatif + TIDAK ada release
 *
 * Job itu dinyatakan gagal dan dikembalikan, tapi hold dasarnya tidak pernah
 * benar-benar dikembalikan — karena baris capture palsu tadi terlihat seperti
 * catatan terminal, sehingga releaseCredits menyerah. Pengguna kehilangan uang
 * untuk video yang tidak pernah mereka terima, dan tidak ada error di mana pun.
 *
 * Skrip ini TIDAK memperbaiki apa pun. Ia mencetak daftarnya supaya keputusan
 * pengembaliannya diambil sadar, per kasus.
 *
 * Pakai:
 *   DATABASE_URL='postgres://...' node scripts/audit-ledger-sebelum-migrasi.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib diisi.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 3 });

const PERTANYAAN = [
  {
    nama: "Job REFUNDED yang hold-nya TIDAK pernah dikembalikan",
    catatan: "Perlu keputusan manusia: kembalikan manual, atau buktikan sudah ditangani di luar sistem.",
    sql: `
      SELECT j.id AS job_id, j.user_id, j.org_id, j.state,
             COALESCE(-SUM(l.delta) FILTER (WHERE l.type='hold'), 0) AS hold_idr,
             COUNT(*) FILTER (WHERE l.type='capture' AND l.delta < 0) AS capture_palsu,
             COUNT(*) FILTER (WHERE l.type='release') AS release_ada
      FROM jobs j JOIN credit_ledger l ON l.job_id = j.id
      WHERE j.state IN ('REFUNDED','FAILED')
      GROUP BY j.id, j.user_id, j.org_id, j.state
      HAVING COUNT(*) FILTER (WHERE l.type='release') = 0
         AND COALESCE(-SUM(l.delta) FILTER (WHERE l.type='hold'), 0) > 0
      ORDER BY hold_idr DESC LIMIT 100`,
  },
  {
    nama: "Baris 'capture' berdelta negatif (biaya regenerate yang salah label)",
    catatan: "Akan dilabeli ulang jadi 'regen' oleh migrasi 0030. Saldo TIDAK berubah.",
    sql: `
      SELECT job_id, COUNT(*) AS jumlah, SUM(delta) AS total_delta
      FROM credit_ledger WHERE type='capture' AND delta < 0
      GROUP BY job_id ORDER BY jumlah DESC LIMIT 100`,
  },
  {
    nama: "Job dengan LEBIH DARI SATU catatan terminal",
    catatan: "Yang murni capture delta 0 dibereskan otomatis. Yang memuat release MENGHENTIKAN migrasi — itu memang disengaja.",
    sql: `
      SELECT job_id,
             COUNT(*) AS terminal,
             COUNT(*) FILTER (WHERE type='release') AS ada_release,
             COUNT(*) FILTER (WHERE delta <> 0) AS delta_bukan_nol
      FROM credit_ledger
      WHERE type IN ('capture','release') AND job_id IS NOT NULL
      GROUP BY job_id HAVING COUNT(*) > 1
      ORDER BY terminal DESC LIMIT 100`,
  },
  {
    nama: "Job READY yang hold-nya belum ter-capture",
    catatan: "Dirapikan otomatis oleh reconciler. Tidak menggerakkan saldo (capture berdelta nol).",
    sql: `
      SELECT j.id AS job_id, j.user_id
      FROM jobs j
      WHERE j.state='READY'
        AND EXISTS (SELECT 1 FROM credit_ledger h WHERE h.job_id=j.id AND h.type='hold')
        AND NOT EXISTS (SELECT 1 FROM credit_ledger t WHERE t.job_id=j.id AND t.type IN ('capture','release'))
      LIMIT 100`,
  },
];

let adaYangPerluManusia = false;

try {
  for (const p of PERTANYAAN) {
    const r = await pool.query(p.sql);
    console.log(`\n=== ${p.nama} — ${r.rowCount} baris`);
    console.log(`    ${p.catatan}`);
    if (r.rowCount === 0) { console.log("    (tidak ada)"); continue; }
    if (p.nama.startsWith("Job REFUNDED")) adaYangPerluManusia = true;
    for (const baris of r.rows.slice(0, 20)) console.log("   ", JSON.stringify(baris));
    if (r.rowCount > 20) console.log(`    ... dan ${r.rowCount - 20} lagi`);
  }

  console.log("\n────────────────────────────────────────");
  if (adaYangPerluManusia) {
    console.log("PERLU KEPUTUSAN MANUSIA sebelum migrasi: ada job gagal yang hold-nya tidak dikembalikan.");
    console.log("Migrasi 0030/0031 TIDAK akan memperbaikinya — ia hanya memperbaiki label, dan itu memang batasnya.");
  } else {
    console.log("Tidak ada pola yang menuntut keputusan manusia. Lanjutkan dengan dry-run migrasi.");
  }
} finally {
  await pool.end();
}
