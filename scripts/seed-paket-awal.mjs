/**
 * ISI AWAL harga dan paket — supaya sistem bisa langsung diuji ujung ke ujung.
 *
 * Angka di bawah adalah CONTOH yang Brian sebutkan pada 2 Sep 2026 (Standard
 * Rp10.000, Premium Rp15.000, Ultra Rp20.000; paket Pemula berisi 10 Standard
 * + 5 Premium + 1 Ultra). Semuanya bisa diubah dari /admin/paket tanpa deploy —
 * skrip ini hanya mengisi keadaan kosong supaya ada yang bisa dicoba.
 *
 * AMAN DIJALANKAN ULANG: harga dan paket di-upsert per id. Ia TIDAK pernah
 * menyentuh langganan yang sudah berjalan — kuota langganan disalin saat
 * pembelian, jadi mengubah paket di sini tidak mengubah apa pun yang sudah
 * dibeli orang.
 */
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error("Butuh DATABASE_URL PostgreSQL.");
}

const HARGA = { standard: 10_000, premium: 15_000, ultra: 20_000 };

const PAKET = [
  { id: "pemula",  nama: "Pemula",  keterangan: "Buat yang baru mulai bikin konten", harga: 150_000, s: 10, p: 5,  u: 1, urutan: 1 },
  { id: "kreator", nama: "Kreator", keterangan: "Untuk yang posting tiap hari",      harga: 350_000, s: 25, p: 12, u: 3, urutan: 2 },
  { id: "bisnis",  nama: "Bisnis",  keterangan: "Untuk brand dengan banyak produk",  harga: 750_000, s: 50, p: 30, u: 8, urutan: 3 },
];

const pool = new Pool({ connectionString: databaseUrl });
const now = new Date().toISOString();
try {
  for (const [jenis, harga] of Object.entries(HARGA)) {
    await pool.query(
      `INSERT INTO harga_kredit_video (jenis, harga_idr, aktif, diubah_oleh, diubah_pada)
       VALUES ($1,$2,TRUE,'seed',$3)
       ON CONFLICT (jenis) DO UPDATE SET harga_idr = EXCLUDED.harga_idr, aktif = TRUE, diubah_pada = EXCLUDED.diubah_pada`,
      [jenis, harga, now],
    );
    console.log(`harga ${jenis}: Rp${harga.toLocaleString("id-ID")}`);
  }

  for (const p of PAKET) {
    await pool.query(
      `INSERT INTO paket_langganan (id,nama,keterangan,harga_idr,kuota_standard,kuota_premium,kuota_ultra,masa_hari,urutan,aktif,dibuat_pada,diubah_pada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,30,$8,TRUE,$9,$9)
       ON CONFLICT (id) DO UPDATE SET nama=EXCLUDED.nama, keterangan=EXCLUDED.keterangan, harga_idr=EXCLUDED.harga_idr,
         kuota_standard=EXCLUDED.kuota_standard, kuota_premium=EXCLUDED.kuota_premium, kuota_ultra=EXCLUDED.kuota_ultra,
         masa_hari=EXCLUDED.masa_hari, urutan=EXCLUDED.urutan, aktif=TRUE, diubah_pada=EXCLUDED.diubah_pada`,
      [p.id, p.nama, p.keterangan, p.harga, p.s, p.p, p.u, p.urutan, now],
    );
    console.log(`paket ${p.nama}: Rp${p.harga.toLocaleString("id-ID")} — ${p.s}S/${p.p}P/${p.u}U, 30 hari`);
  }

  // Paket gratis untuk akun yang SUDAH ADA sebelum aturan ini berlaku.
  // Pendaftar baru menerimanya otomatis saat akun dibuat; yang lama tidak akan
  // pernah menerimanya kalau tidak dari sini — dan akun tanpa jatah apa pun
  // tidak bisa dipakai menguji apa pun.
  const { rows } = await pool.query(
    `SELECT u.id FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM kredit_video k WHERE k.user_id = u.id AND k.tipe = 'bonus')`,
  );
  for (const u of rows) {
    await pool.query(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES ($1,$2,'premium','topup',1,'bonus',NULL,NULL,NULL,$3,$4)`,
      [crypto.randomUUID(), u.id, "paket gratis (akun lama)", now],
    );
  }
  console.log(`paket gratis diberikan ke ${rows.length} akun lama`);
} finally {
  await pool.end();
}
