import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { creditTopup, getBalance, TOPUP_PACKAGES } from "@/lib/credits";
import { uuid } from "@/lib/db";
import { assertDevRoute } from "@/lib/dev-gate";
import { pgCreditTopup, pgGetBalance, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/credits/topup {package_id} — DEV ONLY (non-production/ALLOW_DEV_LOGIN=1).
// Produksi memakai /api/credits/checkout + webhook Midtrans terverifikasi.
export async function POST(req: Request) {
  try {
    assertDevRoute();
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const body = await req.json().catch(() => ({}));
    const packageId = String(body.package_id ?? "");
    if (!TOPUP_PACKAGES.find((p) => p.id === packageId))
      throw ERR.BAD_REQUEST("Paketnya nggak ketemu. Coba pilih paket lain ya.", "Unknown package.");

    const gatewayRef = `dev-topup-${uuid()}`;
    const result = postgresRuntimeEnabled() ? await pgCreditTopup({
      userId: user.id,
      packageId,
      gateway: "dev",
      gatewayRef,
      rawPayload: { dev: true },
    }) : creditTopup({
      userId: user.id, packageId, gateway: "dev", gatewayRef, rawPayload: { dev: true },
    });
    return Response.json({
      ok: true,
      package_id: packageId,
      amount_idr_added: result.amountIdr,
      balance: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
      gateway_ref: gatewayRef,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
