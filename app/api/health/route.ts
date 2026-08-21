import pg from "pg";
import { config, paymentsEnv, paymentsLive, paymentsProvider } from "@/lib/config";
import { assertQueueConfiguration } from "@/lib/job-queue";
import { invarianUangBelumTerpasang, jobIntakeMode } from "@/lib/job-intake";
import { pendingMigrations } from "@/lib/migrasi-status";
import { periksaKapabilitasKlasifikasi } from "@/lib/media/kapabilitas-klasifikasi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    assertQueueConfiguration();
    if (process.env.NODE_ENV === "production" && config.dbRuntime !== "postgres") {
      throw new Error("Production wajib RACUN_DB_RUNTIME=postgres.");
    }
    if (process.env.NODE_ENV === "production" && config.storageMode !== "r2") {
      throw new Error("Production wajib STORAGE_MODE=r2.");
    }
    if (process.env.RACUN_DEPLOY_ENV === "production" && config.allowDevLogin) {
      throw new Error("ALLOW_DEV_LOGIN wajib 0 pada deployment production.");
    }
    const pending = await pendingMigrations().catch(() => []);
    // r13 (review produk 2026-08-07): halaman landing publik (anonim, sebelum
    // login) mengklaim "Checkout aman lewat GoPay/OVO/DANA/QRIS" TANPA SYARAT
    // walau Duitku belum dipasang — publik, non-rahasia, aman diekspos di sini.
    // KONTRAK PEMBAYARAN (koreksi Brian 20 Agu). Tiga field, bukan satu boolean:
    // provider mana, lingkungan apa, dan apakah benar-benar hidup. Sebelumnya
    // health menjawab payments_live: true hanya karena kunci SANDBOX terpasang,
    // jadi landing mengiklankan "checkout aman" dan tombol beli terbuka
    // sementara merchant Duitku masih menunggu approval.
    const paymentsHidup = paymentsLive();
    // APP_BASE_URL WAJIB HTTPS di produksi.
    //
    // Bukan formalitas: flag Secure pada cookie sesi diturunkan dari URL ini
    // (lib/cookies.ts). Kalau ia bukan https, cookie berangkat TANPA Secure
    // dan tidak ada yang mengeluh — token sesi boleh dikirim lewat HTTP polos
    // sementara semua tes lokal tetap hijau.
    if (process.env.RACUN_DEPLOY_ENV === "production" && !config.appBaseUrl.startsWith("https://")) {
      throw new Error("Production wajib APP_BASE_URL https:// — cookie Secure diturunkan darinya.");
    }

    // Invarian uang belum terpasang = intake ditutup, bukan sekadar dicatat.
    //
    // Sebelumnya health tetap 200 dan intake tetap "open" walau migrasi
    // finansial masih pending, jadi produksi terus menerima job berbayar di
    // atas database yang belum punya jaringnya. Situsnya sendiri TIDAK
    // dimatikan (503 akan menutup semua orang, termasuk yang cuma mau melihat
    // video lamanya) — yang ditutup hanya pintu masuk pekerjaan baru.
    const uangPending = invarianUangBelumTerpasang(pending);
    const intake = uangPending.length > 0 ? "closed" : jobIntakeMode();

    // KAPABILITAS KLASIFIKASI — bukti deployment, bukan asumsi.
    //
    // Seluruh jalur unggah foto produk berjalan di service INI, sementara
    // ffmpeg/ffprobe/tesseract hanya dijamin oleh Dockerfile.worker; blueprint
    // Render memakai `runtime: node` untuk web. Tanpa laporan ini, tidak ada
    // cara membuktikan runtime produksi bisa menerbitkan bukti yang berupa
    // VONIS — dan setiap klaim product-truth hijau jadi klaim dari mesin
    // pengembang, yang kebetulan punya ketiga binernya.
    //
    // TIDAK mengubah status HTTP. Runtime yang tidak mampu bukan runtime yang
    // rusak: unggahan tetap diterima, buktinya cuma berstatus belum_diperiksa
    // dan menunggu revalidasi. Menutup situs karena OCR tidak ada akan
    // mengunci semua orang, termasuk yang cuma mau melihat video lamanya.
    // Hasilnya di-cache per proses, jadi health check platform yang beruntun
    // tidak menelurkan proses baru.
    const klasifikasi = await periksaKapabilitasKlasifikasi();

    return Response.json(
      {
        ok: true,
        intake,
        payments_provider: paymentsProvider(),
        payments_env: paymentsEnv(),
        payments_live: paymentsHidup,
        // SHA build supaya commit yang benar-benar hidup bisa DIBUKTIKAN, bukan
        // disimpulkan dari "sudah dipush dan build hijau".
        build_sha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
        klasifikasi,
        ...(pending.length > 0 ? { migrations_pending: pending } : {}),
        ...(uangPending.length > 0 ? { intake_closed_reason: "migrasi invarian uang belum terpasang", blocking_migrations: uangPending } : {}),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[health] configuration failure", error);
    return Response.json({ ok: false, code: "HEALTH_CONFIGURATION_FAILED" }, { status: 503 });
  }
}
