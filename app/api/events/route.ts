import { getAuthUser } from "@/lib/auth";
import { getDb, now, uuid } from "@/lib/db";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/events {name, meta?} — event funnel client-side, TANPA auth (funnel
// dimulai sebelum login: landing, /coba). Kebijakan:
// - nama event whitelist keras (bukan analytics bebas),
// - anon_id = cookie acak first-party (bukan fingerprint, bukan ad-id),
// - meta dibatasi 500 char, fire-and-forget (selalu 204, tidak pernah memblokir UI),
// - rate limit ringan per IP (in-memory — cukup untuk 1 instance web).
const EVENT_NAMES = new Set([
  "landing_view",
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

const bucket = new Map<string, { count: number; resetAt: number }>();
function allow(ip: string): boolean {
  const nowMs = Date.now();
  const b = bucket.get(ip);
  if (!b || b.resetAt < nowMs) {
    bucket.set(ip, { count: 1, resetAt: nowMs + 15 * 60 * 1000 });
    return true;
  }
  b.count++;
  return b.count <= 120;
}

export async function POST(req: Request) {
  try {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!allow(ip)) return new Response(null, { status: 204 });
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
      headers.set("Set-Cookie", `racun_anon=${anonId}; Path=/; Max-Age=31536000; SameSite=Lax`);
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
