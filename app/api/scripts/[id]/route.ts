import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, type ScriptRow, type ProductRow } from "@/lib/db";
import { postgresRuntimeEnabled, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/scripts/:id — ambil satu skrip milik user (untuk duplikat & edit di S8/S6).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const db = postgresRuntimeEnabled() ? null : getDb();
    const script = postgresRuntimeEnabled() ? await smokeGetScript(user.id, id) : db!.prepare("SELECT * FROM scripts WHERE id = ?").get(id) as ScriptRow | undefined;
    if (!script) throw ERR.NOT_FOUND("Skripnya");
    const product = postgresRuntimeEnabled() ? await smokeGetProduct(user.id, script.product_id) : db!
      .prepare("SELECT * FROM products WHERE id = ? AND user_id = ?")
      .get(script.product_id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Skripnya");
    // Produk organisasi WAJIB lewat dashboard (RBAC belanja + gerbang review
    // scene + library org). Lihat pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

    return Response.json({
      script: {
        id: script.id,
        hook_family: script.hook_family,
        emotion: script.emotion,
        register: script.register,
        segments: JSON.parse(script.segments),
        caption: script.caption,
        hashtags: JSON.parse(script.hashtags),
        approved: script.approved_by_user_at !== null,
        product_name: product.name,
        price_idr: product.price_idr,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
