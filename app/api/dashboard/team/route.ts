import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled, pgAudit } from "@/lib/postgres/smoke-runtime";
import { pgAddOrgMemberByEmail, pgListOrgMembers, pgRemoveOrgMember } from "@/lib/postgres/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anggota tim organisasi.
//
// Menambah/mengeluarkan anggota dibatasi ke role 'owner'. Ini SATU-SATUNYA
// tempat role benar-benar dicek — di seluruh MVP lainnya role sengaja hanya
// label (lihat catatan di lib/postgres/org.ts). Alasannya sempit dan konkret:
// anggota berbagi satu dompet kredit, jadi siapa pun yang bisa mengundang
// bisa membelanjakan uang brand. Itu bukan keputusan yang boleh dipegang
// semua orang, dan menutupnya di sini tidak memerlukan sistem izin penuh.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const members = await pgListOrgMembers(membership.org_id);
    return Response.json({
      can_manage: membership.role === "owner",
      me: user.id,
      members: members.map((m) => ({
        user_id: m.user_id, role: m.role,
        contact: m.email ?? m.phone ?? "—",
        name: m.name, joined_at: m.created_at,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    if (membership.role !== "owner") {
      throw ERR.BAD_REQUEST("Cuma pemilik organisasi yang bisa menambah anggota.", "Owner role required.");
    }
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw ERR.BAD_REQUEST("Format emailnya belum benar.", "Invalid email.");

    const result = await pgAddOrgMemberByEmail(membership.org_id, email);
    await pgAudit(user.id, "org.member_added", "org_members", result.userId, { org_id: membership.org_id, status: result.status });
    return Response.json({
      status: result.status,
      message: result.status === "exists"
        ? "Orang ini sudah jadi anggota."
        : "Anggota ditambahkan. Dia langsung masuk begitu login pakai email itu.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    if (membership.role !== "owner") {
      throw ERR.BAD_REQUEST("Cuma pemilik organisasi yang bisa mengeluarkan anggota.", "Owner role required.");
    }
    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id ?? "");
    if (!userId) throw ERR.BAD_REQUEST("user_id wajib diisi.", "user_id is required.");
    if (userId === user.id) throw ERR.BAD_REQUEST("Kamu tidak bisa mengeluarkan dirimu sendiri.", "Cannot remove self.");

    const removed = await pgRemoveOrgMember(membership.org_id, userId);
    if (!removed) throw ERR.BAD_REQUEST("Anggota tidak ditemukan, atau dia pemilik organisasi.", "Member not found or is owner.");
    await pgAudit(user.id, "org.member_removed", "org_members", userId, { org_id: membership.org_id });
    return Response.json({ removed: true });
  } catch (err) {
    return errorResponse(err);
  }
}
