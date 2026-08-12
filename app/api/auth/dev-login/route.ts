import { findOrCreateUserByPhone, issueToken, cookieName, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { assertDevRoute } from "@/lib/dev-gate";
import { postgresRuntimeEnabled, smokeFindOrCreateUser } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dev login via nomor HP — TANPA OTP sungguhan (stub untuk MVP/dev).
// Dev login TANPA OTP — hanya non-production / ALLOW_DEV_LOGIN=1. Produksi: /api/auth/request-otp.
export async function POST(req: Request) {
  try {
    assertDevRoute();
    const body = await req.json().catch(() => ({}));
    const phone = String(body.phone ?? "").trim();
    if (!/^\+?\d{9,15}$/.test(phone)) {
      throw ERR.BAD_REQUEST(
        "Nomor HP-nya belum bener formatnya. Contoh: 08123456789.",
        "Invalid phone number format."
      );
    }
    const user = postgresRuntimeEnabled() ? await smokeFindOrCreateUser(phone) : findOrCreateUserByPhone(phone);
    const token = await issueToken(user.id, user.phone ?? user.email ?? "");
    return new Response(JSON.stringify({ user: { id: user.id, phone: user.phone, tier: user.tier } }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": `${cookieName()}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
