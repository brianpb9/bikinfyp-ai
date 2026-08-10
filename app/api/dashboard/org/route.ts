import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getUserOrgs, getOrgBalance } from "@/lib/org";
import { pgGetUserOrgs, pgGetOrgBalance } from "@/lib/postgres/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/dashboard/org — org + saldo user yang lagi login (dashboard
// enterprise/brand, F-ENT-01). MVP: 1 org per user diasumsikan, ambil
// membership pertama. role di org_members hanya label, TIDAK PERNAH dicek
// buat otorisasi di sini — pengecekan akses sesungguhnya ada di
// app/dashboard/(app)/layout.tsx (requireOrgContext), route ini cuma data
// untuk client-side polling nanti (bulk-run status, M3/M4).
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    const memberships = postgresRuntimeEnabled() ? await pgGetUserOrgs(user.id) : getUserOrgs(user.id);
    const membership = memberships[0];
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
