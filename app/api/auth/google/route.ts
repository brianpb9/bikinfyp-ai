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
export async function GET(req: Request) {
  try {
    if (!config.googleOauthClientId) throw ERR.BAD_REQUEST("Login Google belum dikonfigurasi.", "Google OAuth not configured.");
    if (!config.appBaseUrl) throw ERR.BAD_REQUEST("APP_BASE_URL belum diisi.", "APP_BASE_URL not configured.");

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
