import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nama tier berbasis MANFAAT (rename 2026-08-06: tester bingung istilah
// "Senyap" — nama harus menjelaskan hasil, bukan teknologi; id internal tetap).
const TIER_UI = [
  { id: "high_quality", name: "AI Bersuara", note: "Sama, PLUS AI-nya ngomong pakai suara natural", tag: null },
  { id: "super_hq", name: "AI Bersuara Pro", note: "Suara + kualitas gambar paling tajam", tag: null },
];

// GET /api/meta — konfigurasi publik untuk UI (estimasi waktu + harga tier, P6).
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const isByteplus = config.providerVideo === "byteplus";
    return Response.json({
      provider_video: config.providerVideo,
      estimate_text: isByteplus
        ? "Biasanya 2–5 menit, tapi bisa lebih lama saat antrean padat. Kamu boleh tutup halaman ini."
        : "Sekitar 1–2 menit lagi. Kamu boleh tutup halaman ini.",
      estimate_min_max_min: isByteplus ? [2, 45] : [1, 2],
      tiers: TIER_UI.map((t) => ({
        ...t,
        price_idr: config.tiers[t.id]?.priceIdr ?? 0,
      })),
      promo_price_idr: config.promoPriceIdr,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
