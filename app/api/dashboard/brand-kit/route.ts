import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { getPool } from "@/lib/postgres/pool";
import { postgresRuntimeEnabled, pgAudit } from "@/lib/postgres/smoke-runtime";
import { brandLogoKey } from "@/lib/postgres/brand-kit";
import { mediaStorage } from "@/lib/storage";
import { createSignedUrl } from "@/lib/signed-url";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Brand kit: logo, warna, tagline — dipakai membuat endcard di akhir video.

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"]]);

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) return Response.json({ logo_url: null, color: null, tagline: null });
    const { membership } = await requireOrgContextApi(req);
    const res = await getPool(config.databaseUrl).query<{
      brand_logo_key: string | null; brand_color: string | null; brand_tagline: string | null;
    }>("SELECT brand_logo_key, brand_color, brand_tagline FROM organizations WHERE id=$1", [membership.org_id]);
    const row = res.rows[0];
    return Response.json({
      logo_url: row?.brand_logo_key ? createSignedUrl(row.brand_logo_key) : null,
      color: row?.brand_color ?? null,
      tagline: row?.brand_tagline ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("template", membership.org_id);

    const form = await req.formData();
    const color = String(form.get("color") ?? "").trim();
    const tagline = String(form.get("tagline") ?? "").trim().slice(0, 60);
    // Warna divalidasi ketat: nilainya masuk ke argumen ffmpeg. Bukan hanya
    // soal tampilan — string sembarangan di sana bisa menggagalkan render.
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw ERR.BAD_REQUEST("Warna harus format heksadesimal, contoh #1A1A2E.", "Invalid hex colour.");
    }

    let logoKey: string | null = null;
    const file = form.get("logo");
    if (file && typeof file !== "string") {
      const ext = ALLOWED.get(file.type);
      if (!ext) throw ERR.BAD_REQUEST("Logo harus PNG, JPG, atau WebP.", "Unsupported logo type.");
      if (file.size > MAX_LOGO_BYTES) throw ERR.BAD_REQUEST("Logo maksimal 2 MB.", "Logo too large.");
      logoKey = brandLogoKey(membership.org_id, ext);
      await mediaStorage().put(logoKey, Buffer.from(await file.arrayBuffer()), file.type);
    }

    // COALESCE + NULLIF: kolom hanya ditimpa kalau memang ada nilai baru.
    // Mengirim form tanpa logo TIDAK boleh menghapus logo yang sudah ada —
    // brand yang cuma mengganti tagline akan kaget logonya ikut hilang.
    await getPool(config.databaseUrl).query(
      `UPDATE organizations SET
         brand_logo_key = COALESCE(NULLIF($2,''), brand_logo_key),
         brand_color    = COALESCE(NULLIF($3,''), brand_color),
         brand_tagline  = COALESCE(NULLIF($4,''), brand_tagline)
       WHERE id = $1`,
      [membership.org_id, logoKey ?? "", color, tagline]
    );
    await pgAudit(user.id, "org.brand_kit", "organizations", membership.org_id, { logo: Boolean(logoKey) });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
