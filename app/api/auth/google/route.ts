import crypto from "node:crypto";
import { config } from "@/lib/config";
import { ERR, errorResponse } from "@/lib/errors";
import { GOOGLE_NEXT_COOKIE, GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { cookieState } from "@/lib/cookies";
import { tujuanAman } from "@/lib/tujuan-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/google — mulai login Google, redirect ke consent screen.
// Alternatif email OTP yang sudah ada, bukan pengganti (keputusan Brian
// 2026-08-03: dua-duanya tetap ada).
/** Antar balik ke halaman masuk dengan pesan yang bisa dibaca. */
function kembaliDenganGalat(alasan: string): Response {
  const url = new URL("/onboarding", config.appBaseUrl || "http://localhost:3210");
  url.searchParams.set("google_error", alasan);
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

export async function GET(req: Request) {
  try {
    // INI NAVIGASI BROWSER, BUKAN PANGGILAN API.
    //
    // Sebelumnya kedua penjagaan di bawah melempar BAD_REQUEST, dan pengguna
    // yang menekan "Masuk pakai Google" melihat JSON mentah di layar. Callback
    // di sebelah sudah lama memakai pola yang benar — mengantar balik ke
    // halaman masuk dengan pesan — dan jalur berangkatnya tertinggal.
    if (!config.googleOauthClientId || !config.googleOauthClientSecret) return kembaliDenganGalat("not_configured");
    if (!config.appBaseUrl) return kembaliDenganGalat("not_configured");

    const state = crypto.randomBytes(24).toString("base64url");
    const redirectUri = `${config.appBaseUrl}/api/auth/google/callback`;
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", config.googleOauthClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");

    // TUJUAN dititipkan di cookie, bukan di parameter state.
    //
    // state dipakai untuk anti-CSRF dan dibandingkan apa adanya; menempelkan
    // data lain ke dalamnya membuat perbandingan itu lebih longgar. Cookie
    // terpisah dengan umur yang sama menjaga dua urusan tetap dua urusan.
    const next = tujuanAman(new URL(req.url).searchParams.get("next"));

    const headers = new Headers({ location: authUrl.toString() });
    headers.append("set-cookie", cookieState(GOOGLE_OAUTH_STATE_COOKIE, state, 600));
    // Di-ENCODE saat ditulis: nilai path bisa memuat karakter yang berarti
    // lain di header cookie (;, koma, spasi). Callback men-decode-nya lagi —
    // pasangan encode/decode yang eksplisit, bukan berharap path selalu polos.
    if (next) headers.append("set-cookie", cookieState(GOOGLE_NEXT_COOKIE, encodeURIComponent(next), 600));
    return new Response(null, { status: 302, headers });

  } catch (err) {
    return errorResponse(err);
  }
}
