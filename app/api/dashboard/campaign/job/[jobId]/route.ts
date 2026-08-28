import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import crypto from "node:crypto";
import { enqueueJobResume } from "@/lib/job-queue";
import { regenerateSceneTokens } from "@/lib/credits";
import type { QualityTier } from "@/lib/providers/types";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { pgForgetShotTask } from "@/lib/postgres/task-memo";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { pastikanBolehBelanja } from "@/lib/dashboard-rbac";
import { assertPaidAdmission } from "@/lib/job-intake";
import { materializeJobReferenceManifest } from "@/lib/job-reference-manifest";
import { assertCurrentC5JobGeneration, requireCurrentJobEvidence } from "@/lib/legacy-job-quarantine";
import path from "node:path";
import { assertCategoryReviewClear } from "@/lib/product-type-boundary";
import { campaignJobDependencies } from "@/lib/campaign-job-dependencies";

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
  id: string; product_id: string; state: string; org_id: string | null; approved_at: string | null;
  requires_approval: boolean; product_name: string; segments: string;
  quality_tier: string;
  format: string; template_id: string | null;
  script_validation_result: string | null;
  approved_reference_manifest: string | null;
  job_product_snapshot: string | null;
  product_type_token: string | null;
  product_type_confirmed_token: string | null;
  product_type_confirmed_by: string | null;
  product_type_confirmed_at: string | Date | null;
  product_type_version: number | null;
  product_type_state: string | null;
  product_category:string;category_review_state:string;category_review_reason:string|null;
  category_reviewed_by:string|null;category_reviewed_role:string|null;category_reviewed_at:string|Date|null;category_review_version:number;
};

