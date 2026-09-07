/**
 * GET    /api/storyboard/:id — status + kartu (dipoll UI selama gambar dibuat)
 * DELETE /api/storyboard/:id — buang storyboard, kembali ke skrip
 *
 * DELETE tidak mengembalikan uang apa pun karena tidak ada uang yang ditahan —
 * itulah inti kebijakan "gratis tapi berkuota" (Brian 7 Sep 2026). Gambar yang
 * sudah dibayar ke BytePlus memang hangus, dan kuota per scene yang menjaga
 * angkanya tetap kecil.
 */
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PgStoryboardRepository } from "@/lib/postgres/storyboard";
import { MAKS_REGEN_PER_SCENE, MAKS_REGEN_TOTAL, siapDisetujui, sisaRegenerate, sisaTotal } from "@/lib/storyboard";
import { createSignedUrl } from "@/lib/signed-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ambil(req: Request, id: string) {
  const user = await getAuthUser(req);
  if (!user) throw ERR.UNAUTHORIZED();
  if (!postgresRuntimeEnabled())
    throw ERR.BAD_REQUEST("Storyboard butuh runtime PostgreSQL.", "Storyboard requires the PostgreSQL runtime.");
  const repo = new PgStoryboardRepository(config.databaseUrl);
  const sb = await repo.getMilik(id, user.id);
  if (!sb) { await repo.close(); throw ERR.NOT_FOUND("Storyboard-nya"); }
  return { repo, sb, user };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { repo, sb } = await ambil(req, id);
    try {
      const scenes = await repo.scenes(id);
      return Response.json({
        storyboard_id: sb.id,
        status: sb.status,
        error: sb.error,
        duration_sec: sb.duration_sec,
        quality_tier: sb.quality_tier,
        job_id: sb.job_id,
        siap: siapDisetujui(scenes.map((s) => ({ imageKey: s.image_key }))),
        maks_regen: MAKS_REGEN_PER_SCENE,
        maks_regen_total: MAKS_REGEN_TOTAL,
        sisa_regen_total: sisaTotal(scenes.map((x) => ({ regenCount: x.regen_count }))),
        scenes: scenes.map((s) => ({
          idx: s.idx,
          duration_sec: s.duration_sec,
          dialog: s.dialog,
          // Prompt ditampilkan apa adanya: pengguna berhak tahu apa yang ia
          // setujui, dan itulah teks yang benar-benar dikirim ke mesin video.
          prompt: s.prompt,
          tanpa_orang: s.tanpa_orang,
          // URL bertanda tangan, bukan kunci mentah — kunci storage tidak boleh
          // bocor ke browser.
          image_url: s.image_key ? createSignedUrl(s.image_key) : null,
          // Dua pagu diperhitungkan sekaligus: menampilkan pagu per-scene saja
          // membuat UI menjanjikan "bisa 2x lagi" pada kartu yang sebenarnya
          // sudah terkunci karena jatah storyboard habis.
          sisa_regen: sisaRegenerate(
            { regenCount: s.regen_count },
            scenes.map((x) => ({ regenCount: x.regen_count }))
          ),
        })),
      });
    } finally { await repo.close(); }
  } catch (err) { return errorResponse(err); }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const { repo, user } = await ambil(req, id);
    try {
      const terhapus = await repo.hapus(id, user.id);
      // Storyboard yang sudah disetujui sengaja TIDAK bisa dihapus: ia catatan
      // apa yang pengguna setujui saat uangnya ditahan.
      if (!terhapus)
        throw ERR.BAD_REQUEST(
          "Storyboard ini sudah dipakai untuk generate video, jadi tidak bisa dihapus.",
          "Approved storyboards are immutable."
        );
      return Response.json({ ok: true });
    } finally { await repo.close(); }
  } catch (err) { return errorResponse(err); }
}
