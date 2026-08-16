import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance } from "@/lib/postgres/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/org — org + saldo user yang lagi login (dashboard
// enterprise/brand, F-ENT-01).
//
// Route ini SEMPAT memakai memberships[0] sendiri dengan alasan "pengecekan
// akses sesungguhnya ada di layout" — dan itu keliru: route API tidak dilindungi
// oleh layout halaman. Akibatnya sesudah gerbang organisasi tertangguh dipasang
// di dashboard-auth, satu-satunya route yang tidak memakainya tetap membocorkan
// identitas organisasi, statusnya, role, dan SALDO ke anggota org yang sudah
// ditangguhkan (temuan audit QA putaran kedua, 16 Agu 2026).
//
// Sekarang memakai gerbang yang sama dengan seluruh dashboard API. Satu pintu,
// bukan satu pintu plus satu jendela.
export async function GET(req: Request) {
  try {
    const { membership } = await requireOrgContextApi(req);
    if (!membership) throw ERR.BAD_REQUEST("Akun ini belum jadi anggota organisasi manapun.", "User has no org membership.");

    const balance = postgresRuntimeEnabled()
      ? await pgGetOrgBalance(membership.org_id)
      : getOrgBalance(membership.org_id);

    return Response.json({
      org: { id: membership.org_id, name: membership.org_name, slug: membership.org_slug, status: membership.org_status },
      role: membership.role,
      balance_idr: balance,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
