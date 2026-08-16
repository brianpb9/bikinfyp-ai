import crypto from "node:crypto";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { AVATAR_PRESETS, getAvatarPreset } from "@/lib/avatar-presets";
import { CAMPAIGN_TEMPLATES, TVC_ROUTES } from "@/lib/templates";
import { aiRenderBlockMessage } from "@/lib/template-render-safety";
import { generateScripts } from "@/lib/script-engine";
import { getCreatorCategory } from "@/lib/personas";
import { getRecordingStyle } from "@/lib/media/recording-styles";
import { normalizeHookLevel } from "@/lib/config/hooks";
import { tierPriceIdr } from "@/lib/credits";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { PgCreditPaymentRepository } from "@/lib/postgres/credit-payment";
import { PgJobsRepository } from "@/lib/postgres/jobs";
import { getPool } from "@/lib/postgres/pool";
import { postgresRuntimeEnabled, pgFindOrCreatePersona, smokeCreateScripts, smokeGetProduct } from "@/lib/postgres/smoke-runtime";
import { renderSatuSel, type HasilSel } from "@/lib/dashboard/render-cell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dashboard/matrix — SATU produk, banyak avatar x banyak skenario.
 *
 * Dua sumbu yang diminta Brian, dan keduanya kasus khusus dari satu operasi
 * yang sama:
 *
 *   1 avatar  x N skenario  -> satu influencer menjelaskan produk berkali-kali
 *   N avatar  x 1 skenario  -> satu skenario dibawakan puluhan wajah berbeda
 *   M avatar  x N skenario  -> matriks penuh
 *
 * Karena itu tidak ada "mode": UI memilih himpunan avatar dan himpunan
 * skenario, dan yang dirender adalah perkalian keduanya. Memisahkannya jadi dua
 * fitur akan melahirkan dua jalur kode yang menyimpang, padahal perbedaannya
 * cuma panjang salah satu daftar.
 *
 * SATU SKENARIO = SATU SKRIP, dan tiap sel butuh baris skrip SENDIRI. Baris
 * skrip diklaim satu job lewat "WHERE job_id IS NULL" (klaim atomik di sel
 * render), jadi satu skrip tidak bisa dipakai lima avatar sekaligus. Skenario
 * yang sama karena itu ditulis ulang sebanyak avatar yang dipilih: isinya
 * identik, barisnya berbeda. Itu memang yang diinginkan — perbandingan avatar
 * baru berarti kalau naskahnya benar-benar sama.
 */

