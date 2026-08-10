import crypto from "node:crypto";
import { ERR, errorResponse } from "@/lib/errors";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { extractFromUrl } from "@/lib/extract";
import { downloadProductImages } from "@/lib/product-image-download";
import { generateScripts } from "@/lib/script-engine";
import { createSignedUrl } from "@/lib/signed-url";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct, smokeCreateScripts } from "@/lib/postgres/smoke-runtime";
import { BULK_TIER, BULK_DURATION_S } from "@/lib/dashboard-bulk-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URLS = 10;

type BulkGenerateItem =
  | { status: "ready"; url: string; product_id: string; script_id: string; product_name: string; price_idr: number; category: string; image_url: string | null; caption: string; hook_family: string }
  | { status: "failed"; url: string; reason: string };

// POST /api/dashboard/bulk {urls: string[]} — fase 1 (generate & review).
// TIDAK membuat job atau nge-hold kredit di sini — skrip yang dihasilkan
// AI tetap harus lewat gerbang HITL manusia (aturan keras #5, sama seperti
// alur retail satuan) sebelum render sungguhan jalan. "Bulk" di sini berarti
// satu klik generate untuk N produk + satu klik approve-semua di fase 2
// (POST .../confirm), BUKAN auto-approve diam-diam.
export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard bulk-generate requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const rawUrls = Array.isArray(body.urls) ? body.urls : [];
    const urls = rawUrls.map((u: unknown) => String(u ?? "").trim()).filter(Boolean).slice(0, MAX_URLS);
    if (urls.length === 0) throw ERR.BAD_REQUEST("Masukkan minimal 1 link produk.", "At least one product URL is required.");

    const bulkRunId = crypto.randomUUID();
    const items: BulkGenerateItem[] = [];

    for (const url of urls) {
      if (!(await pgCanExtract(user.id))) {
        items.push({ status: "failed", url, reason: "Batas ekstraksi link tercapai (10/15 menit). Coba lagi sebentar." });
        continue;
      }
      await pgAudit(user.id, "product.extract", "products", null, { url: url.slice(0, 120), dashboard_bulk_run_id: bulkRunId });

      const result = await extractFromUrl(url);
      if (!result.extracted) {
        items.push({ status: "failed", url, reason: result.message ?? "Link-nya belum bisa kami baca." });
        continue;
      }

      const productId = crypto.randomUUID();
      const images = result.imageUrls?.length ? await downloadProductImages(productId, result.imageUrls) : [];
      const promoBefore = result.originalPriceIdr && result.priceIdr && result.originalPriceIdr > result.priceIdr ? result.originalPriceIdr : null;
      const product = await smokeCreateProduct(
        user.id,
        {
          sourceUrl: url, name: result.name ?? "Produk dari link", priceIdr: result.priceIdr ?? 0,
          category: result.categoryGuess ?? "default", images, productVisualDesc: result.visualDesc ?? null,
          promoPriceBeforeIdr: promoBefore, rawMeta: { og: { price: result.priceIdr, original: result.originalPriceIdr } },
          orgId: membership.org_id,
        },
        productId
      );
      await pgAudit(user.id, "product.extracted", "products", productId, { reason: "ok", price: result.priceIdr, dashboard_bulk_run_id: bulkRunId });

      if (!product.price_idr) {
        items.push({ status: "failed", url, reason: "Harga produk tidak ketemu — link ini butuh isi manual, belum didukung di bulk-generate." });
        continue;
      }

      const variants = generateScripts({
        product: { id: product.id, name: product.name, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url,
          promoPriceBeforeIdr: product.promo_price_before_idr, promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left },
        register: "netral", emotion: "senang", qualityTier: BULK_TIER, durationSec: BULK_DURATION_S, hookLevel: "normal",
      });
      const chosen = variants.find((v) => v.validation.passed);
      if (!chosen) {
        items.push({ status: "failed", url, reason: "Skrip AI untuk produk ini tidak lolos validasi otomatis — coba link lain atau bikin manual di alur biasa." });
        continue;
      }
      const createdScripts = await smokeCreateScripts(user.id, product.id, [{
        hookFamily: chosen.hook_family, emotion: chosen.emotion, register: chosen.register, segments: chosen.segments,
        caption: chosen.caption, hashtags: chosen.hashtags, validationResult: chosen.validation, qualityTier: BULK_TIER,
        hookLevel: "normal",
      }]);
      const scriptId = createdScripts[0].id;

      items.push({
        status: "ready", url, product_id: product.id, script_id: scriptId, product_name: product.name,
        price_idr: product.price_idr, category: product.category, image_url: images[0] ? createSignedUrl(images[0]) : null,
        caption: chosen.caption, hook_family: chosen.hook_family,
      });
    }

    return Response.json({ bulk_run_id: bulkRunId, items, ready_count: items.filter((i) => i.status === "ready").length });
  } catch (err) {
    return errorResponse(err);
  }
}
