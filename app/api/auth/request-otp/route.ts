import { errorResponse } from "@/lib/errors";
import { canRequestOtp, generateCode, storeOtp, isValidEmail } from "@/lib/otp";
import { sendOtpEmail, hasEmailKey, isProduction } from "@/lib/email-otp";
import { pgCanRequestOtp, pgStoreOtp, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/request-otp {email} — kirim kode 6 digit via EMAIL (Resend).
// Rate limit: maks 3 kirim/email/15 menit.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      return Response.json(
        { code: "BAD_REQUEST", message_id: "Emailnya belum bener formatnya. Contoh: nama@email.com.", message_en: "Invalid email.", retryable: false },
        { status: 400 }
      );
    }
    if (postgresRuntimeEnabled() ? !(await pgCanRequestOtp(email)) : !canRequestOtp(email)) {
      return Response.json(
        {
          code: "OTP_RATE_LIMITED",
          message_id: "Kamu udah minta kode 3 kali dalam 15 menit. Tunggu sebentar ya, terus coba lagi.",
          message_en: "Too many OTP requests for this email.",
          retryable: true,
        },
        { status: 429 }
      );
    }

    const code = generateCode();
    const { mode } = await sendOtpEmail(email, code);
    if (postgresRuntimeEnabled()) await pgStoreOtp(email, code); else storeOtp(email, code);

    return Response.json({
      ok: true,
      mode,
      expires_in_sec: 300,
      ...(mode === "mock" && !isProduction() ? { dev_hint: "Mode demo: kode OTP bisa dicek di log server ([otp-mock])." } : {}),
      ...(mode === "live" ? { message: "Kode OTP sudah dikirim ke email kamu." } : {}),
      email_live: hasEmailKey(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
