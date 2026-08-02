import crypto from "node:crypto";
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { mediaStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024; // 100MB — prototype cap
const ALLOWED_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

// POST /api/promo/upload — Video Promosi (non-ecommerce) prototype. Upload
// klip mentah user (bukan foto produk) — endpoint terpisah dari
// /api/products, tidak menyentuh pipeline e-commerce.
//
// No ffprobe here deliberately: the web service is plain Node with no
// ffmpeg/ffprobe binaries (only the Docker worker service has them). This
// route only checks MIME/size; real video validation (has video stream, has
// audio, duration cap) happens in lib/promo/worker.ts inside the worker
// container, and a bad upload surfaces as a FAILED job with a clear reason.
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const form = await req.formData();
    const file = form.get("clip");
    if (!(file instanceof File)) throw ERR.BAD_REQUEST("Klip video belum diupload.", "Video clip is required.");
    if (!ALLOWED_MIME.has(file.type)) throw ERR.BAD_REQUEST("Format video harus mp4/mov/webm.", "Unsupported video format.");
    if (file.size > MAX_BYTES) throw ERR.BAD_REQUEST("Ukuran video maksimal 100MB.", "Video exceeds max size.");

    const buf = Buffer.from(await file.arrayBuffer());
    const jobId = crypto.randomUUID();
    const rel = `promo_uploads/${jobId}/clip.mp4`;
    await mediaStorage().put(rel, buf, "video/mp4");

    return Response.json({ uploaded_clip_url: rel, size_bytes: buf.length });
  } catch (err) {
    return errorResponse(err);
  }
}
