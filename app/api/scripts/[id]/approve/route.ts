import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, audit, type ScriptRow, type ProductRow } from "@/lib/db";
import { amplopValidasi, bacaJejak, periksaAdmisi } from "@/lib/script-engine/admisi";
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
    // Konteks admisi KANONIK — lihat lib/script-engine/admisi.ts. Versi lama
    // kehilangan durationSec dan cartLabel di sini juga.
    // Jejak naskah dibaca DULU: snapshot menentukan genre dan jendela katanya,
    // dan script_source harus selamat melewati approve — sebelum ini kolomnya
    // ditimpa utuh dan provenance-nya hilang persis di langkah yang membuat
    // naskah itu boleh dirender.
    const jejak = bacaJejak(script.validation_result);
    const validation = periksaAdmisi({
      segments,
      snapshot: jejak.admisi,
      hookFamily: script.hook_family,
      register: script.register,
      productName: product.name,
      productPriceIdr: product.price_idr,
      productSourceUrl: product.source_url,
      promoPriceBeforeIdr: product.promo_price_before_idr,
      qualityTier: script.quality_tier,
    });
    if (!validation.passed) {
      // Kode FORBIDDEN_WORDS DIPERTAHANKAN untuk kasus kata terlarang: ia
      // sudah jadi kontrak API dan artinya spesifik. Kegagalan gerbang lain
      // (panjang, keranjang, perangkat hook, pemicu penyaring) dulu ikut
      // memakai kode itu dan jadi tidak bisa dibedakan — sekarang punya pesan
      // sendiri yang menyebut sebabnya.
      const kataTerlarang = validation.errors.some((e) => e.rule === "L-10" || e.rule === "L-11");
      if (kataTerlarang) throw ERR.FORBIDDEN_WORDS();
      throw ERR.BAD_REQUEST(
        `Naskahnya belum memenuhi standar: ${validation.errors.map((e) => e.message_id).join(" ")}`,
        `Admission failed: ${validation.errors.map((e) => e.rule).join(",")}`
      );
    }

    const disimpan = amplopValidasi(validation, jejak);
    if (postgresRuntimeEnabled()) await smokeApproveScript(user.id, id, { segments, edited, validationResult: disimpan });
    else {
      db!.prepare("UPDATE scripts SET segments = ?, edited_by_user = ?, approved_by_user_at = ?, validation_result = ? WHERE id = ?")
        .run(JSON.stringify(segments), edited ? 1 : 0, now(), JSON.stringify(disimpan), id);
      audit(user.id, "script.approved", "scripts", id, { edited, script_source: jejak.script_source ?? null });
    }

    return Response.json({ id, approved_by_user_at: now(), edited_by_user: edited, validation: disimpan });
  } catch (err) {
    return errorResponse(err);
  }
}
