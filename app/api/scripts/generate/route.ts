import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ProductRow } from "@/lib/db";
import { generateScripts } from "@/lib/script-engine";
import { REGISTERS, type Register } from "@/lib/script-engine/registers";
import { postgresRuntimeEnabled, smokeCreateScripts, smokeGetProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scripts/generate {product_id, register, emotion, format} -> 3 skrip tervalidasi.
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));

    const productId = String(body.product_id ?? "");
    const register = String(body.register ?? "netral") as Register;
    const tier = (["silent_caption", "high_quality", "super_hq"].includes(body.quality_tier)
      ? body.quality_tier
      : "silent_caption") as "silent_caption" | "high_quality" | "super_hq";
    const emotion = ["senang", "sedih", "gemas"].includes(body.emotion) ? body.emotion : "senang";
    const hookLevel = (["normal", "berani", "gila"].includes(body.hook_level) ? body.hook_level : "normal") as
      | "normal" | "berani" | "gila";
    if (!REGISTERS[register])
      throw ERR.BAD_REQUEST("Register-nya pilih salah satu: bunda, bestie, genz, atau netral.", "Invalid register.");
    const durationSec = [15, 30, 45].includes(Number(body.duration_s)) ? Number(body.duration_s) : 15;

    const product = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, productId)
      : getDb().prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(productId, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Produknya");

    const variants = generateScripts({
      product: { id: product.id, name: product.name, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url },
      register,
      emotion,
      qualityTier: tier,
      durationSec,
      hookLevel,
    });

    const makeOut = (v: typeof variants[number], id: string) => ({ id, ...v });
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateScripts(user.id, product.id, variants.map((v) => ({
        hookFamily: v.hook_family, emotion: v.emotion, register: v.register, segments: v.segments,
        caption: v.caption, hashtags: v.hashtags, validationResult: v.validation, qualityTier: tier,
        hookLevel,
      })));
      return Response.json({ scripts: variants.map((v, index) => makeOut(v, created[index].id)) });
    }
    const db = getDb();
    const out = variants.map((v) => {
      const id = uuid();
      db.prepare(
        `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, hook_level, approved_by_user_at, edited_by_user, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
      ).run(
        id, product.id, v.hook_family, v.emotion, v.register,
        JSON.stringify(v.segments), v.caption, JSON.stringify(v.hashtags),
        JSON.stringify(v.validation), tier, hookLevel, now()
      );
      audit(user.id, "script.generated", "scripts", id, { hook_family: v.hook_family, passed: v.validation.passed });
      return makeOut(v, id);
    });

    return Response.json({ scripts: out });
  } catch (err) {
    return errorResponse(err);
  }
}
