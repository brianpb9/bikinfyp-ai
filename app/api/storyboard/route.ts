/**
 * POST /api/storyboard — buat storyboard dari skrip yang sudah disetujui.
 *
 * Gerbang persetujuan pra-render (Brian 7 Sep 2026). Route ini TIDAK menahan
 * uang: storyboard gratis, dan yang menjaga margin adalah kuota di
 * lib/storyboard.ts. Uang baru ditahan di POST /api/jobs, setelah pengguna
 * melihat kartunya dan menekan Generate.
 */
import { getAuthUser } from "@/lib/auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { postgresRuntimeEnabled, smokeGetProduct, smokeGetScript } from "@/lib/postgres/smoke-runtime";
import { PgStoryboardRepository } from "@/lib/postgres/storyboard";
import { enqueueStoryboard } from "@/lib/storyboard-queue";
import { rencanaStoryboard, formatBersih, type ParamsStoryboard } from "@/lib/storyboard-rencana";
import { sceneDariShots } from "@/lib/storyboard";
import { bacaJejak } from "@/lib/script-engine/admisi";
import type { SegmentDraft } from "@/lib/script-engine/templates";
import { pastikanBukanProdukOrg } from "@/lib/dashboard-rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const user = await getAuthUser(req);
    if (!user) throw ERR.UNAUTHORIZED();
    if (!postgresRuntimeEnabled())
      throw ERR.BAD_REQUEST("Storyboard butuh runtime PostgreSQL.", "Storyboard requires the PostgreSQL runtime.");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scriptId = String(body.script_id ?? "");
    if (!scriptId) throw ERR.BAD_REQUEST("Skripnya belum dipilih.", "script_id is required.");

    const script = await smokeGetScript(user.id, scriptId);
    if (!script) throw ERR.NOT_FOUND("Skripnya");
    // Gerbang HITL sama seperti /api/jobs: storyboard menggambarkan naskah, dan
    // naskah yang belum disetujui masih bisa berubah di bawahnya.
    if (!script.approved_by_user_at) throw ERR.SCRIPT_NOT_APPROVED();

    const product = await smokeGetProduct(user.id, script.product_id);
    if (!product) throw ERR.NOT_FOUND("Skripnya");
    pastikanBukanProdukOrg(product);

    const repo = new PgStoryboardRepository(config.databaseUrl);
    try {
      // Menekan "lanjut" dua kali tidak boleh melahirkan dua storyboard dan
      // dua kali biaya gambar.
      const adaSudah = await repo.aktifUntukScript(scriptId, user.id);
      if (adaSudah) {
        // BARIS YATIM DIPULIHKAN, BUKAN DIKEMBALIKAN APA ADANYA.
        //
        // create() dan enqueue() adalah dua langkah. Kalau yang kedua gagal —
        // dan itu BENAR-BENAR terjadi pada uji produksi pertama, saat BullMQ
        // menolak id yang memuat ":" — barisnya tertinggal di PENDING tanpa
        // ada pekerjaan yang akan mengerjakannya. Dedup lalu mengembalikan
        // baris mati itu selamanya, dan pengguna melihat storyboard yang tidak
        // pernah selesai tanpa satu pun pesan galat.
        //
        // Mengantre ulang aman: worker melewati scene yang gambarnya sudah ada,
        // jadi ini tidak membayar dua kali untuk kartu yang sudah jadi.
        if (adaSudah.status === "PENDING" || adaSudah.status === "FAILED") {
          await enqueueStoryboard(adaSudah.id);
        }
        return Response.json({ storyboard_id: adaSudah.id, status: adaSudah.status, existing: true });
      }

      const params: ParamsStoryboard = {
        format: formatBersih(body.format),
        duration_s: Number(body.duration_s ?? 15),
        quality_tier: String(body.quality_tier ?? script.quality_tier ?? "high_quality"),
        creator_category: String(body.creator_category ?? "hijaber"),
        avatar_custom_desc: typeof body.avatar_custom_desc === "string" ? body.avatar_custom_desc : null,
      };

      const segments = JSON.parse(script.segments) as SegmentDraft[];
      const spec = rencanaStoryboard(
        {
          // planShots hanya memakai ini sebagai label; job belum ada.
          storyboardId: `sb-${scriptId}`,
          segments,
          productName: product.name,
          productCategory: product.category ?? "",
          productVisualDesc: product.product_visual_desc ?? null,
          brandBrief: product.brand_brief ?? null,
          // Kunci storage apa adanya, TANPA materialize. planShots murni
          // komputasi: nilai ini hanya diteruskan ke ShotSpec.imageRefPath dan
          // tidak pernah dibuka (diperiksa 7 Sep 2026). Storyboard pun tidak
          // menyimpannya — yang disimpan cuma prompt dan startState. Jalur
          // lokal yang benar diturunkan worker saat render.
          imageRefPath: (JSON.parse(product.images) as string[])[0] ?? "",
          ideaFormat: (bacaJejak(script.validation_result).admisi as { ideaFormat?: string } | undefined)?.ideaFormat ?? null,
        },
        params
      );

      const scenes = sceneDariShots(spec.shots, segments);
      const id = await repo.create({
        scriptId, userId: user.id,
        durationSec: Number(params.duration_s ?? 15),
        qualityTier: String(params.quality_tier),
        format: String(params.format),
        params,
        scenes,
      });
      try {
        await enqueueStoryboard(id);
      } catch (e) {
        // Ditandai FAILED, bukan dibiarkan PENDING: PENDING berarti "sedang
        // menunggu giliran" dan itu bohong kalau tidak ada pekerjaan yang
        // pernah masuk antrean. FAILED membuat UI menawarkan coba lagi.
        await repo.setStatus(id, "FAILED", e instanceof Error ? e.message.slice(0, 500) : String(e));
        throw e;
      }
      return Response.json({ storyboard_id: id, status: "PENDING", scenes: scenes.length }, { status: 201 });
    } finally {
      await repo.close();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
