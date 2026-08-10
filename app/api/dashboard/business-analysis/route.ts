import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { fetchBrandHomepage, analyzeBrandProfile } from "@/lib/brand-analysis";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { updateOrgProfile } from "@/lib/org";
import { pgUpdateOrgProfile } from "@/lib/postgres/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/dashboard/business-analysis {url} — "analisa bisnis" (M7,
// F-ENT-01): baca homepage brand, minta Gemini bikin profil singkat,
// simpan ke organizations. Tidak ada RBAC granular di MVP — anggota org
// mana pun boleh menjalankan/menimpa profil bersama org-nya.
export async function POST(req: Request) {
  try {
    const { membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
    if (!rawUrl) throw ERR.BAD_REQUEST("Masukkan link website bisnis kamu dulu.", "url is required.");

    let page;
    try {
      page = await fetchBrandHomepage(rawUrl);
    } catch (err) {
      throw ERR.BAD_REQUEST(
        err instanceof Error ? err.message : "Link-nya belum bisa kami baca.",
        "fetchBrandHomepage failed."
      );
    }

    let profile;
    try {
      profile = await analyzeBrandProfile(page);
    } catch (err) {
      throw ERR.BAD_REQUEST(
        "Analisa gagal — coba lagi atau isi profil manual nanti di pengaturan.",
        err instanceof Error ? err.message : "analyzeBrandProfile failed."
      );
    }

    const toSave = {
      websiteUrl: page.url, businessType: profile.business_type, category: profile.category,
      audience: profile.audience, elevatorPitch: profile.elevator_pitch,
    };
    if (postgresRuntimeEnabled()) await pgUpdateOrgProfile(membership.org_id, toSave);
    else updateOrgProfile(membership.org_id, toSave);

    return Response.json({ website_url: page.url, ...profile });
  } catch (err) {
    return errorResponse(err);
  }
}
