/**
 * PASANG katalog yang direkomendasikan ke database.
 *
 * Angkanya TIDAK diketik di sini — semuanya datang dari
 * lib/katalog-rekomendasi.ts, yang marginnya dijaga tes
 * (tests/katalog-margin.test.ts). Skrip yang mengetik ulang angkanya sendiri
 * akan hanyut dari katalog yang diuji, dan yang hanyut adalah harga jual.
 *
 * AMAN DIJALANKAN ULANG: harga dan paket di-upsert per id. Ia TIDAK PERNAH
 * menyentuh langganan yang sudah berjalan — kuota langganan disalin saat
 * pembelian, jadi mengubah paket di sini tidak mengubah apa pun yang sudah
 * dibeli orang.
 *
 * Semua angka tetap bisa diubah dari /admin/paket tanpa deploy; skrip ini
 * hanya menetapkan titik awalnya.
 */
import crypto from "node:crypto";
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { config } from "../lib/config";
import { JENIS_VIDEO } from "../lib/kredit-video";
import {
  HARGA_SATUAN,
  PAKET_REKOMENDASI,
  hitungPaket,
  marginSatuan,
  modalPerVideo,
} from "../lib/katalog-rekomendasi";

const pool = getPool(config.databaseUrl);
const now = new Date().toISOString();
const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

try {
  for (const jenis of JENIS_VIDEO) {
    const harga = HARGA_SATUAN[jenis];
    await pool.query(
      `INSERT INTO harga_kredit_video (jenis, harga_idr, aktif, diubah_oleh, diubah_pada)
       VALUES ($1,$2,TRUE,'katalog-rekomendasi',$3)
       ON CONFLICT (jenis) DO UPDATE SET harga_idr = EXCLUDED.harga_idr, aktif = TRUE,
                                         diubah_oleh = EXCLUDED.diubah_oleh, diubah_pada = EXCLUDED.diubah_pada`,
      [jenis, harga, now],
    );
    console.log(
      `harga ${jenis.padEnd(9)} ${rp(harga).padStart(10)}  modal ${rp(modalPerVideo(jenis)).padStart(10)}  margin ${(marginSatuan(jenis) * 100).toFixed(1)}%`,
    );
  }

  // Paket lama yang tidak ada lagi di katalog DINONAKTIFKAN, bukan dibiarkan
  // hidup. Paket yang tertinggal dari seed sebelumnya akan tetap dipajang dan
  // tetap bisa dibeli — dengan isi dan harga yang sudah tidak kita hitung lagi.
  const dikenal = PAKET_REKOMENDASI.map((p) => p.id);
  const usang = await pool.query<{ id: string }>(
    `UPDATE paket_langganan SET aktif = FALSE, diubah_pada = $1
      WHERE aktif = TRUE AND NOT (id = ANY($2::text[])) RETURNING id`,
    [now, dikenal],
  );
  for (const u of usang.rows) console.log(`paket usang dinonaktifkan: ${u.id}`);

  for (const p of PAKET_REKOMENDASI) {
    await pool.query(
      `INSERT INTO paket_langganan (id,nama,keterangan,harga_idr,kuota_standard,kuota_premium,kuota_ultra,masa_hari,urutan,aktif,dibuat_pada,diubah_pada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$10)
       ON CONFLICT (id) DO UPDATE SET nama=EXCLUDED.nama, keterangan=EXCLUDED.keterangan, harga_idr=EXCLUDED.harga_idr,
         kuota_standard=EXCLUDED.kuota_standard, kuota_premium=EXCLUDED.kuota_premium, kuota_ultra=EXCLUDED.kuota_ultra,
         masa_hari=EXCLUDED.masa_hari, urutan=EXCLUDED.urutan, aktif=TRUE, diubah_pada=EXCLUDED.diubah_pada`,
      [p.id, p.nama, p.keterangan, p.hargaIdr, p.kuota.standard, p.kuota.premium, p.kuota.ultra, p.masaHari, p.urutan, now],
    );
    const h = hitungPaket(p);
    console.log(
      `paket ${p.nama.padEnd(8)} ${rp(p.hargaIdr).padStart(10)}  ` +
        `${p.kuota.standard}S/${p.kuota.premium}P/${p.kuota.ultra}U = ${h.totalVideo} video  ` +
        `modal ${rp(h.modalIdr).padStart(10)}  margin ${(h.marginPersen * 100).toFixed(1)}%  hemat ${(h.hematPersen * 100).toFixed(0)}%`,
    );
  }

  // Paket gratis untuk akun yang SUDAH ADA sebelum aturan ini berlaku.
  // Pendaftar baru menerimanya otomatis saat akun dibuat; yang lama tidak akan
  // pernah menerimanya kalau tidak dari sini — dan akun tanpa jatah apa pun
  // tidak bisa dipakai menguji apa pun.
  const { rows } = await pool.query<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM kredit_video k WHERE k.user_id = u.id AND k.tipe = 'bonus')`,
  );
  for (const u of rows) {
    await pool.query(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES ($1,$2,$3,'topup',$4,'bonus',NULL,NULL,NULL,$5,$6)`,
      [crypto.randomUUID(), u.id, config.signupBonusJenis, config.signupBonusQty, "paket gratis (akun lama)", now],
    );
  }
  console.log(`paket gratis diberikan ke ${rows.length} akun lama`);
} finally {
  // closeAllPools, bukan pool.end(): pool-nya dibagikan seluruh proses, dan
  // lib/postgres/pool.ts melarang keras kode lain menutupnya sendiri.
  await closeAllPools();
}