// Batas keras. Bukan angka bulat yang enak dilihat: 24 sel tier bersuara 15
// detik = Rp288.000 sekali klik, dan itu sudah cukup besar untuk membuat salah
// klik terasa. Di atas ini brand sebaiknya menjalankan dua kali dan melihat
// hasil yang pertama dulu.
const MAKS_SEL = 24;
const MAKS_AVATAR = 12;
const MAKS_SKENARIO = 6;

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard matrix requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("confirm", membership.org_id);
    const body = await req.json().catch(() => ({}));

    // ---- produk ----
    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    const product = await smokeGetProduct(user.id, productId);
    if (!product || product.org_id !== membership.org_id) throw ERR.NOT_FOUND("Produknya");
    if (!product.price_idr) throw ERR.BAD_REQUEST("Isi harga produknya dulu — harga dipakai di skrip dan overlay.", "Product price is required.");
    if ((JSON.parse(product.images || "[]") as string[]).length === 0) {
      throw ERR.BAD_REQUEST("Upload minimal 1 gambar dulu — foto produk, atau logo/foto toko untuk iklan jasa.", "At least one image is required.");
    }

    // ---- format ----
    const ALLOWED_FORMATS = ["talking_head", "hands_only", "tvc", "ads"] as const;
    const format = ALLOWED_FORMATS.find((f) => f === body.format) ?? null;
    if (!format) throw ERR.BAD_REQUEST("Format tidak dikenal. Pilih Wajah AI, Tangan + VO, TVC, atau Iklan Jasa.", "Unknown format.");

    // ---- sumbu 1: avatar ----
    //
    // Divalidasi terhadap katalog nyata DAN terhadap kategori kreator yang
    // masih aktif. Preset yang suaranya menunjuk kategori pensiun akan lolos
    // ke worker lalu jatuh ke suara bawaan — avatar pria bersuara perempuan,
    // persis cacat yang baru ditutup di wizard retail 16 Agu 2026.
    const avatarIds: string[] = (Array.isArray(body.avatar_ids) ? body.avatar_ids : [])
      .map((a: unknown) => String(a ?? "")).filter(Boolean);
    const avatarUnik = [...new Set(avatarIds)].slice(0, MAKS_AVATAR);
    if (avatarUnik.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 avatar.", "No avatars selected.");
    const avatars = avatarUnik.map((id) => {
      const preset = getAvatarPreset(id);
      if (!preset) throw ERR.BAD_REQUEST(`Avatar "${id}" tidak ada di katalog.`, "Unknown avatar preset.");
      const category = getCreatorCategory(preset.voice);
      if (!category || category.status !== "active") {
        throw ERR.BAD_REQUEST(`Avatar ${preset.name} sedang tidak tersedia — suaranya sudah tidak aktif.`, "Avatar voice category inactive.");
      }
      return { preset, category };
    });

    // ---- sumbu 2: skenario ----
    //
    // Satu skenario = satu template kampanye. Template diambil dari katalog
    // yang sama dengan wizard, jadi tidak ada "skenario" karangan yang diam-
    // diam jatuh ke beat generik.
    const skenarioIds: string[] = (Array.isArray(body.template_ids) ? body.template_ids : [])
      .map((t: unknown) => String(t ?? "")).filter(Boolean);
    const skenarioUnik = [...new Set(skenarioIds)].slice(0, MAKS_SKENARIO);
    if (skenarioUnik.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 skenario.", "No scenarios selected.");
    const skenario = skenarioUnik.map((id) => {
      const t = CAMPAIGN_TEMPLATES.find((c) => c.id === id);
      if (!t) throw ERR.BAD_REQUEST(`Skenario "${id}" tidak ada di katalog.`, "Unknown campaign template.");
      return t;
    });

    // Template bukti diblokir SEBELUM persona, kredit, skrip, atau job dibuat.
    // Satu skenario terlarang membatalkan seluruh permintaan, bukan cuma
    // barisnya: brand yang meminta matriks berisi klaim hasil harus tahu
    // alasannya, bukan menemukan satu baris hilang tanpa penjelasan.
    for (const t of skenario) {
      const templateId = t.id;
      const blokir = aiRenderBlockMessage(templateId);
      if (blokir) throw ERR.BAD_REQUEST(blokir, "AI render blocked: verified original footage required for this evidence template.");
    }

    // ---- ukuran matriks ----
    const totalSel = avatars.length * skenario.length;
    if (totalSel > MAKS_SEL) {
      throw ERR.BAD_REQUEST(
        `${avatars.length} avatar x ${skenario.length} skenario = ${totalSel} video, di atas batas ${MAKS_SEL} sekali jalan. Kurangi salah satu sumbunya.`,
        "Matrix exceeds cell cap."
      );
    }

    // ---- pengaturan render bersama ----
    const TIERS = ["silent_caption", "high_quality", "super_hq"].filter(tierMasihDijual);
    const tier = TIERS.includes(String(body.tier)) ? (String(body.tier) as "silent_caption" | "high_quality" | "super_hq") : null;
    if (!tier) throw ERR.BAD_REQUEST("Kualitas tidak dikenal.", "Unknown quality tier.");
    const durationSec = [15, 30, 45].includes(Number(body.duration_sec)) ? (Number(body.duration_sec) as 15 | 30 | 45) : null;
    if (!durationSec) throw ERR.BAD_REQUEST("Durasi yang tersedia baru 15, 30, atau 45 detik.", "Unsupported duration.");
    const RATIOS = ["9:16", "1:1", "16:9"];
    const ratio = RATIOS.includes(String(body.ratio)) ? String(body.ratio) : "9:16";
    const hookLevel = normalizeHookLevel(body.hook_level);
    const register = ["bunda", "bestie", "genz", "netral"].includes(body.register) ? body.register : "netral";
    const noModel = format === "tvc" && body.no_model === true;
    const tvcRoute = format === "tvc" && body.tvc_route !== "luxury" && TVC_ROUTES.includes(body.tvc_route as never)
      ? (body.tvc_route as string) : null;
    const gaya = getRecordingStyle(typeof body.record_style === "string" ? body.record_style : "");
    const recordStyle = gaya && gaya.id !== "standar" && gaya.formats.includes(format as never) ? gaya.id : null;
    const rawShots = Number(body.shot_count);
    const shotCount = Number.isInteger(rawShots) && rawShots >= 2 && rawShots <= 6 ? rawShots : null;

    // Biaya diberitahukan sebelum dieksekusi supaya angka di UI dan angka yang
    // benar-benar ditahan berasal dari rumus yang sama.
    const hargaPerVideo = tierPriceIdr(tier, durationSec);

    const runId = crypto.randomUUID();
    const pool = getPool(config.databaseUrl);
    const jobsRepo = new PgJobsRepository(config.databaseUrl);
    const creditsRepo = new PgCreditPaymentRepository(config.databaseUrl);
    const hasil: (HasilSel & { avatar_id: string; template_id: string })[] = [];

    try {
      // Persona dibuat sekali per avatar, bukan sekali per sel: satu avatar
      // dipakai di semua skenario, dan membuat ulang personanya tiap sel cuma
      // menambah baris kembar tanpa efek apa pun.
      const personaPerAvatar = new Map<string, string>();
      for (const { preset, category } of avatars) {
        personaPerAvatar.set(preset.id, (await pgFindOrCreatePersona(user.id, category)).id);
      }

      for (const t of skenario) {
        // Satu naskah per skenario, lalu DISALIN sebanyak avatar. Naskahnya
        // sengaja identik antar avatar — perbandingan wajah baru berarti kalau
        // kalimatnya tidak ikut berubah.
        const varian = generateScripts({
          product: {
            id: product.id, name: product.name, price_idr: product.price_idr, category: product.category,
            sourceUrl: product.source_url, promoPriceBeforeIdr: product.promo_price_before_idr,
            promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
          },
          register, emotion: "senang", qualityTier: tier, durationSec, hookLevel, count: 1, templateId: t.id,
        });
        const lolos = varian.find((v) => v.validation.passed);
        if (!lolos) {
          for (const { preset } of avatars) {
            hasil.push({ status: "failed", script_id: "", reason: `Skenario "${t.name}" tidak menghasilkan naskah yang lolos validasi.`, avatar_id: preset.id, template_id: t.id });
          }
          continue;
        }
        // Satu baris skrip per avatar — lihat catatan klaim atomik di atas.
        const barisSkrip = await smokeCreateScripts(user.id, productId, avatars.map(() => ({
          hookFamily: lolos.hook_family, emotion: lolos.emotion, register: lolos.register,
          segments: lolos.segments, caption: lolos.caption, hashtags: lolos.hashtags,
          validationResult: lolos.validation, qualityTier: tier, hookLevel,
        })));

        for (let i = 0; i < avatars.length; i++) {
          const { preset } = avatars[i];
          const sel = await renderSatuSel({
            userId: user.id, orgId: membership.org_id,
            productId, productName: product.name, productPriceIdr: product.price_idr,
            promoPriceBeforeIdr: product.promo_price_before_idr ?? null,
            scriptId: barisSkrip[i].id,
            personaId: personaPerAvatar.get(preset.id)!,
            // Wajah influencer. Tanpa ini semua avatar yang berbagi kategori
            // suara akan tampil sama persis — dan matriks avatar yang isinya
            // wajah kembar tidak membuktikan apa pun.
            avatarCustomDesc: preset.desc,
            format, ratio, noModel, tvcRoute, templateId: t.id, recordStyle, shotCount, runId,
          }, { pool, jobsRepo, creditsRepo });
          hasil.push({ ...sel, avatar_id: preset.id, template_id: t.id });
        }
      }
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
      await jobsRepo.close();
      await creditsRepo.close();
    }

    return Response.json({
      run_id: runId,
      matrix: { avatars: avatars.length, scenarios: skenario.length, cells: totalSel },
      price_per_video_idr: hargaPerVideo,
      queued_count: hasil.filter((r) => r.status === "queued").length,
      results: hasil,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/dashboard/matrix — katalog sumbu untuk UI, tanpa side effect. */
export async function GET(req: Request) {
  try {
    const { membership } = await requireOrgContextApi(req);
    // Produk milik ORG, bukan milik user yang kebetulan login: matriks dijalankan
    // atas nama organisasi dan dibayar dari dompet organisasi, jadi daftarnya
    // harus sama untuk siapa pun anggotanya.
    const produk = postgresRuntimeEnabled()
      ? (await getPool(config.databaseUrl).query<{ id: string; name: string; price_idr: number; category: string; images: string }>(
          "SELECT id, name, price_idr, category, images FROM products WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50", [membership.org_id]
        )).rows.map((r) => ({
          product_id: r.id, name: r.name, price_idr: r.price_idr, category: r.category,
          image: (JSON.parse(r.images || "[]") as string[])[0] ?? null,
        }))
      : [];
    return Response.json({
      products: produk,
      avatars: AVATAR_PRESETS.map((a) => ({ id: a.id, name: a.name, note: a.note, img: a.img, gender: a.gender })),
      scenarios: CAMPAIGN_TEMPLATES
        // Template bukti tidak ditawarkan sama sekali di matriks: menampilkannya
        // lalu menolaknya saat submit cuma memindahkan kekecewaan ke belakang.
        .filter((t) => !aiRenderBlockMessage(t.id))
        .map((t) => ({ id: t.id, name: t.name, when: t.when })),
      limits: { max_cells: MAKS_SEL, max_avatars: MAKS_AVATAR, max_scenarios: MAKS_SKENARIO },
      // Tarif dikirim dari server, TIDAK disalin ke komponen klien. Pelajaran
      // yang sudah dibayar sekali di sidebar dashboard: tarif yang disalin
      // pasti hanyut, dan yang menemukan selisihnya pengguna — setelah mereka
      // menekan tombol yang menjanjikan angka lain.
      prices: Object.fromEntries(
        (["high_quality", "super_hq"] as const)
          .filter(tierMasihDijual)
          .flatMap((t) => [15, 30, 45].map((d) => [`${t}:${d}`, tierPriceIdr(t, d)]))
      ),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
