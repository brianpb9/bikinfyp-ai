import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ProductRow } from "@/lib/db";
import { generateScripts } from "@/lib/script-engine";
import { REGISTERS, type Register } from "@/lib/script-engine/registers";
import { postgresRuntimeEnabled, smokeCreateScripts, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { normalizeHookLevel } from "@/lib/config/hooks";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import { allowRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scripts/generate {product_id, register, emotion, format} -> 3 skrip tervalidasi.
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();

    // BATAS 5 PER JAM PER PENGGUNA.
    //
    // Rute ini dulu praktis gratis, jadi tidak pernah dibatasi. Sejak penulis
    // naskah LLM hidup (dan Idea Stage di atasnya untuk tier tinggi), satu klik
    // "buat skrip" memanggil model berbayar beberapa kali — sampai dua panggilan
    // pembuat ide kelas atas plus satu penilai per kandidat. Tanpa batas, satu
    // akun yang mengulang-ulang bisa menghabiskan kuota untuk semua orang.
    //
    // Per PENGGUNA, bukan per org: rute ini memang jalur retail, dan yang
    // dibatasi perbuatan orangnya. Fail-open mengikuti allowRate — memblokir
    // orang yang membayar karena Redis ngadat lebih merugikan daripada
    // meloloskan beberapa permintaan ekstra.
    if (!(await allowRate("skrip:generate", user.id, 5, 3600))) {
      throw ERR.BAD_REQUEST(
        "Sudah 5 kali buat skrip dalam sejam terakhir. Tunggu sebentar ya — tiap permintaan menulis naskah baru dari awal.",
        "Rate limited: scripts/generate 5/hour"
      );
    }

    const body = await req.json().catch(() => ({}));

    const productId = String(body.product_id ?? "");
    const register = String(body.register ?? "netral") as Register;
    // 2026-08-06: tier senyap dihapus dari AI UGC Affiliate — fokus persona bersuara.
    // Daftar pensiunnya dari lib/paket-kredit (SATU sumber dengan halaman harga),
    // bukan string hardcode di sini — dulu terpisah, dan /harga sempat menjual
    // tier ini seharga Rp5.000 sementara route ini menolaknya.
    if (typeof body.quality_tier === "string" && !tierMasihDijual(body.quality_tier))
      throw ERR.BAD_REQUEST("Tier Teks + Musik sudah tidak tersedia — pilih AI Bersuara ya.", "retired tier requested.");
    const tier = (["high_quality", "super_hq"].includes(body.quality_tier)
      ? body.quality_tier
      : "high_quality") as "silent_caption" | "high_quality" | "super_hq";
    const emotion = ["senang", "sedih", "gemas"].includes(body.emotion) ? body.emotion : "senang";
    const hookLevel = normalizeHookLevel(body.hook_level);
    // Template Terbukti: keluarga hook pilihan pola pemenang (opsional, tervalidasi).
    const VALID_HOOKS = new Set(Array.from({ length: 16 }, (_, i) => `H${i + 1}`));
    const hookFamilies = (Array.isArray(body.hook_families) ? body.hook_families : [])
      .map(String)
      .filter((h: string) => VALID_HOOKS.has(h))
      .slice(0, 6) as import("@/lib/config/hooks").HookCode[];
    if (!REGISTERS[register])
      throw ERR.BAD_REQUEST("Register-nya pilih salah satu: bunda, bestie, genz, atau netral.", "Invalid register.");
    const durationSec = [15, 30, 45].includes(Number(body.duration_s)) ? Number(body.duration_s) : 15;

    const product = postgresRuntimeEnabled()
      ? await smokeGetProduct(user.id, productId)
      : getDb().prepare("SELECT * FROM products WHERE id = ? AND user_id = ?").get(productId, user.id) as ProductRow | undefined;
    if (!product) throw ERR.NOT_FOUND("Produknya");
    // Produk organisasi WAJIB lewat dashboard (RBAC belanja + gerbang review
    // scene + library org). Lihat pastikanBukanProdukOrg.
    pastikanBukanProdukOrg(product);

    const variants = await generateScripts({
      product: {
        id: product.id, name: product.name, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url,
        promoPriceBeforeIdr: product.promo_price_before_idr, promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
      },
      register,
      emotion,
      qualityTier: tier,
      durationSec,
      hookLevel,
      hookFamilies: hookFamilies.length ? hookFamilies : undefined,
    });

    // NASKAH YANG GAGAL GATE TIDAK DISIMPAN.
    //
    // Reviewer 18 Agu, temuan P0: rute ini menyimpan SEMUA varian tanpa
    // memeriksa validation.passed. Naskah degraded lalu bisa disetujui dan
    // dirender — klaim "tidak boleh dirender" tidak pernah ditegakkan di jalur
    // yang benar-benar dilewati pengguna.
    //
    // Menolak lebih baik daripada menyimpan sesuatu yang tidak boleh dipakai:
    // baris yang tersimpan adalah baris yang suatu hari akan dirender.
    const sah = variants.filter((v) => v.validation.passed);
    if (sah.length === 0) {
      const sebab = [...new Set(variants.flatMap((v) => v.validation.errors.map((e) => e.message_id)))];
      throw ERR.BAD_REQUEST(
        `Belum ada naskah yang memenuhi standar untuk produk ini. ${sebab[0] ?? ""}`.trim(),
        `No script passed the hard gates: ${variants.map((v) => v.validation.errors.map((e) => e.rule).join("/")).join(" | ")}`
      );
    }

    // script_source ikut TERSIMPAN, dititipkan di validation_result.
    //
    // Kolom sendiri butuh migrasi, dan migrasi terkunci sampai audit ledger
    // bersih. validation_result sudah bertipe JSON dan sudah dibaca bersama
    // naskahnya, jadi provenance-nya tidak hilang sambil menunggu.
    const hasilValidasi = (v: typeof variants[number]) => ({ ...v.validation, script_source: v.script_source });
    const makeOut = (v: typeof variants[number], id: string) => ({ id, ...v });
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateScripts(user.id, product.id, sah.map((v) => ({
        hookFamily: v.hook_family, emotion: v.emotion, register: v.register, segments: v.segments,
        caption: v.caption, hashtags: v.hashtags, validationResult: hasilValidasi(v), qualityTier: tier,
        hookLevel,
      })));
      return Response.json({ scripts: sah.map((v, index) => makeOut(v, created[index].id)) });
    }
    const db = getDb();
    const out = sah.map((v) => {
      const id = uuid();
      db.prepare(
        `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, hook_level, approved_by_user_at, edited_by_user, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
      ).run(
        id, product.id, v.hook_family, v.emotion, v.register,
        JSON.stringify(v.segments), v.caption, JSON.stringify(v.hashtags),
        JSON.stringify(hasilValidasi(v)), tier, hookLevel, now()
      );
      audit(user.id, "script.generated", "scripts", id, {
        hook_family: v.hook_family, passed: v.validation.passed, script_source: v.script_source,
      });
      return makeOut(v, id);
    });

    return Response.json({ scripts: out });
  } catch (err) {
    return errorResponse(err);
  }
}
