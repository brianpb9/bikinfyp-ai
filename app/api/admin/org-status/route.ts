import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getPool } from "@/lib/postgres/pool";
import { config } from "@/lib/config";
import { pgAudit } from "@/lib/postgres/smoke-runtime";
import { emailBrandDisetujui, emailBrandDitangguhkan } from "@/lib/email-brand";
import { urlDashboardBrand } from "@/lib/asal-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIIZINKAN = ["pending", "active", "suspended"] as const;
type Status = (typeof DIIZINKAN)[number];

/**
 * POST /api/admin/org-status — menyetujui, menangguhkan, atau mengembalikan
 * organisasi brand ke antrean tinjauan.
 *
 * ---------------------------------------------------------------------------
 * KENAPA TIDAK MENAMBAH TOKEN DI SINI
 * ---------------------------------------------------------------------------
 * Keputusan Brian: brand mulai dengan token NOL. Menyetujui berarti membuka
 * pintu, bukan memberi saldo. Menggabungkan keduanya membuat "setujui" diam-diam
 * jadi keputusan keuangan, dan admin yang menekannya untuk membuka akses tidak
 * akan menyangka ia baru saja mengeluarkan uang.
 */
export async function POST(req: Request) {
  try {
    await wajibAdminApi(req);
    const body = (await req.json().catch(() => ({}))) as { org_id?: unknown; status?: unknown };
    const orgId = typeof body.org_id === "string" ? body.org_id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!orgId) throw ERR.BAD_REQUEST("org_id wajib diisi.", "org_id required.");
    if (!(DIIZINKAN as readonly string[]).includes(status)) {
      throw ERR.BAD_REQUEST(`Status harus salah satu dari: ${DIIZINKAN.join(", ")}.`, "Invalid status.");
    }

    const pool = getPool(config.databaseUrl);
    const hasil = await pool.query<{ name: string; status: string }>(
      "UPDATE organizations SET status = $2 WHERE id = $1 RETURNING name, status",
      [orgId, status as Status],
    );
    if (!hasil.rows[0]) throw ERR.BAD_REQUEST("Organisasinya tidak ditemukan.", "Org not found.");

    await pgAudit("admin", "org.status", "organizations", orgId, { status });

    // KABARI PEMILIKNYA. Layar /dashboard/menunggu berjanji "kami kabari lewat
    // email begitu selesai", dan sampai 8 Sep 2026 janji itu tidak pernah
    // ditepati — tidak ada satu baris kode pun yang mengirimnya. Brand yang
    // menunggu hanya bisa menebak lalu mencoba login lagi.
    //
    // Kegagalan email TIDAK membatalkan persetujuan: statusnya sudah tersimpan
    // di atas, dan melempar di sini membuat admin menekan tombolnya lagi.
    try {
      const pemilik = await pool.query<{ email: string }>(
        `SELECT u.email FROM org_members m JOIN users u ON u.id = m.user_id
          WHERE m.org_id = $1 AND m.role = 'owner' ORDER BY m.created_at LIMIT 1`, [orgId]);
      const ke = pemilik.rows[0]?.email;
      if (ke) {
        const nama = hasil.rows[0].name;
        if (status === "active") await emailBrandDisetujui({ ke, namaBrand: nama, url: urlDashboardBrand() });
        else if (status === "suspended") await emailBrandDitangguhkan({ ke, namaBrand: nama });
      } else {
        console.error(`[org-status] ${orgId}: tidak ada owner, email tidak dikirim`);
      }
    } catch (e) {
      console.error(`[org-status] ${orgId}: gagal mengirim email —`, e instanceof Error ? e.message : e);
    }

    return Response.json({ ok: true, nama: hasil.rows[0].name, status: hasil.rows[0].status });
  } catch (err) {
    return errorResponse(err);
  }
}
