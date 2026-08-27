import crypto from "node:crypto";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { AVATAR_PRESETS, getAvatarPreset } from "@/lib/avatar-presets";
import { CAMPAIGN_TEMPLATES } from "@/lib/templates";
import { aiRenderBlockMessage } from "@/lib/template-render-safety";
import type { HookCode } from "@/lib/config/hooks";
import { getCreatorCategory } from "@/lib/personas";
import { tierPriceIdr } from "@/lib/credits";
import { tierMasihDijual } from "@/lib/paket-kredit";
import { getPool } from "@/lib/postgres/pool";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { amplopValidasi } from "@/lib/script-engine/admisi";
import { renderSatuSel, type HasilSel } from "@/lib/dashboard/render-cell";
import { pastikanBolehBelanja } from "@/lib/dashboard-rbac";
import { cobaDenganNamaPendek } from "@/lib/script-engine/jaring-nama";
import { acquireAdmissionReferenceEvidence } from "@/lib/job-admission-reference";
import { admissionRouteDependencies } from "@/lib/admission-route-dependencies";
import { releaseSessionAdvisoryLock } from "@/lib/postgres/evidence-lock-pool";
import { buildAuthoritativeTypeBoundaryInput, validateAuthoritativeProductType } from "@/lib/product-type-boundary";
import { canonicalProductTypeTimestamp } from "@/lib/product-type-timestamp";

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

/** Langit-langit belanja satu permintaan. Bukan pengganti konfirmasi manusia —
 *  ia jaring terakhir kalau semua penjagaan di atasnya bocor. */
const MAKS_BELANJA_IDR = 2_000_000;

/** runId yang DITURUNKAN dari kunci idempotensi, bukan diacak.
 *
 *  Dengan begini permintaan ulang (jaringan putus, tombol ditekan dua kali,
 *  retry otomatis) mendarat di runId yang SAMA, sehingga bisa dikenali sebagai
 *  pengulangan alih-alih menagih seluruh matriks untuk kedua kalinya.
 *  Diformat sebagai UUID supaya muat di kolom bulk_run_id yang sudah ada. */
