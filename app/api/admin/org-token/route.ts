/**
 * POST /api/admin/org-token — isi token dompet organisasi dari UI admin.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Sampai 8 Sep 2026 satu-satunya cara mengisi token brand adalah SSH ke server
 * produksi lalu menjalankan scripts/admin-grant-org-credit.mjs. Alur nyatanya:
 * setujui di UI, lalu buka terminal. Setiap brand baru menuntut akses shell
 * produksi, dan itu langkah yang paling mudah tertunda — brand duduk dengan
 * saldo nol sesudah "disetujui".
 *
 * ---------------------------------------------------------------------------
 * MENAMBAH, BUKAN MENETAPKAN
 * ---------------------------------------------------------------------------
 * Skrip CLI-nya menetapkan saldo TARGET lalu menghitung selisihnya. Untuk
 * tombol di UI itu berbahaya: admin yang mengetik "50000" hampir pasti
 * bermaksud MENAMBAH 50 ribu, bukan memaksa saldo jadi 50 ribu — dan kalau
 * saldonya sudah 200 ribu, salah tafsir itu MENGHAPUS 150 ribu milik pelanggan.
 *
 * Pengurangan sengaja tidak disediakan di sini: itu operasi langka yang pantas
 * dipikirkan matang di terminal, bukan disediakan sebagai tombol.
 */
import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import { pgAudit } from "@/lib/postgres/smoke-runtime";
import { emailTokenMasuk } from "@/lib/email-brand";
import { urlDashboardBrand } from "@/lib/asal-brand";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pagu satu transaksi. Bukan kebijakan harga — pengaman salah ketik.
 *  Menambah satu nol pada 500.000 menghasilkan 5.000.000, dan credit_ledger
 *  APPEND-ONLY: baris salah tidak bisa dihapus, hanya dilawan baris baru. */
const MAKS_SEKALI_IDR = 5_000_000;

export async function POST(req: Request) {
  try {
    await wajibAdminApi(req);
    const body = (await req.json().catch(() => ({}))) as { org_id?: unknown; jumlah_idr?: unknown; catatan?: unknown };
    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const jumlah = Number(body.jumlah_idr);
    const catatan = typeof body.catatan === "string" ? body.catatan.slice(0, 200) : "";

    if (!orgId) throw ERR.BAD_REQUEST("org_id wajib diisi.", "org_id required.");
    if (!Number.isInteger(jumlah) || jumlah <= 0)
      throw ERR.BAD_REQUEST("Jumlahnya harus bilangan bulat positif.", "jumlah_idr must be a positive integer.");
    if (jumlah > MAKS_SEKALI_IDR)
      throw ERR.BAD_REQUEST(
        `Sekali isi maksimal Rp${MAKS_SEKALI_IDR.toLocaleString("id-ID")}. Ulangi kalau memang perlu lebih.`,
        "Amount exceeds single-transaction cap."
      );

    const pool = getPool(config.databaseUrl);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Baris organisasi dikunci LEBIH DULU, sama seperti jalur hold/capture di
      // PgCreditPaymentRepository: dua admin yang menekan tombol bersamaan harus
      // berbaris, bukan sama-sama membaca saldo lama.
      const org = await client.query<{ id: string; name: string; status: string }>(
        "SELECT id, name, status FROM organizations WHERE id = $1 FOR UPDATE", [orgId]);
      if (!org.rows[0]) throw ERR.BAD_REQUEST("Organisasinya tidak ditemukan.", "Org not found.");

      const owner = await client.query<{ user_id: string; email: string }>(
        `SELECT m.user_id, u.email FROM org_members m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1 AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`, [orgId]);
      if (!owner.rows[0])
        throw ERR.BAD_REQUEST("Organisasi ini belum punya owner.", "Org has no owner to attribute the grant to.");

      // user_id TETAP diisi meski dompetnya milik org — itu jejak audit siapa
      // penanggung jawabnya, dan saldo org dibaca lewat org_id.
      await client.query(
        `INSERT INTO credit_ledger (id, user_id, org_id, delta, type, job_id, payment_id, created_at)
         VALUES ($1,$2,$3,$4,'bonus',NULL,NULL,$5)`,
        [crypto.randomUUID(), owner.rows[0].user_id, orgId, jumlah, new Date().toISOString()]);

      const saldo = await client.query<{ b: string }>(
        "SELECT COALESCE(SUM(delta),0)::text AS b FROM credit_ledger WHERE org_id = $1", [orgId]);
      await client.query("COMMIT");

      const saldoIdr = Number(saldo.rows[0]!.b);
      await pgAudit("admin", "org.token", "organizations", orgId,
        { delta_idr: jumlah, saldo_idr: saldoIdr, owner_user_id: owner.rows[0].user_id, catatan });

      // Kegagalan email tidak membatalkan pengisian — tokennya sudah masuk.
      try {
        await emailTokenMasuk({
          ke: owner.rows[0].email, namaBrand: org.rows[0].name,
          jumlahIdr: jumlah, saldoIdr, url: urlDashboardBrand(),
        });
      } catch (e) {
        console.error(`[org-token] ${orgId}: email gagal —`, e instanceof Error ? e.message : e);
      }

      return Response.json({ ok: true, nama: org.rows[0].name, ditambah_idr: jumlah, saldo_idr: saldoIdr });
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
