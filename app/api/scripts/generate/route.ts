import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getDb, now, uuid, audit, type ProductRow } from "@/lib/db";
import { generateScripts, TemplateTidakDisajikan } from "@/lib/script-engine";
import { amplopValidasi } from "@/lib/script-engine/admisi";
import { REGISTERS, type Register } from "@/lib/script-engine/registers";
import { pgAudit, postgresRuntimeEnabled, smokeCreateScripts, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { normalizeHookLevel } from "@/lib/config/hooks";
import { tierMasihDiterima } from "@/lib/paket-kredit";
import type { QualityTier } from "@/lib/providers/types";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";
import { allowRate } from "@/lib/rate-limit";
import { cobaDenganNamaPendek } from "@/lib/script-engine/jaring-nama";
import { AMBANG_VIRAL, lewatiGerbangViral } from "@/lib/script-engine/gerbang-viral";
import type { FypQualityTier } from "@/lib/fyp-score";
import { pastikanSegar } from "@/lib/kredensial";
import { catatAudit } from "@/lib/audit-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/scripts/generate {product_id, register, emotion, format} -> 3 skrip tervalidasi.
export async function POST(req: Request) {
  try {
    // Kredensial partner bisa diganti dari /admin/kredensial tanpa restart.
    // Tanpa penyegaran ini, kunci yang baru dipasang tidak berpengaruh sampai
    // container dimuat ulang — dan halaman itu tetap bilang "tersimpan",
    // yaitu kegagalan diam yang paling membingungkan.
    await pastikanSegar();
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
    if (typeof body.quality_tier === "string" && !tierMasihDiterima(body.quality_tier))
      throw ERR.BAD_REQUEST("Tier itu sudah tidak tersedia — pilih Premium atau Ultra ya.", "retired tier requested.");
    // Daftar yang diterima dibaca dari sumber yang sama dengan pemeriksaan di
    // atas. Sebelumnya baris ini mengetik ulang dua id, jadi tier baru yang
    // LOLOS tierMasihDiterima() tetap diam-diam diturunkan ke high_quality —
    // pembeli memilih Ultra, naskahnya dibuat untuk tier lain, dan /api/jobs
    // menolaknya dengan "skrip ini dibuat untuk tier lain".
    const tier = (typeof body.quality_tier === "string" && tierMasihDiterima(body.quality_tier)
      ? body.quality_tier
      : "high_quality") as QualityTier;
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

    // Jaring pengaman nama (canary temuan #4): nama sah 4-6 kata bisa memakan
    // jendela kata L-05/S-09 sampai penulis mustahil lolos. Enterprise sudah
    // punya jaring ini; retail-lah yang kena di canary — tangga asli -> bersih
    // -> nama panggung merek, berhenti di anak tangga pertama yang lolos.
    const jalan = (namaProduk: string) => generateScripts({
      product: {
        id: product.id, name: namaProduk, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url,
        promoPriceBeforeIdr: product.promo_price_before_idr, promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
      },
      register,
      emotion,
      qualityTier: tier,
      durationSec,
      hookLevel,
      hookFamilies: hookFamilies.length ? hookFamilies : undefined,
    });
    // ── GERBANG VIRALITAS (permintaan Brian, 3 Sep 2026) ────────────────────
    //
    //   "apabila kurang lakukan regenerate ulang scriptnya sehingga memiliki
    //    nilai tinggi. lakukan sampai 3 kali baru tampilkan opsinya.
    //    minimum tresholdnya 60."
    //
    // Skor FYP sudah dihitung sejak lama — /api/jobs menyimpannya, layar S4
    // menampilkannya — tapi tidak pernah MENOLAK apa pun. Naskah berskor 38
    // ditawarkan persis sama dengan naskah 97.
    //
    // Formatnya belum dipilih di tahap ini (baru dipilih saat membuat job),
    // jadi dipakai talking_head — bawaan yang sama dengan yang dipakai layar
    // S4 saat menampilkan skor, supaya angka yang menggerbangi dan angka yang
    // dilihat pengguna berasal dari asumsi yang sama.
    // shortenedTo DIPERTAHANKAN lintas percobaan: pemanggil memakainya untuk
    // memberi tahu pengguna bahwa nama produknya dipendekkan agar naskahnya
    // muat. Percobaan kedua yang berhasil dengan nama utuh tidak boleh
    // menghapus fakta itu kalau naskah yang akhirnya dipakai berasal dari
    // percobaan yang memendekkannya — jadi yang disimpan milik percobaan
    // TERAKHIR yang menghasilkan naskah sah, sama seperti sebelum gerbang ada.
    let shortenedTo: string | null = null;
    const gerbang = await lewatiGerbangViral(
      async () => {
        const j = await cobaDenganNamaPendek(jalan, product.name);
        if (j.adaLolos) shortenedTo = j.shortenedTo;
        return j.variants;
      },
      {
        qualityTier: tier as FypQualityTier,
        durationSec,
        format: "talking_head",
        productName: product.name,
        priceIdr: product.price_idr ?? 0,
      },
      {
        catat: (m) => console.log(`[gerbang-viral] "${product.name}": ${m}`),
        // Hanya naskah yang lolos gerbang validator yang boleh memuaskan
        // ambang — yang gagal tetap dibuang di hilir.
        layak: (v) => v.validation.passed,
      },
    );
    const variants = gerbang.terpilih.map((d) => d.varian);

    // Hasil gerbang DICATAT, bukan cuma dipakai lalu dibuang. Tanpa ini
    // mustahil menjawab "berapa sering naskah harus ditulis ulang demi skor,
    // dan berapa yang tetap di bawah 60" — dua angka yang menentukan apakah
    // ambangnya sehat atau justru menyiksa penulis dan menghabiskan token.
    await catatAudit(user.id, "naskah.gerbang_viral", "products", product.id, {
      skor_tertinggi: gerbang.skorTertinggi,
      ambang: AMBANG_VIRAL,
      percobaan: gerbang.percobaan,
      lolos: gerbang.lolosAmbang,
      tier,
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
    const hasilValidasi = (v: typeof variants[number]) =>
      amplopValidasi(v.validation, { script_source: v.script_source, admisi: v.admisi });
    const makeOut = (v: typeof variants[number], id: string) => ({ id, ...v });
    const ringkasGerbang = {
      skor_tertinggi: gerbang.skorTertinggi,
      ambang: AMBANG_VIRAL,
      percobaan: gerbang.percobaan,
      lolos_ambang: gerbang.lolosAmbang,
    };
    if (postgresRuntimeEnabled()) {
      const created = await smokeCreateScripts(user.id, product.id, sah.map((v) => ({
        hookFamily: v.hook_family, emotion: v.emotion, register: v.register, segments: v.segments,
        caption: v.caption, hashtags: v.hashtags, validationResult: hasilValidasi(v), qualityTier: tier,
        hookLevel,
      })));
      return Response.json({
        scripts: sah.map((v, index) => makeOut(v, created[index].id)),
        shortened_to: shortenedTo,
        viral: ringkasGerbang,
      });
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

    return Response.json({ scripts: out, shortened_to: shortenedTo, viral: ringkasGerbang });
  } catch (err) {
    // Naskah template TIDAK PERNAH disajikan (keputusan Brian 20 Agu). Jawab
    // 503 yang jujur, bukan 500 generik: penyebabnya di sisi kami dan bisa
    // pulih, jadi pengguna berhak tahu ia boleh mencoba lagi.
    if (err instanceof TemplateTidakDisajikan) {
      console.error(`[naskah] ditolak, template tidak disajikan — ${err.sebabTeknis}`);
      // Jejak untuk ALARM operasional: sejak template tidak lagi disajikan,
      // penulis LLM yang mati berarti pengguna berbayar tidak dapat naskah
      // sama sekali. Kegagalan itu harus TERLIHAT, bukan cuma jadi 503 di
      // layar satu orang. Dihitung lib/operational-monitor.
      try {
        if (postgresRuntimeEnabled()) await pgAudit("script-engine", "naskah.penulis_tidak_tersedia", "scripts", null, { sebab: err.sebabTeknis });
        else audit("script-engine", "naskah.penulis_tidak_tersedia", "scripts", null, { sebab: err.sebabTeknis });
      } catch { /* alarm tidak boleh menelan galat aslinya */ }
      return Response.json(
        {
          code: "SCRIPT_WRITER_UNAVAILABLE",
          message_id: err.message,
          // TIDAK memuat sebab teknis. message_en ikut terkirim ke browser,
          // jadi menaruhnya di sini sama saja dengan menampilkannya — hanya
          // dalam bahasa lain. Sebabnya sudah lengkap di log dan audit.
          message_en: "We could not finish the script right now. Please try again shortly.",
          retryable: true,
        },
        { status: 503 }
      );
    }
    return errorResponse(err);
  }
}
