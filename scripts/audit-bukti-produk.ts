/**
 * P0-B3 — jalankan audit bukti produk terhadap database yang dikonfigurasi.
 *
 *   npx tsx scripts/audit-bukti-produk.ts            # laporan siap-baca
 *   npx tsx scripts/audit-bukti-produk.ts --json     # keluaran mesin
 *   npx tsx scripts/audit-bukti-produk.ts --batas 50 # potong daftar terbrick
 *
 * HANYA BACA. Tidak menulis ke database, tidak menulis ke storage, tidak
 * menyentuh jaringan. Jalur SQLite dibuka dengan `readonly: true` — lihat
 * lib/audit-sumber-produk.ts untuk alasan lengkapnya.
 *
 * Skrip ini sengaja tipis: seluruh logika yang bisa salah hitung ada di
 * pustaka, tempat test bisa menjangkaunya.
 */
import { auditBuktiProduk, laporanAudit } from "../lib/audit-bukti-produk";
import { sumberDefault } from "../lib/audit-sumber-produk";
import { config } from "../lib/config";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const iBatas = args.indexOf("--batas");
const batas = iBatas >= 0 ? Number(args[iBatas + 1]) : undefined;

const hasil = await auditBuktiProduk(sumberDefault(), batas ? { simpanTerbrick: batas } : {});

if (asJson) {
  process.stdout.write(JSON.stringify(hasil, null, 2) + "\n");
} else {
  process.stdout.write(`${laporanAudit(hasil)}\n`);
}

// Kode keluar SENGAJA 0 walau ada produk terbrick. Ini alat UKUR, bukan
// gerbang: exit non-nol akan membuatnya tidak bisa dipakai di pipeline yang
// hanya ingin angkanya, dan angka itulah gunanya.
if (config.dbRuntime === "postgres") {
  const { closePool } = await import("../lib/postgres/pool");
  await closePool?.();
}
