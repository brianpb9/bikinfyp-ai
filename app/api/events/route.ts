import { getAuthUser } from "@/lib/auth";
import { getDb, now, uuid } from "@/lib/db";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { allowRate } from "@/lib/rate-limit";
import crypto from "node:crypto";
import { cookieAnon } from "@/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events {name, meta?} — event funnel client-side, TANPA auth (funnel
// dimulai sebelum login: landing, /coba). Kebijakan:
// - nama event whitelist keras (bukan analytics bebas),
// - anon_id = cookie acak first-party (bukan fingerprint, bukan ad-id),
// - meta dibatasi 500 char, fire-and-forget (selalu 204, tidak pernah memblokir UI),
// - rate limit per IP via lib/rate-limit (Redis-backed di production).
const EVENT_NAMES = new Set([
  "landing_view",
  "quiz_view",
  "quiz_product",
  "quiz_objection",
  "quiz_done",
  "try_view",
  "try_generated",
  "try_signup_click",
  "signup_success",
  "gaya_view",
  "approve_click",
  "proses_ready",
  "download_click",
  "report_saved",
]);

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!(await allowRate("events", ip, 120, 15 * 60))) return new Response(null, { status: 204 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "");
    if (!EVENT_NAMES.has(name)) return new Response(null, { status: 204 });
    const meta = body.meta ? JSON.stringify(body.meta).slice(0, 500) : null;

    const user = await getAuthUser(req).catch(() => null);
    const cookies = req.headers.get("cookie") ?? "";
    let anonId = /(?:^|;\s*)racun_anon=([a-f0-9]{16,32})/.exec(cookies)?.[1] ?? null;
    const headers = new Headers();
    if (!anonId && !user) {
      anonId = crypto.randomBytes(12).toString("hex");
      headers.set("Set-Cookie", cookieAnon("racun_anon", anonId, 31536000));
    }

    // Event drop diam-diam bila runtime pg belum termigrasi — telemetry tidak
    // boleh pernah mengganggu jalur produk.
    if (!postgresRuntimeEnabled()) {
      getDb()
        .prepare("INSERT INTO events (id, user_id, anon_id, name, meta, created_at) VALUES (?,?,?,?,?,?)")
        .run(uuid(), user?.id ?? null, anonId, name, meta, now());
    }
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 204 });
  }
}
