// Pengirim OTP via EMAIL — Resend API (https://resend.com/docs/api-reference/emails/send-email)
// POST https://api.resend.com/emails, header Authorization: Bearer RESEND_API_KEY,
// body {from, to, subject, html}. Untuk sandbox/testing: from = onboarding@resend.dev.
//
// KEY KOSONG -> mode mock: kode ditulis ke log server dengan prefix [otp-mock]
// (pola sama dengan mock WA lama). Di production tanpa key -> error jelas,
// kode TIDAK pernah dibocorkan di respons.

import { config } from "./config";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function hasEmailKey(): boolean {
  return config.resendApiKey !== "";
}

function otpHtml(code: string): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
    <h2 style="margin:0 0 8px">BikinFYP.AI</h2>
    <p>Kode masuk kamu:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:16px 0">${code}</p>
    <p style="color:#666">Berlaku 5 menit. Jangan kasih ke siapa-siapa ya, termasuk yang ngaku tim BikinFYP.AI.</p>
  </div>`;
}

export async function sendOtpEmail(email: string, code: string): Promise<{ mode: "live" | "mock" }> {
  if (!hasEmailKey()) {
    if (isProduction()) {
      throw new Error("RESEND_API_KEY belum diisi di server — OTP email belum aktif.");
    }
    console.log(`[otp-mock] KODE OTP untuk ${email}: ${code}`);
    return { mode: "mock" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.resendFromEmail,
      to: [email],
      subject: `Kode masuk BikinFYP.AI: ${code}`,
      html: otpHtml(code),
    }),
  });
  if (!res.ok) throw new Error(`resend: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { mode: "live" };
}