async function loadJob(pool: Pool, jobId: string, orgId: string): Promise<JobRowLite | null> {
  const res = await pool.query<JobRowLite>(
    `SELECT j.id, j.product_id, j.state, j.org_id, j.approved_at, j.requires_approval, j.quality_tier, j.format, j.template_id,
            j.approved_reference_manifest, j.job_product_snapshot,
            p.product_type_token, p.product_type_confirmed_token, p.product_type_confirmed_by,
            p.product_type_confirmed_at, p.product_type_version, p.product_type_state,
            p.category AS product_category,p.category_review_state,p.category_review_reason,
            p.category_reviewed_by,p.category_reviewed_role,p.category_reviewed_at,p.category_review_version,
            p.name AS product_name, s.segments, s.validation_result AS script_validation_result
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
    const routeDeps = campaignJobDependencies();
    if (!routeDeps.postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { membership } = await routeDeps.requireOrgContextApi(req);
    const { jobId } = await ctx.params;
    const pool = routeDeps.getPool();
    try {
      const job = await loadJob(pool, jobId, membership.org_id);
      if (!job) throw ERR.NOT_FOUND("Job-nya");
      assertCategoryReviewClear({state:job.category_review_state as "CLEAR"|"QUARANTINED",
        reason:job.category_review_reason as never,version:job.category_review_version},job.product_category);
      assertCurrentC5JobGeneration(job);
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
          // Harga ganti scene ditampilkan SEBELUM diklik. Menagih token tanpa
          // memberi tahu jumlahnya lebih dulu adalah cara tercepat membuat
          // brand merasa dicurangi.
          regen_tokens: regenerateSceneTokens(job.quality_tier as QualityTier, s.duration_sec),
          prompt: s.prompt,
          video_url: routeDeps.createSignedUrl(s.storage_key),
          thumb_url: s.thumb_key ? routeDeps.createSignedUrl(s.thumb_key) : null,
          regen_requested: s.regen_requested,
          regen_count: s.regen_count,
          regen_left: Math.max(0, MAX_REGEN_PER_SCENE - s.regen_count),
        })),
      });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
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
    const routeDeps = campaignJobDependencies();
    if (!routeDeps.postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await routeDeps.requireOrgContextApi(req);
    const { jobId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = body.action === "approve" ? "approve" : body.action === "regenerate" ? "regenerate" : null;
    if (!action) throw ERR.BAD_REQUEST("Aksi tidak dikenal.", "Unknown action.");

    // KEDUA aksi ini membelanjakan, meski dengan cara berbeda.
    //
    // "regenerate" membakar uang provider sungguhan (~Rp8-37rb sekali panggil,
    // lihat catatan di atas berkas ini) walaupun belum menahan kredit — tidak
    // menahan kredit bukan berarti tidak mengeluarkan biaya.
    //
    // "approve" melepas job ke compositing, yaitu titik ketika seluruh biaya
    // render yang sudah ditahan menjadi final. Menyetujui atas nama merek juga
    // gerbang HITL (aturan keras #5), dan gerbang yang bisa ditekan siapa saja
    // bukan gerbang.
    pastikanBolehBelanja(membership.role);

    // Regenerate memanggil provider DAN memotong saldo; approve melepas job ke
    // compositing (provider lagi). Keduanya wajib lewat gerbang yang sama.
    //
    // Ini penting khusus untuk regenerate SEKARANG: ia sudah menulis
    // type='regen', tapi migrasi yang mengizinkan tipe itu (0030) belum
    // terpasang di produksi — tanpa gerbang ini, permintaannya berujung 500
    // dengan saldo yang sudah tersentuh.
    await routeDeps.assertPaidAdmission();

    const pool = routeDeps.getPool();
    try {
      const initialJob = await loadJob(pool, jobId, membership.org_id);
      if (!initialJob) throw ERR.NOT_FOUND("Job-nya");
      return await routeDeps.withProductEvidenceMutationLock(initialJob.product_id, async () => {
      // Reload only after acquiring the same product lock used by C5 review
      // mutations. A row that was CLEAR during the ownership lookup may have
      // been quarantined while this request waited for the lock.
      const job = await loadJob(pool, jobId, membership.org_id);
      if (!job) throw ERR.NOT_FOUND("Job-nya");
      assertCategoryReviewClear({
        state: job.category_review_state as "CLEAR" | "QUARANTINED",
        reason: job.category_review_reason as never,
        version: job.category_review_version,
      }, job.product_category);
      if (!job.requires_approval) throw ERR.BAD_REQUEST("Job ini tidak memakai review scene.", "Job has no approval gate.");
      if (job.state !== "AWAITING_APPROVAL") {
        throw ERR.BAD_REQUEST("Scene-nya belum siap ditinjau, atau sudah lewat tahap ini.", `Job is in ${job.state}.`);
      }

      // A6 adalah boundary berbayar: approve bisa melanjutkan provider/TTS dan
      // regenerate langsung menulis ledger `regen`. Keduanya wajib memeriksa
      // manifest durable + bytes SEBELUM mutation, charge, task reset, atau
      // enqueue. Job review legacy tanpa manifest sudah pasti punya scene
      // provider, jadi provenance-nya tidak boleh direkonstruksi diam-diam.
      try {
        const currentEvidence = requireCurrentJobEvidence({
          approvedReferenceManifest: job.approved_reference_manifest,
          jobProductSnapshot: job.job_product_snapshot,
          productType: {...job,category:job.product_category},
        });
        await materializeJobReferenceManifest(currentEvidence.manifest, path.join(config.storageDir, "jobs", jobId));
      } catch (error) {
        console.error(`[product-truth] A6 job ${jobId} dihentikan sebelum ${action}:`, error);
        throw ERR.BAD_REQUEST(
          "Snapshot data produk atau foto acuan tidak sah. Job dihentikan sebelum persetujuan atau biaya regenerate.",
          "Product metadata snapshot or approved reference is invalid; no approval/regeneration side effect was applied."
        );
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

      // Batas laju SEBELUM apa pun disentuh: tiap regenerate memanggil
      // provider video, jadi ini jalur uang paling mudah disalahgunakan.
      await assertDashboardRate("regenerate", membership.org_id);

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
      // Klaim jatah DAN tagih token dalam SATU transaksi.
      //
      // Brian, 2026-08-11: "nanti tentu regenerate harus bayar, kalau tidak
      // perusahaan rugi kan?" — benar: tiap penggantian memanggil provider
      // video lagi dan itu uang nyata keluar dari kami.
      //
      // Harus satu transaksi, bukan dua langkah. Kalau klaim berhasil lalu
      // penagihan gagal, brand mendapat render gratis; kalau penagihan lebih
      // dulu lalu klaim kalah balapan, brand membayar sesuatu yang tidak
      // pernah dibuat. Keduanya cacat uang, dan keduanya hilang di sini.
      const client = await pool.connect();
      let claimedCount = 0;
      let chargedTokens = 0;
      try {
        await client.query("BEGIN");
        const claimed = await client.query<{ regen_count: number; duration_sec: number }>(
          `UPDATE job_shots SET regen_requested=TRUE, regen_count=regen_count+1
           WHERE job_id=$1 AND idx=$2 AND regen_requested=FALSE AND regen_count < $3
           RETURNING regen_count, duration_sec`,
          [jobId, idx, MAX_REGEN_PER_SCENE]
        );
        if (!claimed.rowCount) {
          await client.query("ROLLBACK");
        } else {
          claimedCount = claimed.rowCount;
          const price = regenerateSceneTokens(job.quality_tier as QualityTier, claimed.rows[0].duration_sec);
          // Kunci dompet dulu, baru baca saldo. Klaim scene di atas hanya
          // menserialisasi per-SHOT; dua scene BERBEDA pada job yang sama
          // masih bisa berjalan bersamaan dan sama-sama membaca saldo lama.
          // Pola FOR UPDATE ini sama persis dengan lockWallet() di
          // lib/postgres/credit-payment.ts, jadi penagihan regenerate ikut
          // antre di baris yang sama dengan hold/capture — bukan jalur uang
          // kedua yang diam-diam lebih longgar.
          await client.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [membership.org_id]);
          const bal = await client.query<{ balance: string }>(
            "SELECT COALESCE(SUM(delta),0)::text AS balance FROM credit_ledger WHERE org_id=$1",
            [membership.org_id]
          );
          if (Number(bal.rows[0]?.balance ?? 0) < price) {
            await client.query("ROLLBACK");
            throw ERR.BAD_REQUEST(
              `Token tidak cukup untuk mengganti scene ini (butuh ${price.toLocaleString("id-ID")} token).`,
              "Insufficient tokens for regeneration."
            );
          }
          // 'regen', BUKAN 'capture'.
          //
          // Biaya regenerate memang memotong saldo (delta negatif, ikut SUM
          // biasa), tapi ia BUKAN catatan terminal job induknya. Menulisnya
          // sebagai capture merebut slot terminal milik render itu sendiri:
          // capture final lalu menyerah karena "sudah ada terminal", refund
          // menolak mengembalikan uang saat render gagal, dan hold dasarnya
          // tertahan selamanya. Sesudah indeks unik terminal terpasang,
          // regenerate KEDUA bahkan gagal 23505 padahal UI menjanjikan tiga
          // kali. Lihat migrations/postgres/0030_regen_ledger_type.sql.
          await client.query(
            `INSERT INTO credit_ledger (id,user_id,org_id,type,delta,job_id,created_at)
             VALUES ($1,$2,$3,'regen',$4,$5,$6)`,
            [crypto.randomUUID(), user.id, membership.org_id, -price, jobId, new Date().toISOString()]
          );
          chargedTokens = price;
          await client.query("COMMIT");
        }
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }

      const claimed = { rowCount: claimedCount };
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
        [user.id, jobId, JSON.stringify({ idx, org_id: membership.org_id, tokens: chargedTokens }), new Date().toISOString()]
      );
      // Lupakan task provider untuk scene ini SEBELUM worker dibangunkan.
      // Kalau tidak, worker akan melanjutkan polling task LAMA dan
      // mengembalikan video yang sama persis — brand sudah ditagih token,
      // dan tombol "Ganti scene" jadi tidak berfungsi sama sekali.
      await pgForgetShotTask(jobId, idx);
      await enqueueJobResume(jobId, `regen${idx}`);
      return Response.json({ job_id: jobId, idx, regenerating: true, tokens_charged: chargedTokens });
      });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}
