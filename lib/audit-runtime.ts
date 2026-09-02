/**
 * SATU pintu untuk menulis audit, apa pun runtime-nya.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI ADA — DAN KENAPA BARU SEKARANG
 * ────────────────────────────────────────────────────────────────────────────
 * `audit()` di lib/db.ts menulis ke SQLite. Di production SQLite DIMATIKAN
 * (lib/database-config.ts menolaknya dengan sengaja), jadi memanggilnya di
 * sana melempar DatabaseConfigurationError — dan karena audit biasanya
 * dipanggil di ujung sebuah operasi yang sudah berhasil, kegagalannya muncul
 * sebagai HTTP 500 pada permintaan yang sebenarnya sudah selesai.
 *
 * Itu persis yang terjadi pada /api/kredit-video/checkout, 2 Sep 2026:
 * pesanan tersimpan, invoice Duitku terbentuk, lalu satu baris audit
 * menjatuhkan seluruh permintaan.
 *
 * Selama ini tiap rute menuliskan cabangnya sendiri:
 *
 *     if (postgresRuntimeEnabled()) await pgAudit(...); else audit(...);
 *
 * Cabang yang harus diulang di puluhan tempat adalah cabang yang cepat atau
 * lambat lupa ditulis di salah satunya — dan yang lupa tidak akan ketahuan di
 * dev, karena di dev SQLite justru hidup.
 */

import { postgresRuntimeEnabled } from "./postgres/smoke-runtime";

/**
 * Tulis satu baris audit ke runtime yang sedang aktif.
 *
 * KEGAGALANNYA TIDAK PERNAH MENJATUHKAN PEMANGGIL. Audit adalah catatan
 * tentang sesuatu yang sudah terjadi; membatalkan operasi yang sudah berhasil
 * karena catatannya gagal ditulis adalah menukar kerugian besar dengan
 * kerugian kecil. Kegagalannya dicatat ke log supaya tetap terlihat.
 */
export async function catatAudit(
  actor: string,
  action: string,
  entity: string,
  entityId: string | null,
  meta?: unknown,
): Promise<void> {
  try {
    if (postgresRuntimeEnabled()) {
      const { pgAudit } = await import("./postgres/smoke-runtime");
      await pgAudit(actor, action, entity, entityId, meta);
      return;
    }
    const { audit } = await import("./db");
    audit(actor, action, entity, entityId, meta);
  } catch (err) {
    console.error(`[audit] gagal mencatat ${action} untuk ${entity}/${entityId}:`, err);
  }
}
