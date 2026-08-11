import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { enqueueJobResume } from "@/lib/job-queue";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Batas generate-ulang per scene. Regenerate memanggil provider video lagi
// (biaya nyata ~Rp8-37rb sekali panggil) TAPI belum menahan kredit tambahan
// dari wallet brand — menahan kredit di tengah render butuh penanganan
// "saldo habis saat separuh jalan" yang belum dibangun. Jadi untuk sekarang
// gratis TAPI dibatasi, supaya paparan biaya kita terkurung. Kalau nanti
// regenerate mau ditagih, ubah di sini + tambahkan hold seperti di confirm.
const MAX_REGEN_PER_SCENE = 3;

type SceneRow = {
  idx: number; prompt: string; storage_key: string; thumb_key: string | null;
  duration_sec: number; regen_requested: boolean; regen_count: number;
};
type JobRowLite = {
  id: string; state: string; org_id: string | null; approved_at: string | null;
  requires_approval: boolean; product_name: string; segments: string;
};

async function loadJob(pool: Pool, jobId: string, orgId: string): Promise<JobRowLite | null> {
  const res = await pool.query<JobRowLite>(
    `SELECT j.id, j.state, j.org_id, j.approved_at, j.requires_approval,
            p.name AS product_name, s.segments
     FROM jobs j JOIN products p ON p.id=j.product_id JOIN scripts s ON s.id=j.script_id
     WHERE j.id=$1 AND j.org_id=$2`,
    [jobId, orgId]
  );
  return res.rows[0] ?? null;
}

// GET — daftar scene untuk layar review brand: gambar, kalimat skrip, dan
// prompt yang benar-benar dikirim ke model. Brand sangat peduli gambar &
// pesan, jadi ketiganya ditampilkan apa adanya, bukan diringkas.
export async function GET(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const { jobId } = await ctx.params;
    const pool = new Pool({ connectionString: config.databaseUrl });
    try {
      const job = await loadJob(pool, jobId, membership.org_id);
      if (!job) throw ERR.NOT_FOUND("Job-nya");
      const scenes = (await pool.query<SceneRow>(
        "SELECT idx, prompt, storage_key, thumb_key, duration_sec, regen_requested, regen_count FROM job_shots WHERE job_id=$1 ORDER BY idx ASC",
        [jobId]
      )).rows;
      return Response.json({
        job_id: job.id,
        state: job.state,
        product_name: job.product_name,
        approved: Boolean(job.approved_at),
        segments: JSON.parse(job.segments),
        max_regen_per_scene: MAX_REGEN_PER_SCENE,
        scenes: scenes.map((s) => ({
          idx: s.idx,
          duration_sec: s.duration_sec,
          prompt: s.prompt,
          video_url: createSignedUrl(s.storage_key),
          thumb_url: s.thumb_key ? createSignedUrl(s.thumb_key) : null,
          regen_requested: s.regen_requested,
          regen_count: s.regen_count,
          regen_left: Math.max(0, MAX_REGEN_PER_SCENE - s.regen_count),
        })),
      });
    } finally {
      await pool.end();
    }
  } catch (err) {
    return errorResponse(err);
  }
}

