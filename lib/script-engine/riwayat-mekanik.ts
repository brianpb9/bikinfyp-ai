// RIWAYAT MEKANIK PER MEREK — sumber anti-repeat 30 hari.
//
// Audit A5 menemukan mekanismenya lengkap tapi mati: urutkanMekanik() dan
// HARI_ANTI_ULANG sudah ada, `mekanikBaruDipakai` sudah jadi parameter
// pilihIde() — dan tidak ada satu pun pemanggil yang mengisinya. Jendela 30
// hari selalu dinilai terhadap array kosong, jadi tiap permintaan melihat bank
// mekanik dalam urutan yang sama persis.
//
// KENAPA BUKAN KOLOM SENDIRI (keputusan Brian 20 Agu). Alasan yang DULU
// ditulis di sini — "migrasi terkunci" — sudah kedaluwarsa: 0030-0032
// terpasang sejak 18 Agu (diverifikasi 20 Agu, dry-run would_apply kosong).
// Bentuk JSON dipertahankan karena cocok, bukan karena terpaksa. Teks lama:
// migrasi terkunci sampai
// rekonsiliasi ledger selesai. Mekaniknya dibaca dari kolom JSON yang SUDAH
// ada — scripts.validation_result -> admisi.mechanic — pola yang sama dengan
// products.raw_meta.brand. Kolom khusus menyusul sebagai keputusan tersendiri.
//
// KENAPA "PER MEREK", bukan per produk: MASTER-UGC-AFFILIATE §7 menuntut
// variasi katalog per talent/merek — dua SKU dari merek yang sama, dipromosikan
// akun yang sama, dengan mekanik yang sama, tetap terbaca berulang oleh
// penonton. Produk tanpa merek jatuh ke riwayat produknya sendiri: itu jawaban
// paling jujur yang bisa diberikan tanpa menebak merek (lihat qc.ts — menebak
// merek sudah dua kali salah).

import type { IdMekanik } from "./idea-mechanics";
import { MEKANIK_BY_ID } from "./idea-mechanics";

/** Jendela anti-ulang. Sama dengan HARI_ANTI_ULANG di idea-mechanics. */
export const HARI_RIWAYAT = 30;

/** Bentuk baris yang dibaca dari kedua runtime. */
export interface BarisRiwayat {
  mechanic: string | null;
}

/** Saring ke id mekanik yang benar-benar dikenal bank, urut, tanpa duplikat. */
export function bersihkanRiwayat(rows: BarisRiwayat[]): IdMekanik[] {
  const keluar: IdMekanik[] = [];
  for (const r of rows) {
    const id = (r.mechanic ?? "").trim();
    if (!id) continue;
    if (!(id in MEKANIK_BY_ID)) continue; // mekanik yang sudah pensiun/salah ketik
    if (keluar.includes(id as IdMekanik)) continue;
    keluar.push(id as IdMekanik);
  }
  return keluar;
}

/**
 * SQL PostgreSQL — dibiarkan sebagai konstanta supaya bisa diuji dan dibaca
 * tanpa menjalankan basis data.
 *
 * $1 = product_id yang sedang dibuatkan naskah, $2 = ambang waktu ISO.
 * Merek diambil dari produk itu; kalau kosong, pencocokan jatuh ke product_id.
 */
export const SQL_RIWAYAT_PG = `
  WITH acuan AS (
    SELECT id, NULLIF(TRIM(COALESCE(raw_meta::jsonb->>'brand', '')), '') AS brand
    FROM products WHERE id = $1
  )
  SELECT s.validation_result::jsonb->'admisi'->>'mechanic' AS mechanic
  FROM scripts s
  JOIN products p ON p.id = s.product_id
  CROSS JOIN acuan a
  WHERE s.created_at >= $2
    AND (
      (a.brand IS NOT NULL AND NULLIF(TRIM(COALESCE(p.raw_meta::jsonb->>'brand', '')), '') = a.brand)
      OR (a.brand IS NULL AND p.id = a.id)
    )
    AND s.validation_result::jsonb->'admisi'->>'mechanic' IS NOT NULL
  ORDER BY s.created_at DESC
  LIMIT 50`;

/** Ambang waktu ISO untuk jendela riwayat. */
export function sejakKapan(hari = HARI_RIWAYAT, sekarang = new Date()): string {
  return new Date(sekarang.getTime() - hari * 86_400_000).toISOString();
}

/**
 * Riwayat dari SQLite (jalur rollback lokal). Bentuk kueri sama, dialeknya
 * beda: SQLite membaca JSON lewat json_extract, dan created_at-nya teks ISO
 * sehingga perbandingan string sudah benar secara kronologis.
 */
export function riwayatMekanikSqlite(
  db: { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } },
  productId: string,
  sejakIso: string
): IdMekanik[] {
  const acuan = db.prepare("SELECT raw_meta FROM products WHERE id = ?").all(productId) as { raw_meta: string | null }[];
  let brand: string | null = null;
  try { brand = (JSON.parse(acuan[0]?.raw_meta ?? "{}") as { brand?: string }).brand?.trim() || null; } catch { brand = null; }

  const rows = brand
    ? db.prepare(`
        SELECT json_extract(s.validation_result, '$.admisi.mechanic') AS mechanic
        FROM scripts s JOIN products p ON p.id = s.product_id
        WHERE s.created_at >= ? AND json_extract(p.raw_meta, '$.brand') = ?
        ORDER BY s.created_at DESC LIMIT 50`).all(sejakIso, brand)
    : db.prepare(`
        SELECT json_extract(s.validation_result, '$.admisi.mechanic') AS mechanic
        FROM scripts s
        WHERE s.created_at >= ? AND s.product_id = ?
        ORDER BY s.created_at DESC LIMIT 50`).all(sejakIso, productId);

  return bersihkanRiwayat(rows as BarisRiwayat[]);
}

/**
 * Riwayat mekanik merek untuk produk ini, memilih runtime yang aktif.
 *
 * Impor dinamis: modul ini dipakai script-engine yang IKUT ke bundel klien
 * (halaman /bikin/skrip memakai validator yang sama), dan menarik better-sqlite3
 * atau pg ke sana akan mematikan build front-end — pelajaran yang sama dengan
 * pemisahan standar-10-teks.ts.
 */
export async function riwayatMekanikMerek(productId: string, hari = HARI_RIWAYAT): Promise<IdMekanik[]> {
  const sejak = sejakKapan(hari);
  const { postgresRuntimeEnabled, pgMekanikDipakaiBrand } = await import("../postgres/smoke-runtime");
  if (postgresRuntimeEnabled()) return pgMekanikDipakaiBrand(productId, sejak);
  const { getDb } = await import("../db");
  return riwayatMekanikSqlite(getDb() as never, productId, sejak);
}
