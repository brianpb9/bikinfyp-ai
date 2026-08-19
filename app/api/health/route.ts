import pg from "pg";
import { config } from "@/lib/config";
import { assertQueueConfiguration } from "@/lib/job-queue";
import { invarianUangBelumTerpasang, jobIntakeMode } from "@/lib/job-intake";
import { pendingMigrations } from "@/lib/migrasi-status";

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
    // walau Midtrans belum dipasang — publik, non-rahasia, aman diekspos di sini.
    const paymentsLive =
      config.paymentGateway === "duitku"
        ? Boolean(config.duitkuMerchantCode && config.duitkuApiKey)
        : Boolean(config.midtransServerKey && config.midtransClientKey);
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

    return Response.json(
      {
        ok: true,
        intake,
        payments_live: paymentsLive,
        // SHA build supaya commit yang benar-benar hidup bisa DIBUKTIKAN, bukan
        // disimpulkan dari "sudah dipush dan build hijau".
        build_sha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? null,
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