// POST {action:"approve"} | {action:"regenerate", idx}
//
// Keduanya cuma mengubah baris DB lalu meng-enqueue ulang job — pekerjaan
// beratnya di worker. Web service SENGAJA tidak generate apa pun: ffmpeg dan
// kredensial provider hanya ada di container worker.
export async function POST(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    const { jobId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = body.action === "approve" ? "approve" : body.action === "regenerate" ? "regenerate" : null;
    if (!action) throw ERR.BAD_REQUEST("Aksi tidak dikenal.", "Unknown action.");

    const pool = new Pool({ connectionString: config.databaseUrl });
    try {
      const job = await loadJob(pool, jobId, membership.org_id);
      if (!job) throw ERR.NOT_FOUND("Job-nya");
      if (!job.requires_approval) throw ERR.BAD_REQUEST("Job ini tidak memakai review scene.", "Job has no approval gate.");
      if (job.state !== "AWAITING_APPROVAL") {
        throw ERR.BAD_REQUEST("Scene-nya belum siap ditinjau, atau sudah lewat tahap ini.", `Job is in ${job.state}.`);
      }

      if (action === "approve") {
        // Menyetujui sementara ada scene yang sedang dibuat ulang = brand
        // menyetujui sesuatu yang BELUM pernah dilihat — padahal justru itu
        // inti fitur ini. UI sudah men-disable tombolnya; ini penjaga kedua
        // supaya request langsung ke API tidak bisa melewatinya.
        const pending = await pool.query(
          "SELECT 1 FROM job_shots WHERE job_id=$1 AND regen_requested=TRUE LIMIT 1", [jobId]
        );
        if (pending.rowCount) {
          throw ERR.BAD_REQUEST("Masih ada scene yang sedang dibuat ulang — tunggu selesai dulu, baru setujui.", "Regeneration still pending.");
        }
        // Klaim persetujuan secara ATOMIK. Tanpa `approved_at IS NULL`, dua
        // klik "Setujui" beruntun sama-sama lolos pengecekan state di atas —
        // state baru berubah setelah WORKER mengambil job, bukan saat klik.
        // Akibatnya dua enqueueJobResume() dengan id BullMQ berbeda, dua
        // worker menggabung job yang sama, dan TTS Gemini ditagih dua kali.
        const claimed = await pool.query(
          "UPDATE jobs SET approved_at=$1 WHERE id=$2 AND approved_at IS NULL",
          [new Date().toISOString(), jobId]
        );
        if (!claimed.rowCount) return Response.json({ job_id: jobId, approved: true, already_approved: true });
        await pool.query(
          "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (gen_random_uuid()::text,$1,'scene.approved','jobs',$2,$3,$4)",
          [user.id, jobId, JSON.stringify({ org_id: membership.org_id }), new Date().toISOString()]
        );
        await enqueueJobResume(jobId, "approve");
        return Response.json({ job_id: jobId, approved: true });
      }

      // Setelah approved_at terisi, job sudah dilepas ke worker untuk
      // digabung. Meminta ganti scene di titik ini berarti mengubah bahan di
      // tengah compositing — hasilnya campur aduk dan providernya tetap
      // ditagih. state masih AWAITING_APPROVAL sampai worker mengambilnya,
      // jadi pengecekan state di atas TIDAK menangkap kasus ini.
      if (job.approved_at) {
        throw ERR.BAD_REQUEST("Job ini sudah disetujui dan sedang digabung — scene tidak bisa diganti lagi.", "Job already approved.");
      }
      const idx = Number(body.idx);
      if (!Number.isInteger(idx) || idx < 0) throw ERR.BAD_REQUEST("Nomor scene tidak valid.", "Invalid scene index.");
      // Klaim jatah regenerate secara ATOMIK, di satu pernyataan. Versi
      // sebelumnya membaca regen_count lalu meng-update terpisah: dua request
      // bersamaan sama-sama membaca 2, sama-sama lolos "< 3", lalu sama-sama
      // menambah — jatahnya jebol dan provider dipanggil dua kali. Syarat
      // regen_requested=FALSE sekaligus menutup klik ganda pada scene yang
      // memang sedang dibuat ulang. Tiap panggilan provider ini uang nyata,
      // jadi penjaganya harus di database, bukan cuma di UI.
      const claimed = await pool.query<{ regen_count: number }>(
        `UPDATE job_shots SET regen_requested=TRUE, regen_count=regen_count+1
         WHERE job_id=$1 AND idx=$2 AND regen_requested=FALSE AND regen_count < $3
         RETURNING regen_count`,
        [jobId, idx, MAX_REGEN_PER_SCENE]
      );
      if (!claimed.rowCount) {
        // Gagal klaim -> baca keadaan sebenarnya HANYA untuk menyusun pesan.
        const scene = (await pool.query<{ regen_count: number; regen_requested: boolean }>(
          "SELECT regen_count, regen_requested FROM job_shots WHERE job_id=$1 AND idx=$2", [jobId, idx]
        )).rows[0];
        if (!scene) throw ERR.NOT_FOUND("Scene-nya");
        if (scene.regen_requested) {
          throw ERR.BAD_REQUEST("Scene ini sedang dibuat ulang — tunggu selesai dulu.", "Regeneration already in flight.");
        }
        throw ERR.BAD_REQUEST(
          `Scene ini sudah diganti ${MAX_REGEN_PER_SCENE} kali — batas maksimal. Setujui apa adanya atau buat kampanye baru.`,
          "Regenerate limit reached."
        );
      }
      await pool.query(
        "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (gen_random_uuid()::text,$1,'scene.regenerate','jobs',$2,$3,$4)",
        [user.id, jobId, JSON.stringify({ idx, org_id: membership.org_id }), new Date().toISOString()]
      );
      await enqueueJobResume(jobId, `regen${idx}`);
      return Response.json({ job_id: jobId, idx, regenerating: true });
    } finally {
      await pool.end();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
