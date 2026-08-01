import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getBalance, getLedger } from "@/lib/credits";
import { pgGetBalance, pgGetLedger, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/credits — saldo (agregat ledger) + riwayat ledger.
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    return Response.json({ balance: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id), ledger: postgresRuntimeEnabled() ? await pgGetLedger(user.id) : getLedger(user.id) });
  } catch (err) {
    return errorResponse(err);
  }
}
