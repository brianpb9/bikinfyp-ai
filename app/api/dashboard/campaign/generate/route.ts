import { ERR, errorResponse } from "@/lib/errors";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates";
import type { HookCode } from "@/lib/config/hooks";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { generateScripts, TEMPLATE_COPY_CAPACITY } from "@/lib/script-engine";
import { cleanProductName } from "@/lib/extract";
import { postgresRuntimeEnabled, smokeCreateScripts, smokeGetOrgProduct } from "@/lib/postgres/smoke-runtime";
import { normalizeHookLevel } from "@/lib/config/hooks";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { getAvatarPreset } from "@/lib/avatar-presets";

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
    await assertDashboardRate("generate", membership.org_id);
    const body = await req.json().catch(() => ({}));

    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    // Per-ORG, bukan per-user. Produk dashboard dibuat satu anggota, dibayar
    // dari dompet organisasi, dan dipakai seluruh tim — pemeriksaan per-user
    // menolak rekan satu tim atas produk yang jelas ada di daftar mereka.
    const product = await smokeGetOrgProduct(membership.org_id, productId);
    if (!product) throw ERR.NOT_FOUND("Produknya");
    if (!product.price_idr) throw ERR.BAD_REQUEST("Isi harga produknya dulu — harga dipakai di skrip dan overlay.", "Product price is required.");
    const images = JSON.parse(product.images || "[]") as string[];
    // Iklan jasa tetap butuh SATU visual — logo, foto toko, atau screenshot app.
    // Text-to-video murni belum pernah kami uji ke provider, jadi tidak dipakai
    // sampai terbukti; meminta satu visual bisnis jauh lebih murah daripada
    // menjanjikan sesuatu yang belum tentu jalan.
    if (images.length === 0) throw ERR.BAD_REQUEST("Upload minimal 1 gambar dulu — foto produk, atau logo/foto toko/screenshot app untuk iklan jasa.", "At least one image is required.");

    const count = Number.isFinite(Number(body.count)) ? Math.round(Number(body.count)) : 0;
    if (count < MIN_VIDEOS || count > MAX_VIDEOS) {
      throw ERR.BAD_REQUEST(`Jumlah video harus antara ${MIN_VIDEOS} dan ${MAX_VIDEOS}.`, "count out of range.");
    }
    const templateId = typeof body.template_id === "string"
      && CAMPAIGN_TEMPLATES.some((template) => template.id === body.template_id)
      ? body.template_id as string
      : null;
    if (templateId && count > TEMPLATE_COPY_CAPACITY) {
      throw ERR.BAD_REQUEST(
        `Template ini menyediakan maksimal ${TEMPLATE_COPY_CAPACITY} variasi naskah unik. Lepas template untuk membuat sampai ${MAX_VIDEOS} video.`,
        "Template variant count exceeds unique copy capacity."
      );
    }
    // Tiga tier, sesuai kontrol Quality di wizard (Standard / Quality / High
    // Quality). Daftar pensiunnya dari lib/paket-kredit — SATU sumber dengan
    // halaman harga retail dan wizard Enterprise. Sebelumnya route ini menerima
    // silent_caption dengan alasan "ia tier produksi yang dipakai retail", dan
    // alasan itu sudah tidak benar sejak retail memensiunkannya: Enterprise
    // menjual Standard Rp5.000 sementara retail menyatakannya tidak tersedia.
    const TIERS = ["silent_caption", "high_quality", "super_hq"].filter(tierMasihDijual);
    const tier = TIERS.includes(String(body.tier)) ? (String(body.tier) as "silent_caption" | "high_quality" | "super_hq") : null;
    if (!tier) throw ERR.BAD_REQUEST("Kualitas tidak dikenal. Pilih Standard, Quality, atau High Quality.", "Unknown quality tier.");
    const durationSec = [15, 30, 45].includes(Number(body.duration_sec)) ? (Number(body.duration_sec) as 15 | 30 | 45) : null;
    if (!durationSec) throw ERR.BAD_REQUEST("Durasi yang tersedia baru 15, 30, atau 45 detik.", "Unsupported duration.");
    const hookLevel = normalizeHookLevel(body.hook_level);
    const avatar = typeof body.avatar_id === "string" ? getAvatarPreset(body.avatar_id) : null;
    if (body.avatar_id && !avatar) throw ERR.BAD_REQUEST("Avatar tidak dikenal. Pilih ulang avatarnya.", "Unknown avatar_id.");
    const register = avatar?.register ?? (["bunda", "bestie", "genz", "netral"].includes(body.register) ? body.register : "netral");
    // Hook khas template (mis. "Diskon Gede" -> H1). pickHookFamilies menaruh
    // ini di DEPAN lalu melanjutkan dengan prioritas kategori, jadi varian
    // pertama membawa sudut template dan sisanya tetap beragam — bukan 4 video
    // dengan hook yang sama persis. Divalidasi ketat: kode yang tidak dikenal
    // diabaikan, bukan diteruskan ke mesin.
    const rawBeats = body.beats as { hookEnd?: unknown; demoEnd?: unknown } | undefined;
    const hookEnd = Number(rawBeats?.hookEnd);
    const demoEnd = Number(rawBeats?.demoEnd);
    const beats =
      Number.isFinite(hookEnd) && Number.isFinite(demoEnd) &&
      hookEnd > 0 && hookEnd < demoEnd && demoEnd < 1
        ? { hookEnd, demoEnd }
        : null;
    const rawBudget = Number(body.word_budget);
    // Batas atas 120 bukan angka asal: video 45 dtk tier bersuara pun cuma
    // ~90 kata, jadi nilai di atas ini pasti salah kirim, bukan permintaan.
    const wordBudget = Number.isFinite(rawBudget) && rawBudget >= 10 && rawBudget <= 120
      ? Math.round(rawBudget) : null;
    const rawFamilies = Array.isArray(body.hook_families) ? body.hook_families : [];
    const hookFamilies = rawFamilies
      .map((f: unknown) => String(f ?? "").toUpperCase())
      .filter((f: string) => /^H([1-9]|1[0-6])$/.test(f)) as HookCode[];

    const run = (name: string) => generateScripts({
      product: {
        id: product.id, name, price_idr: product.price_idr, category: product.category, sourceUrl: product.source_url,
        promoPriceBeforeIdr: product.promo_price_before_idr, promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
      },
      register, emotion: "senang", qualityTier: tier, durationSec, hookLevel, count,
      // Enterprise: Idea Stage selalu ikut, tidak melihat tier.
      orgId: membership.org_id,
      ...(hookFamilies.length ? { hookFamilies } : {}),
      ...(body.lock_hook_family === true ? { lockHookFamily: true } : {}),
      // Divalidasi terhadap katalog nyata, bukan diterima mentah — id karangan
      // hanya akan diam-diam jatuh ke teks generik tanpa jejak.
      ...(templateId ? { templateId } : {}),
      // Pecahan dijaga di sini juga, bukan cuma di mesin: nilai dari luar
      // tidak boleh bisa membuat hook lebih panjang dari videonya.
      ...(beats ? { beats } : {}),
      ...(wordBudget ? { wordBudget } : {}),
    });

    let variants = await run(product.name);
    let passing = variants.filter((v) => v.validation.passed);
    // Jaring pengaman nama kepanjangan. Nama produk masuk ke kalimat skrip,
    // dan tier bersuara dibatasi ~30 kata (L-05) — nama 18 kata (judul SEO
    // marketplace, atau user mengetik panjang sendiri) membuat SEMUA varian
    // gagal. Ekstraksi sudah membersihkan nama sejak 2026-08-11, tapi produk
    // lama dan nama ketikan sendiri tetap bisa kepanjangan, jadi coba sekali
    // lagi dengan nama pendek daripada memblokir user tanpa jalan keluar.
    let shortenedTo: string | null = null;
    if (passing.length === 0) {
      const shorter = cleanProductName(product.name);
      if (shorter !== product.name) {
        const retry = await run(shorter);
        const retryPassing = retry.filter((v) => v.validation.passed);
        if (retryPassing.length > 0) { variants = retry; passing = retryPassing; shortenedTo = shorter; }
      }
    }
    if (passing.length === 0) {
      // Pesan lama cuma MENEBAK tiga sebab ("persingkat nama, pastikan harga,
      // turunkan hook") padahal validator tahu persis aturan mana yang jatuh.
      // Brian kena ini 16 Agu 2026 dan tidak punya cara tahu bahwa penyebabnya
      // panjang naskah. Sekarang sebabnya yang nyata ikut disebut.
      const jatuh = new Map<string, string>();
      for (const v of variants) for (const e of v.validation.errors) if (!jatuh.has(e.rule)) jatuh.set(e.rule, e.message_id);
      const alasan = [...jatuh.values()].slice(0, 2).join(" ");
      throw ERR.BAD_REQUEST(
        alasan
          ? `Skrip AI belum lolos validasi otomatis. ${alasan}`
          : "Skrip AI belum lolos validasi otomatis. Coba persingkat nama produk (maks ~6 kata), pastikan harganya benar, atau turunkan level hook.",
        `No generated variant passed validation: ${[...jatuh.keys()].join(", ") || "unknown"}`
      );
    }

    const created = await smokeCreateScripts(user.id, product.id, passing.map((v) => ({
      hookFamily: v.hook_family, emotion: v.emotion, register: v.register, segments: v.segments,
      caption: v.caption, hashtags: v.hashtags, validationResult: v.validation, qualityTier: tier, hookLevel,
    })), membership.org_id);

    return Response.json({
      product_id: product.id,
      requested: count,
      // Jujur kalau kami memendekkan nama supaya skrip bisa dibuat.
      shortened_name: shortenedTo,
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
