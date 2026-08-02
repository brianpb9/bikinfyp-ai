import fs from "node:fs";
import path from "node:path";
import { runFf } from "@/lib/media/ffmpeg";
import { config } from "@/lib/config";
import { verifySignedUrl } from "@/lib/signed-url";
import { mediaStorage } from "@/lib/storage";
import { getAuthUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import pg from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
};

async function thumbnailFor(relPath: string): Promise<Buffer | null> {
  // Thumbnail hanya cache turunan dari file yang URL-nya sudah lolos HMAC.
  // Ukuran 128px cukup untuk kartu 64×96 dan menghindari unduh foto kamera asli.
  const key = Buffer.from(relPath).toString("base64url");
  const dir = path.join(config.storageDir, ".thumbs");
  const output = path.join(dir, `${key}.webp`);
  try {
    const source = await mediaStorage().materialize(relPath);
    if (!source) return null;
    await fs.promises.mkdir(dir, { recursive: true });
    if (!fs.existsSync(output)) {
      await runFf("python3", [
        "-c",
        "from PIL import Image, ImageOps; import sys; im=ImageOps.exif_transpose(Image.open(sys.argv[1])); im.thumbnail((128, 128)); im.save(sys.argv[2], 'WEBP', quality=78, method=4)",
        source,
        output,
      ]);
    }
    return fs.readFileSync(output);
  } catch {
    return null;
  }
}

/** A valid HMAC link is a bearer capability, never proof of account ownership. */
async function fileBelongsToUser(relPath: string, userId: string): Promise<boolean> {
  if (postgresRuntimeEnabled()) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    try {
      const result = await pool.query(`
        SELECT 1 FROM outputs o JOIN jobs j ON j.id=o.job_id
          WHERE o.video_url=$1 AND j.user_id=$2
        UNION ALL
        SELECT 1 FROM products p CROSS JOIN LATERAL jsonb_array_elements_text(p.images::jsonb) image(path)
          WHERE p.user_id=$2 AND image.path=$1
        LIMIT 1`, [relPath, userId]);
      return Boolean(result.rowCount);
    } finally { await pool.end(); }
  }
  const db = getDb();
  const output = db.prepare("SELECT 1 FROM outputs o JOIN jobs j ON j.id=o.job_id WHERE o.video_url=? AND j.user_id=? LIMIT 1").get(relPath, userId);
  if (output) return true;
  const products = db.prepare("SELECT images FROM products WHERE user_id=?").all(userId) as { images: string }[];
  return products.some((product) => {
    try { return (JSON.parse(product.images) as unknown[]).includes(relPath); } catch { return false; }
  });
}

// GET /api/files/<path>?exp=&sig= — signed bearer URL (TTL 1 jam), plus
// authenticated owner-session check. The HMAC remains useful for tamper/TTL;
// it alone is deliberately insufficient to read a private object.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const relPath = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp") ?? "0");
  const sig = url.searchParams.get("sig") ?? "";

  if (!verifySignedUrl(relPath, exp, sig)) {
    return Response.json(
      {
        code: "LINK_EXPIRED",
        message_id: "Link unduhannya udah kedaluwarsa. Buka ulang dari halaman riwayat ya.",
        message_en: "Signed URL expired or invalid.",
        retryable: true,
      },
      { status: 403 }
    );
  }

  const user = await getAuthUser(req);
  if (!user || !(await fileBelongsToUser(relPath, user.id))) {
    // Do not distinguish a leaked/foreign link from a missing session.
    return Response.json({ code: "FILE_FORBIDDEN", message_id: "File ini bukan milik akun kamu." }, { status: 403 });
  }

  let stat: { size: number; contentType?: string } | null;
  try { stat = await mediaStorage().stat(relPath); } catch { stat = null; }
  if (!stat) {
    return Response.json(
      { code: "NOT_FOUND", message_id: "Filenya tidak ketemu.", message_en: "File not found.", retryable: false },
      { status: 404 }
    );
  }

  const thumb = url.searchParams.get("variant") === "thumb" ? await thumbnailFor(relPath) : null;
  if (thumb) {
    return new Response(new Uint8Array(thumb), {
      headers: {
        "content-type": "image/webp",
        "content-length": String(thumb.length),
        "cache-control": "private, max-age=300",
      },
    });
  }

  const size = stat.size;
  const mime = stat.contentType ?? MIME[path.extname(relPath).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");
  if (range) {
    const match = range.match(/^bytes=(\d*)-(\d*)$/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    if (!match || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    const safeEnd = Math.min(end, size - 1);
    const length = safeEnd - start + 1;
    const object = await mediaStorage().get(relPath, { start, end: safeEnd });
    if (!object) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    return new Response(new Uint8Array(object.body), {
      status: 206,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${safeEnd}/${size}`,
        "content-length": String(length),
        "content-type": mime,
        "cache-control": "private, max-age=300",
      },
    });
  }

  const object = await mediaStorage().get(relPath);
  if (!object) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  return new Response(new Uint8Array(object.body), {
    headers: {
      "content-type": mime,
      "content-length": String(size),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=300",
    },
  });
}
