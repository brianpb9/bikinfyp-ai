import { errorResponse } from "@/lib/errors";
import { canRequestOtp, generateCode, storeOtp, isValidEmail } from "@/lib/otp";
import { sendOtpEmail, hasEmailKey, isProduction } from "@/lib/email-otp";
import { pgCanRequestOtp, pgStoreOtp, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

import { pastikanSegar } from "@/lib/kredensial";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/request-otp {email} — kirim kode 6 digit via EMAIL (Resend).
// Rate limit: maks 3 kirim/email/15 menit.
export async function POST(req: Request) {
  try {
    // Kredensial bisa diganti dari dashboard tanpa restart; segarkan
    // sebelum dipakai. Ber-TTL, jadi paling sering satu query/30 detik.
    await pastikanSegar();
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

    // KEADAAN KONFIGURASI YANG DIKETAHUI, BUKAN GANGGUAN.
    //
    // Tanpa RESEND_API_KEY, sendOtpEmail() MELEMPAR dan errorResponse
    // mengubahnya jadi 500 "Ada gangguan di sisi kami. Coba lagi sebentar
    // lagi ya." — kalimat yang salah dua kali: ini bukan gangguan, dan
    // mencoba lagi tidak akan pernah berhasil. Pengguna disuruh menunggu
    // sesuatu yang tidak akan datang.
    //
    // hasEmailKey() sudah ada dan bahkan sudah dipakai di jawaban sukses di
    // bawah; ia cuma tidak pernah dipakai untuk MEMUTUSKAN. Pola jawabannya
    // mengikuti PAYMENT_NOT_CONFIGURED di rute checkout: 503, retryable
    // false, dan sebut jalan keluarnya.
    if (isProduction() && !hasEmailKey()) {
      return Response.json(
        {
          code: "EMAIL_LOGIN_NOT_CONFIGURED",
          message_id: "Login lewat email belum aktif di server ini. Hubungi tim kami ya.",
          message_en: "Email OTP is not configured on this server (RESEND_API_KEY missing).",
          retryable: false,
        },
        { status: 503 }
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
