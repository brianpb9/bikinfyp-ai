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
      // email ikut supaya menu akun bisa menampilkan identitas yang dipakai
      // login — data milik pengguna itu sendiri, bukan orang lain.
      user: { id: user.id, phone: user.phone, email: user.email, name: user.name, tier: user.tier },
      credits: postgresRuntimeEnabled() ? await pgGetBalance(user.id) : getBalance(user.id),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
