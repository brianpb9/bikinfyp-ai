import { generateScripts } from "@/lib/script-engine";
import { scoreScriptPlan } from "@/lib/fyp-score";
import { validPriceIdr, validProductName } from "@/lib/product-validation";
import { ERR, errorResponse } from "@/lib/errors";
import { allowRate } from "@/lib/rate-limit";
import crypto from "node:crypto";
import { config } from "@/lib/config";
import { pastikanSegar } from "@/lib/kredensial";

/** Bonus daftar ditulis dari config, bukan diketik: angka Rp5.000 di sini
 * bertahan berbulan-bulan sesudah tier itu pensiun (temuan board 20 Agu). */
const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/try {name, price_idr, category} — MAGIC MOMENT tanpa login
// (adopsi 2026-08-06 dari riset funnel kompetitor: user merasakan hasil dulu,
// baru diminta daftar). TANPA persist apa pun: skrip digenerate on-the-fly +
// Skor FYP dihitung dari rencana. Rate limit per-IP 15/15 menit (Redis-backed
// di production — lib/rate-limit.ts).
//
// "NOL COGS" DULU BENAR, SEKARANG TIDAK — dan itu sebabnya jalur LLM di sini
// MATI secara bawaan. Rute ini lahir saat mesin naskah 100% template. Sejak
// penulis LLM hidup (17 Agu), tiap permintaan ANONIM akan menulis tiga naskah
// lewat model berbayar, dan 15 per 15 menit itu batas PER IP — tidak ada batas
// lintas-IP dan tidak ada yang login. Nyalakan dengan TRY_LLM=1 kalau mutu
// demonya dinilai sepadan; itu keputusan sadar, bukan efek samping.
export async function POST(req: Request) {
  try {
    // Kredensial partner bisa diganti dari /admin/kredensial tanpa restart.
    // Tanpa penyegaran ini, kunci yang baru dipasang tidak berpengaruh sampai
    // container dimuat ulang — dan halaman itu tetap bilang "tersimpan",
    // yaitu kegagalan diam yang paling membingungkan.
    await pastikanSegar();
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!(await allowRate("try", ip, 15, 15 * 60)))
      return Response.json(
        { code: "TRY_RATE_LIMITED", message_id: `Udah banyak nyoba nih 😄 — daftar gratis dulu ya, dapat bonus ${rupiah(config.signupBonusIdr)} buat render video beneran.`, retryable: false },
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
      tanpaLlm: !config.tryLlmEnabled,
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