function runIdDariKunci(orgId: string, kunci: string): string {
  const h = crypto.createHash("sha256").update(`${orgId}:${kunci}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Gerbang fitur. Dipasang di KEDUA handler — UI yang disembunyikan bukan
 *  penjagaan, dan yang dijaga di sini adalah tombol bernilai jutaan rupiah. */
function pastikanMatriksAktif() {
  if (!config.enterpriseMatrixEnabled) {
    throw ERR.NOT_FOUND("Fiturnya");
  }
}

export async function POST(req: Request) {
  try {
    const routeDeps = admissionRouteDependencies();
    pastikanMatriksAktif();
    if (!routeDeps.postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Dashboard matrix requires Postgres runtime.");
    const { user, membership } = await routeDeps.requireOrgContextApi(req);
    await routeDeps.assertDashboardRate("confirm", membership.org_id);
    // Matriks adalah pengeluaran terbesar yang bisa dipicu satu klik di produk
    // ini. Kalau ada satu tempat yang perannya wajib diperiksa, ini tempatnya.
    pastikanBolehBelanja(membership.role);
    // Satu gerbang untuk semua yang memakan uang. Sebelumnya jalur ini cuma
    // memeriksa migrasi, jadi ia tetap membuka diri walau JOB_INTAKE_MODE
    // sudah "closed" untuk perawatan.
    await routeDeps.assertPaidAdmission();
    const body = await req.json().catch(() => ({}));

    // ---- produk ----
    const productId = typeof body.product_id === "string" ? body.product_id : "";
    if (!productId) throw ERR.BAD_REQUEST("product_id wajib diisi.", "product_id is required.");
    // Per-ORG, bukan per-user: matriks dijalankan atas nama organisasi dan
    // dibayar dari dompetnya, jadi produk buatan rekan satu tim harus bisa
    // dipakai. Daftar di GET sudah di-query per org — memvalidasi per user di
    // sini akan menampilkan produk lalu menolaknya saat ditekan.
    const product = await routeDeps.smokeGetOrgProduct(membership.org_id, productId);
    if (!product) throw ERR.NOT_FOUND("Produknya");
    return await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
      { kind: "DECLARED_PRODUCT_TYPE", sourceId: "stored-org-product.product_type_token", token: product.product_type_token ?? "", version: 1 },
      product.product_type_state === "CONFIRMED" && product.product_type_confirmed_token
        && product.product_type_confirmed_by && product.product_type_confirmed_at && product.product_type_version === 1
        ? {
            kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: product.product_type_confirmed_token,
            actorId: product.product_type_confirmed_by,
            confirmedAt: canonicalProductTypeTimestamp(product.product_type_confirmed_at),
            version: 1, provenance: "USER_SELF_ASSERTION",
          }
        : null,
    ), async () => {
    if (!product.price_idr) throw ERR.BAD_REQUEST("Isi harga produknya dulu — harga dipakai di skrip dan overlay.", "Product price is required.");
    const productImages = JSON.parse(product.images || "[]") as string[];
    // ---- format: TIDAK ADA format global ----
    //
    // Setiap template membawa formatnya SENDIRI (talking_head, hands_only,
    // tvc, ads) karena format itu bagian dari skenarionya, bukan preferensi
    // tampilan. Versi pertama menerima satu format global lalu menerapkannya
    // ke semua sel — sehingga brand bisa memilih skenario TVC lalu
    // merendernya sebagai hands-only, dan yang keluar bukan skenario yang
    // mereka pilih. Format sekarang dibaca dari templatenya di bawah.

    // ---- sumbu 1: avatar ----
    //
    // Divalidasi terhadap katalog nyata DAN terhadap kategori kreator yang
    // masih aktif. Preset yang suaranya menunjuk kategori pensiun akan lolos
    // ke worker lalu jatuh ke suara bawaan — avatar pria bersuara perempuan,
    // persis cacat yang baru ditutup di wizard retail 16 Agu 2026.
    const avatarIds: string[] = (Array.isArray(body.avatar_ids) ? body.avatar_ids : [])
      .map((a: unknown) => String(a ?? "")).filter(Boolean);
    // DITOLAK, BUKAN DIPOTONG.
    //
    // Versi pertama memakai .slice() — UI bisa menjanjikan 20 video, server
    // diam-diam membuat 12, dan tidak ada yang memberi tahu siapa pun bahwa
    // delapan sisanya tidak pernah ada. Pemotongan diam pada permintaan yang
    // menyangkut uang selalu lebih buruk daripada penolakan yang jujur.
    const avatarUnik = [...new Set(avatarIds)];
    if (avatarUnik.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 avatar.", "No avatars selected.");
    if (avatarUnik.length > MAKS_AVATAR) {
      throw ERR.BAD_REQUEST(`Maksimal ${MAKS_AVATAR} avatar sekali jalan, kamu memilih ${avatarUnik.length}.`, "Too many avatars.");
    }
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
    const skenarioUnik = [...new Set(skenarioIds)];
    if (skenarioUnik.length === 0) throw ERR.BAD_REQUEST("Pilih minimal 1 skenario.", "No scenarios selected.");
    if (skenarioUnik.length > MAKS_SKENARIO) {
      throw ERR.BAD_REQUEST(`Maksimal ${MAKS_SKENARIO} skenario sekali jalan, kamu memilih ${skenarioUnik.length}.`, "Too many scenarios.");
    }
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
    // Yang tersisa sebagai pilihan pengguna cuma DUA, dan dua-duanya memang
    // bukan bagian dari skenario: rasio (tempat tayang) dan tier (mutu/harga).
    // Durasi, hook, dan format ikut skenarionya.
    const RATIOS = ["9:16", "1:1", "16:9"];
    const ratio = RATIOS.includes(String(body.ratio)) ? String(body.ratio) : "9:16";
    const register = ["bunda", "bestie", "genz", "netral"].includes(body.register) ? body.register : "netral";

    // Harga per sel mengikuti DURASI SKENARIO-nya, jadi totalnya dijumlahkan
    // per skenario — bukan satu harga dikali jumlah sel. Skenario 30 detik
    // memang dua kali lipat skenario 15 detik.
    const hargaPerSkenario = new Map(skenario.map((t) => [t.id, tierPriceIdr(tier, t.durationSec)]));
    const totalBelanja = skenario.reduce((n, t) => n + hargaPerSkenario.get(t.id)! * avatars.length, 0);
    const hargaPerVideo = Math.round(totalBelanja / totalSel);

    // LAYAR DAN SERVER HARUS SEPAKAT SEBELUM UANG BERGERAK.
    //
    // Klien wajib mengirim total yang IA TAMPILKAN. Kalau berbeda dengan
    // hitungan server — tarif berubah, durasi berubah, pilihan berubah di
    // antara render dan klik — permintaannya ditolak, bukan dijalankan dengan
    // angka yang tidak pernah dilihat pengguna. Ini bentuk paling ringkas dari
    // "quote lalu konfirmasi": persetujuan hanya sah untuk angka yang disetujui.
    const totalDiharapkan = Number(body.expected_total_idr);
    if (!Number.isFinite(totalDiharapkan)) {
      throw ERR.BAD_REQUEST("Permintaan tidak menyertakan total biaya yang kamu lihat.", "expected_total_idr is required.");
    }
    if (Math.round(totalDiharapkan) !== totalBelanja) {
      throw ERR.BAD_REQUEST(
        `Total biaya berubah sejak halaman terakhir dihitung (di layarmu Rp${Math.round(totalDiharapkan).toLocaleString("id-ID")}, sekarang Rp${totalBelanja.toLocaleString("id-ID")}). Muat ulang lalu periksa lagi.`,
        "Quote mismatch."
      );
    }
    if (totalBelanja > MAKS_BELANJA_IDR) {
      throw ERR.BAD_REQUEST(
        `Total Rp${totalBelanja.toLocaleString("id-ID")} melewati batas Rp${MAKS_BELANJA_IDR.toLocaleString("id-ID")} sekali jalan. Pecah jadi beberapa kali.`,
        "Spend cap exceeded."
      );
    }

    // Kunci idempotensi WAJIB. Tanpanya, satu retry menagih seluruh matriks
    // untuk kedua kalinya — dan matriks adalah tempat pengulangan paling mahal.
    const kunciIdem = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
    if (kunciIdem.length < 8 || kunciIdem.length > 200) {
      throw ERR.BAD_REQUEST("Permintaan tidak menyertakan kunci idempotensi yang sah.", "idempotency_key required (8-200 chars).");
    }
    const runId = runIdDariKunci(membership.org_id, kunciIdem);
    const { pool, jobsRepo, creditsRepo } = routeDeps.createMatrixResources();
    const hasil: (HasilSel & { avatar_id: string; template_id: string })[] = [];

    // PENEGAKAN IDEMPOTENSI.
    //
    // Kunci saja tidak cukup — ia harus dipakai untuk MENOLAK pekerjaan kedua.
    // Advisory lock membuat dua permintaan kembar yang datang bersamaan
    // berbaris, bukan sama-sama lolos pemeriksaan "belum ada" lalu sama-sama
    // membuat 24 job. Lock dilepas di blok finally di bawah.
    const kunciLock = await routeDeps.connectMatrixRunLockClient();
    let sudahAda: { job_id: string }[] = [];
    try {
      await kunciLock.query("SELECT pg_advisory_lock(hashtext($1))", [runId]);
      const lama = await kunciLock.query<{ id: string }>(
        "SELECT id FROM jobs WHERE org_id=$1 AND bulk_run_id=$2", [membership.org_id, runId]
      );
      sudahAda = lama.rows.map((r) => ({ job_id: r.id }));
    } catch (err) {
      await releaseSessionAdvisoryLock({
        client: kunciLock,
        sql: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
        values: [runId],
        label: "matrix-run-lock",
      });
      throw err;
    }

    // Permintaan ini sudah pernah dijalankan. Jawab dengan hasil yang SAMA,
    // tanpa membuat skrip, job, atau tahanan kredit apa pun yang baru.
    if (sudahAda.length) {
      await releaseSessionAdvisoryLock({
        client: kunciLock,
        sql: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
        values: [runId],
        label: "matrix-run-lock",
      });
      await jobsRepo.close(); await creditsRepo.close();
      return Response.json({
        run_id: runId, duplicated: true,
        matrix: { avatars: avatars.length, scenarios: skenario.length, cells: totalSel },
        price_per_video_idr: hargaPerVideo, total_idr: totalBelanja,
        queued_count: sudahAda.length,
        results: sudahAda.map((j) => ({ status: "queued", script_id: "", job_id: j.job_id, avatar_id: "", template_id: "" })),
      });
    }

    // Duplicate replay above is authoritative and uses immutable job
    // manifests. Only genuinely new matrix work needs current product
    // evidence. Keep the product row stable until every new provider/setup
    // operation finishes so E9 cannot slip through after this check.
    let evidenceLease: Awaited<ReturnType<typeof acquireAdmissionReferenceEvidence>> | null = null;
    try {
      if (productImages.length === 0) {
        throw ERR.BAD_REQUEST("Upload minimal 1 gambar dulu — foto produk, atau logo/foto toko untuk iklan jasa.", "At least one image is required.");
      }
      evidenceLease = await acquireAdmissionReferenceEvidence({
        productId: product.id,
        owner: { kind: "org", id: membership.org_id },
        boundary: "A2",
        loadSqliteCandidateRels: () => productImages,
        loadSqliteProductType: () => ({
          product_type_token: product.product_type_token ?? null,
          product_type_confirmed_token: product.product_type_confirmed_token ?? null,
          product_type_confirmed_by: product.product_type_confirmed_by ?? null,
          product_type_confirmed_at: product.product_type_confirmed_at ?? null,
          product_type_version: product.product_type_version ?? null,
          product_type_state: product.product_type_state ?? "QUARANTINED",
        }),
      });
      const lockedProductType = evidenceLease.productType;
      await validateAuthoritativeProductType(buildAuthoritativeTypeBoundaryInput(
        { kind: "DECLARED_PRODUCT_TYPE", sourceId: "locked-org-product.product_type_token", token: lockedProductType?.product_type_token ?? "", version: 1 },
        lockedProductType?.product_type_state === "CONFIRMED" && lockedProductType.product_type_confirmed_token
          && lockedProductType.product_type_confirmed_by && lockedProductType.product_type_confirmed_at
          && lockedProductType.product_type_version === 1 ? {
            kind: "HUMAN_PRODUCT_TYPE_CONFIRMATION", token: lockedProductType.product_type_confirmed_token,
            actorId: lockedProductType.product_type_confirmed_by,
            confirmedAt: canonicalProductTypeTimestamp(lockedProductType.product_type_confirmed_at),
            version: 1, provenance: "USER_SELF_ASSERTION",
          } : null,
      ), () => undefined);
      // Persona dibuat sekali per avatar, bukan sekali per sel: satu avatar
      // dipakai di semua skenario, dan membuat ulang personanya tiap sel cuma
      // menambah baris kembar tanpa efek apa pun.
      const personaPerAvatar = new Map<string, string>();
      for (const { preset, category } of avatars) {
        personaPerAvatar.set(preset.id, (await routeDeps.pgFindOrCreatePersona(user.id, category)).id);
      }

      for (const t of skenario) {
        // Satu naskah per skenario, lalu DISALIN sebanyak avatar. Naskahnya
        // sengaja identik antar avatar — perbandingan wajah baru berarti kalau
        // kalimatnya tidak ikut berubah.
        // Jaring pengaman nama (canary temuan #4) — sama seperti campaign &
        // retail: nama sah yang kepanjangan diturunkan bertangga sampai lolos.
        const jalanSkenario = (namaProduk: string) => routeDeps.generateScripts({
          product: {
            id: product.id, name: namaProduk, price_idr: product.price_idr, category: product.category,
            sourceUrl: product.source_url, promoPriceBeforeIdr: product.promo_price_before_idr,
            promoEndsAt: product.promo_ends_at, promoStockLeft: product.promo_stock_left,
          },
          register, emotion: "senang", qualityTier: tier,
          // Enterprise: Idea Stage selalu ikut, tidak melihat tier.
          orgId: membership.org_id,
          // SELURUH konfigurasi kreatif diambil dari templatenya, bukan dari
          // satu pengaturan global. Versi pertama cuma mengirim templateId,
          // sehingga hook khas template ("Diskon Gede" -> H1, "Review Jujur"
          // -> H3) tidak pernah terwujud dan hampir semua skenario keluar
          // dengan keluarga hook yang salah — brand membayar skenario yang
          // mereka pilih dan menerima naskah generik.
          durationSec: t.durationSec,
          hookLevel: t.hookLevel,
          count: 1,
          templateId: t.id,
          // Genre dari katalog: matrix menjalankan template Ads juga.
          ...(t.kind === "ads" ? { contentType: "ads" as const } : {}),
          ...(t.format ? { format: t.format } : {}),
          // lockHookFamily: hook template dipakai APA ADANYA, bukan dijadikan
          // saran yang boleh ditimpa prioritas kategori.
          ...(t.hookFamily ? { hookFamilies: [t.hookFamily as HookCode], lockHookFamily: true } : {}),
        });
        const { variants: varian } = await cobaDenganNamaPendek(jalanSkenario, product.name);
        const lolos = varian.find((v) => v.validation.passed);
        if (!lolos) {
          for (const { preset } of avatars) {
            hasil.push({ status: "failed", script_id: "", reason: `Skenario "${t.name}" tidak menghasilkan naskah yang lolos validasi.`, avatar_id: preset.id, template_id: t.id });
          }
          continue;
        }
        // Satu baris skrip per avatar — lihat catatan klaim atomik di atas.
        const barisSkrip = await routeDeps.smokeCreateScripts(user.id, productId, avatars.map(() => ({
          hookFamily: lolos.hook_family, emotion: lolos.emotion, register: lolos.register,
          segments: lolos.segments, caption: lolos.caption, hashtags: lolos.hashtags,
          // Amplop lengkap (snapshot + provenance) — lihat campaign/generate.
          validationResult: amplopValidasi(lolos.validation, { script_source: lolos.script_source, admisi: lolos.admisi }),
          qualityTier: tier, hookLevel: t.hookLevel,
        })), membership.org_id);

        for (let i = 0; i < avatars.length; i++) {
          const { preset } = avatars[i];
          const sel = await renderSatuSel({
            userId: user.id, orgId: membership.org_id,
            productId, productName: product.name, productPriceIdr: product.price_idr,
          // Label keranjang mengikuti platform — lihat konteksAdmisi().
          productSourceUrl: product.source_url,
            promoPriceBeforeIdr: product.promo_price_before_idr ?? null,
            scriptId: barisSkrip[i].id,
            personaId: personaPerAvatar.get(preset.id)!,
            // Wajah influencer. Tanpa ini semua avatar yang berbagi kategori
            // suara akan tampil sama persis — dan matriks avatar yang isinya
            // wajah kembar tidak membuktikan apa pun.
            avatarCustomDesc: preset.desc,
            // Format ikut SKENARIO-nya. Katalog memuat template TVC,
            // talking-head, ads, dan hands-only sekaligus; memaksakan satu
            // format global ke semuanya membuat skenario TVC dirender sebagai
            // hands-only — bukan skenario yang dipilih brand.
            format: t.format,
            // Rute TVC dan "tanpa model" hanya berarti pada format tvc, dan
            // di luar itu justru membuat prompt bertengkar dengan dirinya
            // sendiri. Karena formatnya sekarang dari template, keduanya juga.
            noModel: false,
            tvcRoute: t.format === "tvc" && t.tvcRoute ? t.tvcRoute : null,
            // Rasio juga milik skenario kalau ia menyatakannya: TVC sinematik
            // memang 16:9, dan memaksanya jadi 9:16 karena pengguna memilih
            // itu di atas menghasilkan komposisi yang salah. Pilihan pengguna
            // dipakai hanya untuk template yang memang tidak peduli.
            ratio: t.ratio ?? ratio,
            templateId: t.id,
          // Genre dari katalog: matrix menjalankan template Ads juga.
          ...(t.kind === "ads" ? { contentType: "ads" as const } : {}),
          ...(t.format ? { format: t.format } : {}), recordStyle: null, shotCount: null, runId,
          }, { pool, jobsRepo, creditsRepo });
          hasil.push({ ...sel, avatar_id: preset.id, template_id: t.id });
        }
      }
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
      await evidenceLease?.release();
      await releaseSessionAdvisoryLock({
        client: kunciLock,
        sql: "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
        values: [runId],
        label: "matrix-run-lock",
      });
      await jobsRepo.close();
      await creditsRepo.close();
    }

    return Response.json({
      run_id: runId,
      duplicated: false,
      matrix: { avatars: avatars.length, scenarios: skenario.length, cells: totalSel },
      price_per_video_idr: hargaPerVideo,
      total_idr: totalBelanja,
      queued_count: hasil.filter((r) => r.status === "queued").length,
      results: hasil,
    });
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** GET /api/dashboard/matrix — katalog sumbu untuk UI, tanpa side effect. */
export async function GET(req: Request) {
  try {
    pastikanMatriksAktif();
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
      // Peran dikirim supaya UI bisa JUJUR DI DEPAN. Menolak di akhir setelah
      // brand menyusun matriks 12 sel adalah cara paling buruk menyampaikan
      // batasan yang sudah kita ketahui sejak halaman dibuka.
      role: membership.role,
      products: produk,
      avatars: AVATAR_PRESETS.map((a) => ({ id: a.id, name: a.name, note: a.note, img: a.img, gender: a.gender })),
      scenarios: CAMPAIGN_TEMPLATES
        // Template bukti tidak ditawarkan sama sekali di matriks: menampilkannya
        // lalu menolaknya saat submit cuma memindahkan kekecewaan ke belakang.
        .filter((t) => !aiRenderBlockMessage(t.id))
        // Format dan durasi ikut dikirim karena keduanya MILIK skenario, dan
        // pengguna berhak melihat apa yang sebenarnya akan dirender sebelum
        // membayar — bukan menemukan skenario TVC-nya keluar sebagai
        // hands-only setelah 24 video jadi.
        .map((t) => ({ id: t.id, name: t.name, when: t.when, format: t.format, duration_sec: t.durationSec, ratio: t.ratio ?? null })),
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
