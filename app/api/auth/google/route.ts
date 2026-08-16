import crypto from "node:crypto";
import { config } from "@/lib/config";
import { ERR, errorResponse } from "@/lib/errors";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { cookieState } from "@/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/google — mulai login Google, redirect ke consent screen.
// Alternatif email OTP yang sudah ada, bukan pengganti (keputusan Brian
// 2026-08-03: dua-duanya tetap ada).
export async function GET() {
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

    return new Response(null, {
      status: 302,
      headers: {
        location: authUrl.toString(),
        // 10 min TTL — just long enough for the user to complete the Google
        // consent screen. SameSite=Lax so it still rides along on the
        // top-level redirect back from accounts.google.com.
        "set-cookie": cookieState(GOOGLE_OAUTH_STATE_COOKIE, state, 600),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
