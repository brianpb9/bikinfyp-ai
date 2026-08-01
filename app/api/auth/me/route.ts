import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { getBalance } from "@/lib/credits";
import { pgGetBalance, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    return Response.json({
      user: { id: user.id, phone: user.phone, name: user.name, tier: user.tier },
      credits: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
