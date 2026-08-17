import { generateScripts } from "@/lib/script-engine";
import { scoreScriptPlan } from "@/lib/fyp-score";
import { validPriceIdr, validProductName } from "@/lib/product-validation";
import { ERR, errorResponse } from "@/lib/errors";
import { allowRate } from "@/lib/rate-limit";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/try {name, price_idr, category} — MAGIC MOMENT tanpa login
// (adopsi 2026-08-06 dari riset funnel kompetitor: user merasakan hasil dulu,
// baru diminta daftar). TANPA persist apa pun: skrip digenerate on-the-fly
// (deterministik, nol COGS) + Skor FYP dihitung dari rencana. Rate limit
// per-IP 15/15 menit (Redis-backed di production — lib/rate-limit.ts).
export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!(await allowRate("try", ip, 15, 15 * 60)))
      return Response.json(
        { code: "TRY_RATE_LIMITED", message_id: "Udah banyak nyoba nih 😄 — daftar gratis dulu ya, dapat bonus Rp5.000 buat render video beneran.", retryable: false },
        { status: 429 }
      );
    const body = await req.json().catch(() => ({}));
    const name = validProductName(String(body.name ?? ""));
    const priceIdr = validPriceIdr(body.price_idr);
    const category = ["beauty", "fashion", "muslim_fashion", "home", "kitchen", "gadget", "food", "kids", "default"].includes(body.category)
      ? String(body.category)
      : "default";
    if (!name) throw ERR.BAD_REQUEST("Nama produknya diisi dulu ya.", "Product name required.");
    if (!priceIdr) throw ERR.BAD_REQUEST("Harganya diisi dulu ya — harga itu bahan utama hook.", "Price required.");

    // Produk sintetis (tidak disimpan) — id acak supaya deprioritisasi hook 7-hari
    // di DB tidak pernah cocok.
    const variants = await generateScripts({
      product: { id: `try-${crypto.randomBytes(6).toString("hex")}`, name, price_idr: priceIdr, category },
      register: "netral",
    });
    return Response.json({
      scripts: variants.map((v) => {
        let score: number | null = null;
        try {
          score = scoreScriptPlan({
            hookFamily: v.hook_family, segments: v.segments, qualityTier: "high_quality",
            durationSec: 15, format: "talking_head", productName: name, priceIdr,
          }).score;
        } catch {
          /* skor gagal bukan alasan menahan skrip */
        }
        return { hook_family: v.hook_family, segments: v.segments, caption: v.caption, hashtags: v.hashtags, fyp_score: score };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
