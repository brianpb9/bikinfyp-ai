import { ERR, errorResponse } from "@/lib/errors";
import { creditTopup, getBalance, TOPUP_PACKAGES } from "@/lib/credits";
import { getDb, type UserRow } from "@/lib/db";
import { assertDevRoute } from "@/lib/dev-gate";
import { pgCreditTopup, pgFindUser, pgGetBalance, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/payment — STUB webhook gateway. Idempoten via gateway_ref (BR-10.3):
// webhook yang sama dikirim berkali-kali -> saldo hanya bertambah sekali.
// Body: {gateway_ref, phone|user_id, package_id, status}
export async function POST(req: Request) {
  try {
    // Stub tanpa verifikasi — WAJIB mati di production (jalur kredit nyata: /api/webhooks/midtrans).
    assertDevRoute();
    const body = await req.json().catch(() => ({}));
    const gatewayRef = String(body.gateway_ref ?? "").trim();
    const packageId = String(body.package_id ?? "");
    const status = String(body.status ?? "paid");
    if (!gatewayRef) throw ERR.BAD_REQUEST("gateway_ref wajib.", "gateway_ref is required.");
    if (!TOPUP_PACKAGES.find((p) => p.id === packageId))
      throw ERR.BAD_REQUEST("Paket tidak dikenal.", "Unknown package.");
    if (status !== "paid") {
      return Response.json({ ok: true, ignored: true, reason: "status bukan paid" });
    }

    const db = postgresRuntimeEnabled() ? null : getDb();
    const user = postgresRuntimeEnabled()
      ? await pgFindUser(body.user_id ? { id: String(body.user_id) } : { phone: String(body.phone ?? "") })
      : (body.user_id ? db!.prepare("SELECT * FROM users WHERE id = ?").get(String(body.user_id)) : db!.prepare("SELECT * FROM users WHERE phone = ?").get(String(body.phone ?? ""))) as UserRow | undefined;
    if (!user) throw ERR.NOT_FOUND("User-nya");

    const result = postgresRuntimeEnabled() ? await pgCreditTopup({
      userId: user.id,
      packageId,
      gateway: "stub",
      gatewayRef,
      rawPayload: body,
    }) : creditTopup({ userId: user.id, packageId, gateway: "stub", gatewayRef, rawPayload: body });
    return Response.json({
      ok: true,
      duplicated: result.duplicated,
      balance: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
