import { config } from "@/lib/config";
import { mediaStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEMPORARY (2026-08-03): QC-06 investigation only. Serves files under the
 * debug/ storage prefix that lib/worker.ts / lib/postgres/worker.ts persist
 * there when QC_DEBUG_MODE=1 — the only way to actually see a composited
 * attempt, since the worker container's local disk isn't otherwise reachable.
 * Gated on the same flag (defaults off); delete this route together with the
 * qcDebugMode plumbing once the investigation is done.
 */
export async function GET(req: Request) {
  if (!config.qcDebugMode) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const relPath = url.searchParams.get("path") ?? "";
  if (!relPath.startsWith("debug/")) return new Response("Forbidden", { status: 403 });

  const object = await mediaStorage().get(relPath);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.body), {
    headers: { "content-type": "video/mp4" },
  });
}
