import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { mediaStorage } from "@/lib/storage";
import { probeDurationSec, probeHasAudioStream, probeHasVideoStream } from "@/lib/media/ffmpeg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024; // 100MB — prototype cap
const MAX_DURATION_SEC = 60;
const ALLOWED_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

// POST /api/promo/upload — Video Promosi (non-ecommerce) prototype. Upload
// klip mentah user (bukan foto produk) — endpoint terpisah dari
// /api/products, tidak menyentuh pipeline e-commerce.
export async function POST(req: Request) {
  let tmpPath: string | null = null;
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
    const dir = path.join(config.storageDir, "promo_uploads", jobId);
    fs.mkdirSync(dir, { recursive: true });
    tmpPath = path.join(dir, "raw" + (path.extname(file.name) || ".mp4"));
    fs.writeFileSync(tmpPath, buf);

    if (!(await probeHasVideoStream(tmpPath))) throw ERR.BAD_REQUEST("File bukan video yang valid.", "Not a valid video file.");
    if (!(await probeHasAudioStream(tmpPath)))
      throw ERR.BAD_REQUEST("Video belum ada suaranya — prototype ini butuh klip yang ada audio (talking-head).", "Uploaded clip has no audio track.");
    const durationSec = await probeDurationSec(tmpPath);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw ERR.BAD_REQUEST("Durasi video tidak terbaca.", "Could not read video duration.");
    if (durationSec > MAX_DURATION_SEC) throw ERR.BAD_REQUEST(`Video maksimal ${MAX_DURATION_SEC} detik untuk prototype ini.`, "Video exceeds max duration.");

    const rel = `promo_uploads/${jobId}/clip.mp4`;
    await mediaStorage().put(rel, fs.readFileSync(tmpPath), "video/mp4");
    fs.rmSync(dir, { recursive: true, force: true });
    tmpPath = null;

    return Response.json({ uploaded_clip_url: rel, duration_sec: durationSec });
  } catch (err) {
    return errorResponse(err);
  } finally {
    if (tmpPath) fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true });
  }
}
