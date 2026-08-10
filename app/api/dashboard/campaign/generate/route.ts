import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { generateScripts } from "@/lib/script-engine";
import { postgresRuntimeEnabled, smokeCreateScripts, smokeGetProduct } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next.js melarang export selain field Route di file route — jadi konstanta
// ini lokal, bukan di-export (batas 2-6 juga ditegakkan di UI).
const MIN_VIDEOS = 2;
const MAX_VIDEOS = 6;

// POST /api/dashboard/campaign/generate — bikin N variasi skrip dari SATU
// produk (M8). Tiap variasi memakai keluarga hook berbeda (lihat
// pickHookFamilies), jadi 6 video bukan 6 video yang sama — itu inti nilai
// buat brand: satu produk, banyak sudut pandang.
//
// TIDAK membuat job / menahan kredit di sini. Skrip AI tetap wajib lewat
// gerbang HITL manusia (aturan keras #5) di langkah confirm.
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard campaign requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));

    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    const product = await smokeGetProduct(user.id, productId);
    if (!product || product.org_id !== membership.org_id) throw ERR.NOT_FOUND("Produknya");
    if (!product.price_idr) throw ERR.BAD_REQUEST("Isi harga produknya dulu — harga dipakai di skrip dan overlay.", "Product price is required.");
    const images = JSON.parse(product.images || "[]") as string[];
    if (images.length === 0) throw ERR.BAD_REQUEST("Upload minimal 1 foto produk dulu.", "At least one product photo is required.");

    const count = Number.isFinite(Number(body.count)) ? Math.round(Number(body.count)) : 0;
    if (count < MIN_VIDEOS || count > MAX_VIDEOS) {
      throw ERR.BAD_REQUEST(`Jumlah video harus antara ${MIN_VIDEOS} dan ${MAX_VIDEOS}.`, "count out of range.");
    }
    const tier = body.tier === "super_hq" ? "super_hq" : body.tier === "high_quality" ? "high_quality" : null;
    if (!tier) throw ERR.BAD_REQUEST("Tier tidak dikenal. Pilih AI Bersuara atau AI Bersuara Pro.", "Unknown quality tier.");
    const durationSec = [15, 30, 45].includes(Number(body.duration_sec)) ? (Number(body.duration_sec) as 15 | 30 | 45) : null;
    if (!durationSec) throw ERR.BAD_REQUEST("Durasi yang tersedia baru 15, 30, atau 45 detik.", "Unsupported duration.");
    const hookLevel = ["normal", "berani", "gila"].includes(body.hook_level) ? (body.hook_level as "normal" | "berani" | "gila") : "normal";
    const register = ["bunda", "bestie", "genz", "netral"].includes(body.register) ? body.register : "netral";

    const variants = generateScripts({
      product: {
        id: product.id, name: product.name, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url,
        promoPriceBeforeIdr: product.promo_price_before_idr, promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
      },
      register, emotion: "senang", qualityTier: tier, durationSec, hookLevel, count,
    });
    const passing = variants.filter((v) => v.validation.passed);
    if (passing.length === 0) {
      throw ERR.BAD_REQUEST(
        "Semua skrip yang dibuat AI tidak lolos validasi otomatis — coba ubah nama/harga produk, atau turunkan level hook.",
        "No generated variant passed validation."
      );
    }

    const created = await smokeCreateScripts(user.id, product.id, passing.map((v) => ({
      hookFamily: v.hook_family, emotion: v.emotion, register: v.register, segments: v.segments,
      caption: v.caption, hashtags: v.hashtags, validationResult: v.validation, qualityTier: tier, hookLevel,
    })));

    return Response.json({
      product_id: product.id,
      requested: count,
      // Jujur ke UI kalau AI cuma sanggup bikin lebih sedikit dari yang
      // diminta (mis. semua keluarga hook sisanya gagal validasi) — jangan
      // diam-diam mengurangi jumlah tanpa memberi tahu.
      scripts: passing.map((v, i) => ({
        script_id: created[i].id,
        hook_family: v.hook_family,
        caption: v.caption,
        segments: v.segments,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
