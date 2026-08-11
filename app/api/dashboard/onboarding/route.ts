import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled, pgAudit } from "@/lib/postgres/smoke-runtime";
import { pgSaveOnboarding } from "@/lib/postgres/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Simpan onboarding organisasi.
//
// Satu endpoint untuk seluruh alur, dipanggil sekali di akhir — bukan
// per-langkah. Menyimpan tiap langkah berarti organisasi bisa tertinggal
// dalam keadaan separuh terisi kalau brand menutup tab di tengah jalan, dan
// tidak ada yang mendapat manfaat dari data separuh itu.
//
// "Lewati" JUGA memanggil endpoint ini (dengan isi kosong) supaya onboarded_at
// tetap tertulis. Tanpa itu, brand yang melewati akan ditanya lagi setiap kali
// membuka dashboard.
const MAX = 300;
const clean = (v: unknown, max = MAX) => String(v ?? "").trim().slice(0, max);

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));

    await pgSaveOnboarding(membership.org_id, {
      name: clean(body.name, 80),
      websiteUrl: clean(body.website_url, 200),
      businessType: clean(body.business_type, 80),
      category: clean(body.category, 80),
      audience: clean(body.audience),
      elevatorPitch: clean(body.elevator_pitch, 600),
    });
    await pgAudit(user.id, "org.onboarded", "organizations", membership.org_id, {
      skipped: !clean(body.business_type),
    });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
