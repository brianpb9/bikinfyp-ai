import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { HOOK_LIBRARY } from "@/lib/promo/hook-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/promo/hooks — list buat toggle "hook normal <-> crazy" di config
// screen. Prompt/negative TIDAK diekspos (isi kreatif, cukup dipakai server-
// side di worker) — hanya metadata yang perlu ditampilkan ke user.
export async function GET(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const hooks = HOOK_LIBRARY.map((h) => ({
      id: h.id,
      title: h.title,
      intensity: h.intensity,
      score: h.score,
      has_person: h.hasPerson,
    }));
    return Response.json({ hooks });
  } catch (err) {
    return errorResponse(err);
  }
}
