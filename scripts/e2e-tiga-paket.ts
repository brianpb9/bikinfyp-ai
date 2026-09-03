/**
 * E2E TIGA PAKET — naskah, gerbang viral, jatah kredit, antrean, render, QC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * APA YANG BENAR-BENAR DIJALANKAN
 * ─────────────────────────────────────────────────────────────────────────────
 * Dipakai FUNGSI DOMAIN YANG SAMA dengan yang dipanggil rute produksi:
 *
 *   generateScripts + lewatiGerbangViral  <- persis seperti /api/scripts/generate
 *   smokeCreateScripts + smokeApproveScript
 *   smokeCreateJob                        <- memotong jatah kredit di dalam
 *                                            transaksi yang sama (smoke-runtime)
 *   enqueueJob                            <- worker produksi yang merender
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * YANG TIDAK DIJALANKAN, DAN KENAPA
 * ─────────────────────────────────────────────────────────────────────────────
 * Pembungkus HTTP-nya: getAuthUser, rate limit, dan parsing body. Menjalankan
 * itu menuntut sesi milik akun pengguna, dan satu-satunya cara mendapatkannya
 * tanpa kotak masuk pemiliknya adalah MENEMPA token — memalsukan autentikasi,
 * yang tidak saya lakukan sekalipun untuk uji. Lapis itu tipis dan sudah
 * ditutup tes unit; yang di bawahnya justru yang menghabiskan uang.
 *
 * Jalankan di dalam kontainer:
 *   E2E_CONFIRM=YA npx tsx scripts/e2e-tiga-paket.ts <email> <product-id>
 */
import { generateScripts } from "../lib/script-engine";
import { lewatiGerbangViral, AMBANG_VIRAL } from "../lib/script-engine/gerbang-viral";
import { amplopValidasi } from "../lib/script-engine/admisi";
import { cobaDenganNamaPendek } from "../lib/script-engine/jaring-nama";
import {
  smokeApproveScript, smokeCreateJob, smokeCreateScripts, smokeGetProduct,
} from "../lib/postgres/smoke-runtime";
import { enqueueJob } from "../lib/job-queue";
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { tierPriceIdr } from "../lib/credits";
import { jenisUntukTier } from "../lib/kredit-video";
import { config } from "../lib/config";
import type { QualityTier } from "../lib/providers/types";
import type { FypQualityTier } from "../lib/fyp-score";

if (process.env.E2E_CONFIRM !== "YA") {
  console.error("Ditolak: ini MEMBAYAR render sungguhan dan memotong jatah kredit. Ulangi dengan E2E_CONFIRM=YA.");
  process.exit(1);
}
const email = (process.argv[2] ?? "").toLowerCase();
const productId = process.argv[3] ?? "";
if (!email || !productId) throw new Error("Pakai: e2e-tiga-paket.ts <email> <product-id>");

// Paket bisa dipilih lewat argumen ke-3 supaya ulangan tidak membayar ulang
// tier yang SUDAH terbukti. Premium sudah READY pada jalan sebelumnya.
const PAKET: QualityTier[] = (process.argv[4] ?? "standard,premium,ultra")
  .split(",").map((x) => x.trim()).filter(Boolean) as QualityTier[];
const DURASI = 15;
const FORMAT = "talking_head";

const pool = getPool(config.databaseUrl);
const ringkas: Record<string, unknown>[] = [];

try {
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = $1", [email],
  );
  if (!rows[0]) throw new Error(`tidak ada akun ${email}`);
  const userId = rows[0].id;
  const product = await smokeGetProduct(userId, productId);
  if (!product) throw new Error(`produk ${productId} bukan milik ${email}`);
  console.log(`akun   : ${email}\nproduk : ${product.name}\n`);

  for (const tier of PAKET) {
    const baris: Record<string, unknown> = { paket: tier };
    try {
      // 1. NASKAH + GERBANG VIRAL — susunan yang sama dengan rute.
      const jalan = (nama: string) => generateScripts({
        product: {
          id: product.id, name: nama, price_idr: product.price_idr,
          category: product.category, sourceUrl: product.source_url,
        },
        register: "netral", emotion: "senang", qualityTier: tier,
        durationSec: DURASI, hookLevel: "normal",
      } as never);

      const gerbang = await lewatiGerbangViral(
        async () => (await cobaDenganNamaPendek(jalan, product.name)).variants,
        {
          qualityTier: tier as FypQualityTier, durationSec: DURASI,
          format: FORMAT, productName: product.name, priceIdr: product.price_idr ?? 0,
        },
        {
          catat: (m) => console.log(`  [gerbang-viral ${tier}] ${m}`),
          layak: (v) => (v as { validation: { passed: boolean } }).validation.passed,
        },
      );
      const sah = gerbang.terpilih
        .filter((d) => (d.varian as { validation: { passed: boolean } }).validation.passed);
      if (!sah.length) throw new Error("tidak ada naskah yang lolos validator");
      const v = sah[0].varian as never as {
        hook_family: string; emotion: string; register: string; segments: unknown[];
        caption: string; hashtags: string[]; validation: unknown; script_source: string; admisi: unknown;
      };
      baris.skor_viral = sah[0].skor;
      baris.percobaan_naskah = gerbang.percobaan;
      baris.lolos_ambang = gerbang.lolosAmbang;

      // 2. SIMPAN + SETUJUI (gerbang HITL menuntut approved_by_user_at).
      const amplop = amplopValidasi(v.validation as never, {
        script_source: v.script_source as never, admisi: v.admisi as never,
      });
      const dibuat = await smokeCreateScripts(userId, product.id, [{
        hookFamily: v.hook_family, emotion: v.emotion, register: v.register,
        segments: v.segments, caption: v.caption, hashtags: v.hashtags,
        validationResult: amplop, qualityTier: tier, hookLevel: "normal",
      }] as never);
      const scriptId = dibuat[0].id;
      await smokeApproveScript(userId, scriptId, {
        segments: v.segments, edited: false, validationResult: amplop,
      });
      baris.script_id = scriptId;

      // 3. JOB — jatah kredit dipotong di dalam transaksi ini.
      const jenis = jenisUntukTier(tier);
      const job = await smokeCreateJob(userId, {
        productId: product.id, scriptId, format: FORMAT, qualityTier: tier,
        durationS: DURASI, priceIdr: tierPriceIdr(tier, DURASI), jenisVideo: jenis,
      } as never);
      baris.job_id = job.jobId;
      baris.jenis_kredit = jenis;
      await enqueueJob(job.jobId);
      console.log(`  ${tier}: job ${job.jobId} masuk antrean (skor viral ${sah[0].skor}, ${gerbang.percobaan}x tulis)`);
      baris.status = "ANTRE";
    } catch (err) {
      baris.status = "GAGAL";
      baris.error = err instanceof Error ? err.message : String(err);
      console.log(`  ${tier}: GAGAL — ${baris.error}`);
    }
    ringkas.push(baris);
  }

  console.log(`\nambang viral = ${AMBANG_VIRAL}\n${JSON.stringify(ringkas, null, 2)}`);
  console.log("\nJob sudah di antrean. Pantau dengan query jobs (state, cost_actual_idr, qc_json).");
} finally {
  await closeAllPools();
}
