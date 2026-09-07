/**
 * POST /api/storyboard/:id/scene/:idx — ganti gambar satu scene.
 *
 * Kuota dipotong DI SINI, sebelum pekerjaan diantrekan, dan lewat satu
 * pernyataan UPDATE bersyarat (lihat pakaiKuotaRegen). Memotongnya di worker
 * berarti dua ketukan cepat pada tombol yang sama sama-sama lolos.
 */
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgStoryboardRepository } from "@/lib/postgres/storyboard";
import { enqueueRegenScene } from "@/lib/storyboard-queue";
import { MAKS_REGEN_PER_SCENE, MAKS_REGEN_TOTAL, terpakaiTotal } from "@/lib/storyboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string; idx: string }> }) {
  try {
    const { id, idx } = await ctx.params;
    const nomor = Number(idx);
    if (!Number.isInteger(nomor) || nomor < 0) throw ERR.BAD_REQUEST("Scene-nya tidak dikenal.", "Bad scene index.");

    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (!postgresRuntimeEnabled())
      throw ERR.BAD_REQUEST("Storyboard butuh runtime PostgreSQL.", "Storyboard requires the PostgreSQL runtime.");

    const repo = new PgStoryboardRepository(config.databaseUrl);
    try {
      const sb = await repo.getMilik(id, user.id);
      if (!sb) throw ERR.NOT_FOUND("Storyboard-nya");
      if (sb.status === "APPROVED")
        throw ERR.BAD_REQUEST(
          "Storyboard ini sudah dipakai untuk generate video, jadi tidak bisa diubah.",
          "Approved storyboards are immutable."
        );

      const dipakai = await repo.pakaiKuotaRegen(id, nomor);
      if (!dipakai) {
        // Dibedakan supaya pesannya benar: "scene ini sudah 2x" dan "jatah
        // storyboard habis" adalah dua sebab berbeda, dan menyamakannya membuat
        // pengguna mengira kartu lain masih bisa diganti padahal tidak.
        const semua = await repo.scenes(id);
        const total = terpakaiTotal(semua.map((x) => ({ regenCount: x.regen_count })));
        throw ERR.BAD_REQUEST(
          total >= MAKS_REGEN_TOTAL
            ? `Jatah ganti gambar untuk storyboard ini sudah habis (${MAKS_REGEN_TOTAL}x).`
            : `Scene ini sudah diganti ${MAKS_REGEN_PER_SCENE} kali — batasnya segitu ya.`,
          "Storyboard regeneration quota exhausted."
        );
      }

      await enqueueRegenScene(id, nomor);
      // Status kembali BUILDING supaya tombol Generate terkunci sampai gambar
      // penggantinya benar-benar ada. Tanpa ini pengguna bisa menekan Generate
      // sementara kartunya masih gambar lama.
      await repo.setStatus(id, "BUILDING", null);
      return Response.json({ ok: true, idx: nomor });
    } finally { await repo.close(); }
  } catch (err) { return errorResponse(err); }
}
