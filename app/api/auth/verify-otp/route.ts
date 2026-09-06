import { errorResponse } from "@/lib/errors";
import { verifyOtp } from "@/lib/otp";
import { findOrCreateUserByEmail, issueToken, cookieName, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { audit } from "@/lib/db";
import { pgAudit, pgVerifyOtp, postgresRuntimeEnabled, smokeFindOrCreateUser } from "@/lib/postgres/smoke-runtime";
import { cookieSesi } from "@/lib/cookies";
import { dariBrand } from "@/lib/asal-brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/verify-otp {email, code} — cocokkan hash, expiry, maks 5 attempts.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const code = String(body.code ?? "").trim();
    if (!email || !/^\d{6}$/.test(code)) {
      return Response.json(
        { code: "BAD_REQUEST", message_id: "Email dan kode 6 digit-nya diisi dulu ya.", message_en: "Email and 6-digit code required.", retryable: false },
        { status: 400 }
      );
    }

    const result = postgresRuntimeEnabled() ? await pgVerifyOtp(email, code) : verifyOtp(email, code);
    if (!result.ok) {
      const messages: Record<string, string> = {
        wrong_code: `Kodenya belum tepat. Sisa ${result.attemptsLeft} percobaan lagi ya.`,
        expired: "Kodenya udah kedaluwarsa. Minta kode baru ya.",
        too_many_attempts: "Terlalu banyak salah tebak. Minta kode baru ya.",
        no_code: "Belum ada kode untuk email ini. Minta kode dulu ya.",
      };
      return Response.json(
        {
          code: result.reason === "too_many_attempts" ? "OTP_LOCKED" : "OTP_INVALID",
          message_id: messages[result.reason],
          message_en: `OTP verification failed: ${result.reason}`,
          retryable: result.reason === "wrong_code",
          attempts_left: result.attemptsLeft,
        },
        { status: result.reason === "wrong_code" ? 401 : 410 }
      );
    }

    // AKUN BRAND MULAI DENGAN SALDO NOL.
    //
    // Bonus pendaftar diberikan di transaksi pembuatan akun, yang dipakai
    // BERSAMA oleh retail dan brand. Ditemukan 6 Sep 2026 saat menjalankan
    // pendaftaran brand dari ujung ke ujung: rute /api/brands/daftar memang
    // tidak menulis ledger, tapi akunnya sudah lahir dengan saldo 1.
    const brand = dariBrand(req);
    const user = postgresRuntimeEnabled() ? await (async () => {
      const { PgAuthOtpAuditRepository } = await import("@/lib/postgres/auth-otp-audit");
      const { config } = await import("@/lib/config");
      const repo = new PgAuthOtpAuditRepository(config.databaseUrl, { authSecret: config.authSecret, otpExpiryMin: config.otpExpiryMin, otpMaxAttempts: config.otpMaxAttempts, otpRateLimitPer15Min: config.otpRateLimitPer15Min });
      // tanpaBonus untuk jalur brand: akun brand mulai dengan saldo NOL.
      try { return await repo.findOrCreateUserByEmail(email, { tanpaBonus: brand }); } finally { await repo.close(); }
    })() : findOrCreateUserByEmail(email);
    if (postgresRuntimeEnabled()) await pgAudit(user.id, "auth.otp_verified", "users", user.id, {});
    else audit(user.id, "auth.otp_verified", "users", user.id, {});
    const token = await issueToken(user.id, user.email ?? "");
    return new Response(
      JSON.stringify({ ok: true, user: { id: user.id, email: user.email, tier: user.tier } }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": cookieSesi(cookieName(), token, SESSION_MAX_AGE_SEC),
        },
      }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
