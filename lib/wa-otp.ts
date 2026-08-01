// DEPRECATED 31 Jul 2026 — jalur OTP WhatsApp diganti penuh ke email (Resend).
// File disimpan sebagai referensi saja; TIDAK dipakai route mana pun.

// Pengirim OTP via WhatsApp — provider dipilih env WA_OTP_PROVIDER.
// Fonnte: POST https://api.fonnte.com/send, header Authorization: <FONNTE_API_KEY>,
//   body {target, message, countryCode:"62"} (docs: https://docs.fonnte.com/api-send-message/)
// Watzap: POST https://api.watzap.id/v1/send_message,
//   body {api_key, number_key, phone_no, message} (docs: https://docs.watzap.id)
// KEY KOSONG -> mode mock: kode ditulis ke log server dengan prefix [otp-mock].
// Di production tanpa key -> error jelas, kode TIDAK pernah dibocorkan di respons.

import { config } from "./config";

export function otpMessage(code: string): string {
  return (
    `BikinFYP.AI\nKode login kamu: *${code}*\n\n` +
    `Berlaku 5 menit. Jangan kasih ke siapa-siapa ya, termasuk yang ngaku tim BikinFYP.AI.`
  );
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** true bila provider yang dipilih punya key terisi. */
export function hasWaKey(): boolean {
  return config.waOtpProvider === "watzap"
    ? config.watzapApiKey !== "" && config.watzapNumberKey !== ""
    : config.fonnteApiKey !== "";
}

export async function sendOtpWhatsApp(phone: string, code: string): Promise<{ mode: "live" | "mock" }> {
  if (!hasWaKey()) {
    if (isProduction()) {
      throw new Error(
        `Provider OTP WhatsApp (${config.waOtpProvider}) belum dikonfigurasi — isi API key di server.`
      );
    }
    // Mode mock: kode ke log server saja (dev/test tanpa key)
    console.log(`[otp-mock] KODE OTP untuk ${phone}: ${code}`);
    return { mode: "mock" };
  }

  const message = otpMessage(code);
  if (config.waOtpProvider === "watzap") {
    const res = await fetch("https://api.watzap.id/v1/send_message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: config.watzapApiKey,
        number_key: config.watzapNumberKey,
        phone_no: phone,
        message,
      }),
    });
    if (!res.ok) throw new Error(`watzap: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  } else {
    const res = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: { authorization: config.fonnteApiKey, "content-type": "application/json" },
      body: JSON.stringify({ target: phone, message, countryCode: "62" }),
    });
    if (!res.ok) throw new Error(`fonnte: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { mode: "live" };
}
