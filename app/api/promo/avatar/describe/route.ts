import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { describeAvatarFromPhoto } from "@/lib/promo/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// POST /api/promo/avatar/describe — upload avatar sendiri (Brian 2026-08-10).
// BytePlus menolak foto wajah manusia asli sebagai image reference di semua
// mode (lihat lib/promo/avatar.ts) — jadi foto TIDAK disimpan/dipakai
// langsung, hanya dibaca sekali oleh Gemini vision buat jadi deskripsi teks,
// yang kemudian dikirim balik ke client untuk disertakan saat bikin job.
export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    const form = await req.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) throw ERR.BAD_REQUEST("Foto avatar belum diupload.", "Avatar photo is required.");
    if (!ALLOWED_MIME.has(file.type)) throw ERR.BAD_REQUEST("Format foto harus jpg/png/webp.", "Unsupported image format.");
    if (file.size > MAX_BYTES) throw ERR.BAD_REQUEST("Ukuran foto maksimal 10MB.", "Photo exceeds max size.");

    const buf = Buffer.from(await file.arrayBuffer());
    const description = await describeAvatarFromPhoto(buf, file.type);

    return Response.json({ description });
  } catch (err) {
    return errorResponse(err);
  }
}
