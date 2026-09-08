/**
 * POST /api/admin/org-token — isi JATAH VIDEO dompet organisasi dari UI admin.
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
 * JATAH PER JENIS, BUKAN RUPIAH (Brian 9 Sep 2026)
 * ---------------------------------------------------------------------------
 * Versi pertama route ini memberi RUPIAH ke credit_ledger, karena itulah yang
 * dipakai brand saat itu. Brian menemukan bahwa retail sudah lama pindah ke
 * jatah per jenis (standard/premium/ultra) dan brand tertinggal.
 *
 * Sekarang keduanya memakai kredit_video. Yang diberikan adalah JUMLAH VIDEO,
 * bukan sejumlah uang — dan itu juga yang bisa dijawab saat brand bertanya
 * "sisa berapa?": "5 video standard", bukan "Rp75.000".
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
import { JENIS_VIDEO, type JenisVideo } from "@/lib/kredit-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pagu satu transaksi. Bukan kebijakan harga — pengaman salah ketik.
 *  Menambah satu nol pada 20 menghasilkan 200, dan kredit_video sama
 *  APPEND-ONLY-nya: baris salah dilawan baris baru, tidak dihapus. */
const MAKS_SEKALI_VIDEO = 200;

export async function POST(req: Request) {
  try {
    await wajibAdminApi(req);
    const body = (await req.json().catch(() => ({}))) as
      { org_id?: unknown; jenis?: unknown; jumlah?: unknown; catatan?: unknown };
    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const jenis = String(body.jenis ?? "") as JenisVideo;
    const jumlah = Number(body.jumlah);
    const catatan = typeof body.catatan === "string" ? body.catatan.slice(0, 200) : "";

    if (!orgId) throw ERR.BAD_REQUEST("org_id wajib diisi.", "org_id required.");
    if (!JENIS_VIDEO.includes(jenis))
      throw ERR.BAD_REQUEST(`Jenisnya harus salah satu dari: ${JENIS_VIDEO.join(", ")}.`, "Invalid jenis.");
    if (!Number.isInteger(jumlah) || jumlah <= 0)
      throw ERR.BAD_REQUEST("Jumlah videonya harus bilangan bulat positif.", "jumlah must be a positive integer.");
    if (jumlah > MAKS_SEKALI_VIDEO)
      throw ERR.BAD_REQUEST(
        `Sekali isi maksimal ${MAKS_SEKALI_VIDEO} video. Ulangi kalau memang perlu lebih.`,
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
        `INSERT INTO kredit_video (id,user_id,org_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
         VALUES ($1,$2,$3,$4,'topup',$5,'bonus',NULL,NULL,NULL,$6,$7)`,
        [crypto.randomUUID(), owner.rows[0].user_id, orgId, jenis, jumlah,
         catatan || "top-up admin", new Date().toISOString()]);

      const saldo = await client.query<{ jenis: JenisVideo; sisa: string }>(
        "SELECT jenis, COALESCE(SUM(delta),0)::text AS sisa FROM kredit_video WHERE org_id = $1 AND ember = 'topup' GROUP BY jenis",
        [orgId]);
      await client.query("COMMIT");

      const sisa: Record<string, number> = {};
      for (const b of saldo.rows) sisa[b.jenis] = Number(b.sisa);
      await pgAudit("admin", "org.token", "organizations", orgId,
        { jenis, jumlah, sisa, owner_user_id: owner.rows[0].user_id, catatan });

      // Kegagalan email tidak membatalkan pengisian — tokennya sudah masuk.
      try {
        await emailTokenMasuk({
          ke: owner.rows[0].email, namaBrand: org.rows[0].name,
          jenis, jumlah, sisa, url: urlDashboardBrand(),
        });
      } catch (e) {
        console.error(`[org-token] ${orgId}: email gagal —`, e instanceof Error ? e.message : e);
      }

      return Response.json({ ok: true, nama: org.rows[0].name, jenis, ditambah: jumlah, sisa });
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
