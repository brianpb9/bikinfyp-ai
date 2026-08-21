/**
 * P0-B3 — SUMBER BARIS untuk audit bukti produk.
 *
 * Dipisah dari skrip CLI dengan satu alasan: sifat HANYA-BACA hanya berarti
 * sesuatu kalau ada test yang membuktikannya, dan skrip top-level-await tidak
 * bisa di-import oleh test tanpa ikut menjalankannya.
 *
 * KENAPA KONEKSI SQLITE SENDIRI, BUKAN `getDb()` (temuan Reviewer, 21 Agu — ia
 * benar, dan akibatnya lebih besar dari yang ia tulis). `lib/db.ts:getDb()`
 * bukan pembuka koneksi: ia menjalankan `ensureDirs()`, menyalakan WAL,
 * meng-exec seluruh schema, lalu menjalankan migrasi — termasuk
 * `DROP TABLE otp_codes`, sederet `ALTER TABLE`, sebuah `UPDATE jobs`, dan
 * pembangunan ulang tabel `users` lewat rename. Alat UKUR yang memanggilnya
 * akan MENGUBAH database yang sedang diukur, dan angkanya jadi angka dari
 * database yang berbeda dari yang dilaporkannya.
 *
 * Karena itu: `readonly: true` (SQLite menolak setiap tulis di level driver,
 * bukan sekadar janji di komentar) dan `fileMustExist: true` (database yang
 * tidak ada dilaporkan sebagai galat, bukan dibuatkan kosong lalu diaudit
 * sebagai "nol produk" — laporan bersih dari database yang baru saja kita
 * ciptakan sendiri adalah kebohongan yang paling meyakinkan).
 */
import { bacaKolomImages, type ProdukUntukAudit } from "./audit-bukti-produk";
import { config } from "./config";

const SQL = "SELECT id, org_id, name, images FROM products ORDER BY created_at";

type BarisMentah = { id: string; org_id: string | null; name: string | null; images: unknown };

function keProduk(r: BarisMentah): ProdukUntukAudit {
  return { id: r.id, orgId: r.org_id ?? null, nama: r.name ?? null, images: bacaKolomImages(r.images) };
}

export async function* dariPostgres(url = config.databaseUrl): AsyncGenerator<ProdukUntukAudit> {
  if (!url) throw new Error("DATABASE_URL kosong; audit postgres butuh koneksi.");
  const { getPool } = await import("./postgres/pool");
  const { rows } = await getPool(url).query<BarisMentah>(SQL);
  for (const r of rows) yield keProduk(r);
}

export async function* dariSqlite(dbPath = config.dbPath): AsyncGenerator<ProdukUntukAudit> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    for (const r of db.prepare(SQL).all() as BarisMentah[]) yield keProduk(r);
  } finally {
    db.close();
  }
}

export function sumberDefault(): AsyncGenerator<ProdukUntukAudit> {
  return config.dbRuntime === "postgres" ? dariPostgres() : dariSqlite();
}
