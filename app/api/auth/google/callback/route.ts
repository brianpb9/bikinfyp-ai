import { config } from "@/lib/config";
import { findOrCreateUserByEmail, issueToken, cookieName, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { audit } from "@/lib/db";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { GOOGLE_OAUTH_STATE_COOKIE } from "@/lib/google-oauth";
import { cookieSesi, cookieHapus } from "@/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Login gagal (state tidak cocok, dibatalkan user, dll) -> lempar balik ke
// halaman masuk dengan pesan, bukan JSON mentah — ini alur redirect browser.
function loginFailedRedirect(reason: string): Response {
  const url = new URL("/onboarding", config.appBaseUrl || "http://localhost:3210");
  url.searchParams.set("google_error", reason);
  return new Response(null, {
    status: 302,
    headers: { location: url.toString(), "set-cookie": cookieHapus(GOOGLE_OAUTH_STATE_COOKIE) },
  });
}

// GET /api/auth/google/callback — tukar authorization code, ambil email
// terverifikasi dari Google, lalu masuk lewat findOrCreateUserByEmail yang
// SAMA dengan alur OTP email (satu sistem user, dua cara login).
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (url.searchParams.get("error")) return loginFailedRedirect("cancelled");
    if (!code || !state) return loginFailedRedirect("missing_params");

    const expectedState = readCookie(req, GOOGLE_OAUTH_STATE_COOKIE);
    if (!expectedState || expectedState !== state) return loginFailedRedirect("state_mismatch");

    if (!config.googleOauthClientId || !config.googleOauthClientSecret) return loginFailedRedirect("not_configured");
    const redirectUri = `${config.appBaseUrl}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleOauthClientId,
        client_secret: config.googleOauthClientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return loginFailedRedirect("token_exchange_failed");
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) return loginFailedRedirect("token_exchange_failed");

    const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userinfoRes.ok) return loginFailedRedirect("userinfo_failed");
    const profile = (await userinfoRes.json()) as { email?: string; email_verified?: boolean };
    // Google's own verified flag — never trust an unverified email as a login identity.
    if (!profile.email || !profile.email_verified) return loginFailedRedirect("email_not_verified");
    const email = profile.email.toLowerCase().trim();

    const user = postgresRuntimeEnabled()
      ? await (async () => {
          const { PgAuthOtpAuditRepository } = await import("@/lib/postgres/auth-otp-audit");
          const repo = new PgAuthOtpAuditRepository(config.databaseUrl, {
            authSecret: config.authSecret,
            otpExpiryMin: config.otpExpiryMin,
            otpMaxAttempts: config.otpMaxAttempts,
            otpRateLimitPer15Min: config.otpRateLimitPer15Min,
          });
          try { return await repo.findOrCreateUserByEmail(email); } finally { await repo.close(); }
        })()
      : findOrCreateUserByEmail(email);

    if (postgresRuntimeEnabled()) await pgAudit(user.id, "auth.google_login", "users", user.id, {});
    else audit(user.id, "auth.google_login", "users", user.id, {});

    const token = await issueToken(user.id, user.email ?? "");
    const home = new URL("/", config.appBaseUrl || "http://localhost:3210");
    // Two separate Set-Cookie headers — comma-joining into one string (an
    // earlier draft of this route did that) is not spec-compliant and
    // browsers won't parse it as two cookies. Headers.append is the correct
    // way to emit multiple Set-Cookie lines on one Response.
    const headers = new Headers({ location: home.toString() });
    headers.append("set-cookie", cookieSesi(cookieName(), token, SESSION_MAX_AGE_SEC));
    headers.append("set-cookie", cookieHapus(GOOGLE_OAUTH_STATE_COOKIE));
    return new Response(null, { status: 302, headers });
  } catch {
    return loginFailedRedirect("unexpected_error");
  }
}
