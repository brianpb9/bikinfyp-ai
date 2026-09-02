import { mediaStorage } from "@/lib/storage";
import { mimeGambar, verifikasiGambarProvider } from "@/lib/gambar-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/provider-image/provider-in/<jobId>/<n>.jpg?exp=&sig=
 *
 * SATU-SATUNYA jalur baca tanpa sesi di aplikasi ini, dan ia ada karena kie.ai
 * mengunduh gambar sendiri (lihat lib/gambar-provider.ts). Batasnya ditegakkan
 * di sini, bukan sekadar dijanjikan di komentar:
 *
 *   - awalan kunci wajib `provider-in/` (diperiksa di verifikasiGambarProvider);
 *   - tanda tangan HMAC dengan kunci turunan tersendiri, ber-TTL;
 *   - yang dikirim balik HANYA jika bytes-nya benar-benar JPEG/PNG/WebP.
 *
 * Syarat ketiga itu bukan hiasan. Tanpa memeriksa bytes, satu berkas apa pun
 * yang sempat mendarat di bawah awalan ini akan disajikan apa adanya ke
 * internet. Memeriksanya membuat gerbang ini melayani gambar saja, walau
 * isinya salah taruh.
 */
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const relPath = parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url);

  if (!verifikasiGambarProvider(relPath, Number(url.searchParams.get("exp") ?? "0"), url.searchParams.get("sig") ?? "")) {
    // Satu jawaban untuk tanda tangan salah, kunci di luar kotak, dan tautan
    // kedaluwarsa — jangan bantu pemindai membedakan ketiganya.
    return new Response("forbidden", { status: 403 });
  }

  let objek: { body: Buffer } | null;
  try {
    objek = await mediaStorage().get(relPath);
  } catch {
    objek = null;
  }
  if (!objek) return new Response("not found", { status: 404 });

  const mime = mimeGambar(objek.body);
  if (!mime) return new Response("forbidden", { status: 403 });

  return new Response(new Uint8Array(objek.body), {
    headers: {
      "content-type": mime,
      "content-length": String(objek.body.length),
      // Tautannya sudah pendek umur; jangan sampai ada perantara menyimpannya
      // lebih lama daripada tanda tangannya berlaku.
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
