/**
 * P0-B3 — jalankan audit bukti produk terhadap database yang dikonfigurasi.
 *
 *   npx tsx scripts/audit-bukti-produk.ts            # laporan siap-baca
 *   npx tsx scripts/audit-bukti-produk.ts --json     # keluaran mesin
 *   npx tsx scripts/audit-bukti-produk.ts --batas 50 # potong daftar terbrick
 *
 * HANYA BACA. Skrip ini tidak menulis ke database, tidak menulis ke storage,
 * dan tidak menyentuh jaringan. Ia menjawab satu pertanyaan: kalau penegakan
 * bukti dinyalakan hari ini, berapa produk yang berhenti bisa dirender, dan
 * kenapa masing-masing.
 *
 * Kenapa ini harus dijalankan SEBELUM penegakan: seluruh produk yang sudah
 * hidup dibuat sebelum kontrak bukti ada. Menyalakan gerbang tanpa mengetahui
 * angkanya berarti mengetahui akibatnya dari keluhan pengguna — yaitu
 * terlambat.
 */
import { auditBuktiProduk, laporanAudit, type ProdukUntukAudit } from "../lib/audit-bukti-produk";
import { config } from "../lib/config";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const iBatas = args.indexOf("--batas");
const batas = iBatas >= 0 ? Number(args[iBatas + 1]) : undefined;

/** `images` disimpan sebagai teks JSON di kedua runtime. */
function bacaImages(mentah: unknown): string[] {
  if (Array.isArray(mentah)) return mentah.filter((x): x is string => typeof x === "string");
  if (typeof mentah !== "string" || mentah.trim() === "") return [];
  try {
    const nilai = JSON.parse(mentah);
    return Array.isArray(nilai) ? nilai.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Kolom images yang tidak bisa dibaca BUKAN "produk tanpa foto": itu
    // kerusakan tersendiri, dan menyembunyikannya sebagai nol foto akan
    // membuat produk itu hilang dari angka kerusakan.
    console.warn(`[audit] kolom images tidak bisa dibaca, produk dilewati: ${String(mentah).slice(0, 80)}`);
    return [];
  }
}

async function* dariPostgres(): AsyncGenerator<ProdukUntukAudit> {
  const { getPool } = await import("../lib/postgres/pool");
  const pool = getPool(config.databaseUrl!);
  const { rows } = await pool.query<{ id: string; name: string | null; images: string }>(
    "SELECT id, name, images FROM products ORDER BY created_at"
  );
  for (const r of rows) yield { id: r.id, nama: r.name, images: bacaImages(r.images) };
}

async function* dariSqlite(): AsyncGenerator<ProdukUntukAudit> {
  const { getDb } = await import("../lib/db");
  const rows = getDb().prepare("SELECT id, name, images FROM products ORDER BY created_at").all() as {
    id: string;
    name: string | null;
    images: string;
  }[];
  for (const r of rows) yield { id: r.id, nama: r.name, images: bacaImages(r.images) };
}

const sumber = config.dbRuntime === "postgres" ? dariPostgres() : dariSqlite();
const hasil = await auditBuktiProduk(sumber, batas ? { simpanTerbrick: batas } : {});

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
