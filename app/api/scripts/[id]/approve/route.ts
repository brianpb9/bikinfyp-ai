import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, audit, type ScriptRow, type ProductRow } from "@/lib/db";
import { validateScript } from "@/lib/script-engine/validator";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { postgresRuntimeEnabled, smokeApproveScript, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scripts/:id/approve {segments?, edited?} — gerbang HITL (F-03).
// Edit pengguna divalidasi ringan: hanya L-10/L-11 yang tetap keras (BR-03.2).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const { id } = await ctx.params;
    const db = postgresRuntimeEnabled() ? null : getDb();
    const script = postgresRuntimeEnabled()
      ? await smokeGetScript(user.id, id)
      : db!.prepare("SELECT * FROM scripts WHERE id = ?").get(id) as ScriptRow | undefined;
    if (!script) throw ERR.NOT_FOUND("Skripnya");
    const product = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, script.product_id)
      : db!.prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(script.product_id, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Skripnya");
    // Produk organisasi WAJIB lewat dashboard (RBAC belanja + gerbang review
    // scene + library org). Lihat pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

    const body = await req.json().catch(() => ({}));
    let segments = JSON.parse(script.segments) as SegmentDraft[];
    let edited = script.edited_by_user === 1 || body.edited === true;

    if (Array.isArray(body.segments)) {
      const incoming = body.segments as Partial<SegmentDraft>[];
      segments = segments.map((seg, i) => ({
        ...seg,
        text: String(incoming[i]?.text ?? seg.text),
      }));
      edited = true;
    }

    // Validasi ringan — L-10/L-11 keras, sisanya warning (FSD BR-03.2).
    const validation = validateScript(
      {
        hook_family: script.hook_family,
        register: script.register,
        segments,
        productName: product.name,
        priceIdr: product.price_idr,
        qualityTier: script.quality_tier as "silent_caption" | "high_quality" | "super_hq",
      },
      "light"
    );
    if (!validation.passed) throw ERR.FORBIDDEN_WORDS();

    if (postgresRuntimeEnabled()) await smokeApproveScript(user.id, id, { segments, edited, validationResult: validation });
    else {
      db!.prepare("UPDATE scripts SET segments = ?, edited_by_user = ?, approved_by_user_at = ?, validation_result = ? WHERE id = ?")
        .run(JSON.stringify(segments), edited ? 1 : 0, now(), JSON.stringify(validation), id);
      audit(user.id, "script.approved", "scripts", id, { edited });
    }

    return Response.json({ id, approved_by_user_at: now(), edited_by_user: edited, validation });
  } catch (err) {
    return errorResponse(err);
  }
}
