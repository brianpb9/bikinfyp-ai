/**
 * BETA IKLAN SINEMATIK — RUTE KHUSUS ADMIN.
 *
 * Satu-satunya cara membuat job berformat `iklan_sinematik`. Sengaja TIDAK
 * lewat /api/jobs: rute itu menegakkan gerbang naskah, storyboard, dan kredit
 * yang tidak berlaku untuk format ini — dan format ini belum boleh dijual,
 * jadi menambahkannya ke sana berarti satu bug validasi saja sudah cukup
 * untuk membuatnya bocor ke pengguna.
 *
 * TIDAK MENAHAN KREDIT. Beta ini gratis dan hanya bisa dipicu admin; worker
 * juga melewati capture kredit untuk format ini (lib/postgres/worker.ts).
 * Biaya providernya nyata dan ditanggung studio — karena itu rutenya membatasi
 * berapa job beta yang boleh berjalan bersamaan.
 */

import { wajibAdminApi } from "@/lib/admin-auth";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { getPool } from "@/lib/postgres/pool";
import { pgAudit, postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { enqueueJob } from "@/lib/job-queue";
import { createSignedUrl } from "@/lib/signed-url";
import { DURASI_IKLAN_DTK, FORMAT_IKLAN } from "@/lib/iklan/format";
import { bolehDiskorFyp } from "@/lib/fyp-score";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Job beta yang boleh berjalan bersamaan. Satu render Ultra ±Rp60 rb. */
const MAKS_BERJALAN = 2;

const AKTIF = "('QUEUED','GENERATING_VISUAL','AWAITING_APPROVAL','GENERATING_VOICE','COMPOSITING','QC_CHECK','LABELING')";

type BarisJob = {
  id: string; state: string; quality_tier: string; output_url: string | null;
  created_at: string; completed_at: string | null; qc_result: string | null; product_name: string;
};

function pool() {
  if (!postgresRuntimeEnabled()) {
    throw ERR.BAD_REQUEST("Beta ini hanya jalan di runtime PostgreSQL.", "Iklan beta requires the PostgreSQL runtime.");
  }
  return getPool(config.databaseUrl);
}

// GET /api/admin/iklan — job beta terakhir + produk yang bisa dipakai.
export async function GET(req: Request) {
  try {
    await wajibAdminApi(req);
    const p = pool();
    const jobs = await p.query<BarisJob>(
      `SELECT j.id, j.state, j.quality_tier, j.output_url, j.created_at, j.completed_at, j.qc_result, pr.name AS product_name
       FROM jobs j JOIN products pr ON pr.id=j.product_id
       WHERE j.format=$1 ORDER BY j.created_at DESC LIMIT 20`, [FORMAT_IKLAN]);
    const produk = await p.query<{ id: string; name: string; category: string; images: string }>(
      "SELECT id, name, category, images FROM products ORDER BY created_at DESC LIMIT 50");
    return Response.json({
      jobs: jobs.rows.map((r) => ({
        id: r.id, state: r.state, mesin: r.quality_tier === "premium" ? "ultra" : "standard",
        // Tautan bertanda tangan dibuat DI SERVER — kuncinya tidak pernah
        // sampai ke browser, dan tautannya kedaluwarsa sendiri.
        video: r.output_url ? createSignedUrl(r.output_url) : null,
        created_at: r.created_at, completed_at: r.completed_at,
        // qc_result bisa besar (biaya + tiap gerbang); yang dibutuhkan daftar
        // hanya lulus/tidak dan gerbang yang gagal.
        qc: ringkasQc(r.qc_result), produk: r.product_name,
      })),
      produk: produk.rows
        .map((r) => ({ id: r.id, nama: r.name, kategori: r.category, foto: hitungFoto(r.images) }))
        .filter((r) => r.foto > 0),
    });
  } catch (e) { return errorResponse(e); }
}

function hitungFoto(images: string): number {
  try { const x = JSON.parse(images); return Array.isArray(x) ? x.length : 0; } catch { return 0; }
}

function ringkasQc(qc: string | null): { passed: boolean; gagal: string[]; biaya_idr: number | null } | null {
  if (!qc) return null;
  try {
    const x = JSON.parse(qc) as { passed?: boolean; checks?: { code: string; status: string }[]; biaya_idr?: Record<string, number> };
    return {
      passed: x.passed === true,
      gagal: (x.checks ?? []).filter((c) => c.status !== "pass").map((c) => c.code),
      biaya_idr: typeof x.biaya_idr?.total_idr === "number" ? x.biaya_idr.total_idr : null,
    };
  } catch { return null; }
}

// POST /api/admin/iklan {product_id, mesin?: "standard"|"ultra"}
export async function POST(req: Request) {
  try {
    const admin = await wajibAdminApi(req);
    const p = pool();
    const body = await req.json().catch(() => ({}));
    const productId = String(body.product_id ?? "").trim();
    const mesin = String(body.mesin ?? "standard");
    if (!["standard", "ultra"].includes(mesin)) {
      throw ERR.BAD_REQUEST("Mesin video tidak dikenal. Pilih standard atau ultra.", "Unknown engine.");
    }

    const produk = await p.query<{ id: string; name: string; images: string }>(
      "SELECT id, name, images FROM products WHERE id=$1", [productId]);
    if (!produk.rows[0]) throw ERR.NOT_FOUND("Produknya");
    if (hitungFoto(produk.rows[0].images) === 0) {
      throw ERR.BAD_REQUEST("Produk ini belum punya foto. Iklan sinematik butuh minimal 1 foto produk asli.", "Product has no photo.");
    }

    const berjalan = await p.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM jobs WHERE format=$1 AND state IN ${AKTIF}`, [FORMAT_IKLAN]);
    if (Number(berjalan.rows[0]?.n ?? 0) >= MAKS_BERJALAN) {
      throw ERR.BAD_REQUEST(
        `Sudah ada ${MAKS_BERJALAN} render beta berjalan. Tunggu selesai dulu ya.`,
        "Beta concurrency limit reached.");
    }

    const scriptId = randomUUID();
    const jobId = randomUUID();
    const waktu = new Date().toISOString();
    // Baris scripts dibuat kosong: naskah iklan sinematik ditulis DI DALAM
    // pipeline (lib/iklan/naskah.ts) dari foto dan data produk, bukan dari
    // script-engine retail. Barisnya tetap ada karena jobs.script_id NOT NULL
    // dan worker mem-JOIN-nya.
    const client = await p.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO scripts (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,edited_by_user,created_at)
         VALUES ($1,$2,$3,'iklan_sinematik','netral','netral','[]',$4,'[]','{"beta":"iklan_sinematik"}',$5,$6,0,$6)`,
        [scriptId, jobId, productId, produk.rows[0].name, mesin === "ultra" ? "premium" : "standard", waktu]);
      await client.query(
        `INSERT INTO jobs (id,user_id,product_id,persona_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,'QUEUED',$8,$8)`,
        [jobId, admin.id, productId, scriptId, FORMAT_IKLAN, mesin === "ultra" ? "premium" : "standard", DURASI_IKLAN_DTK, waktu]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { client.release(); }

    // SKOR FYP SENGAJA DILEWATI, dan dicatat sebagai keputusan — bukan hilang
    // diam-diam seperti 12 job brand pada Agustus 2026. Model FYP dilatih pada
    // konten organik TikTok; iklan merek 30 detik di luar jangkauannya, jadi
    // angka apa pun yang dihasilkan akan terlihat sah tapi tidak berarti.
    // Satu-satunya sumber kebenaran daftar itu: lib/fyp-score.
    const fyp = bolehDiskorFyp(FORMAT_IKLAN) ? "wajib" : "dilewati (format di luar jangkauan model)";
    await pgAudit(admin.email ?? admin.id, "iklan.beta.queued", "jobs", jobId, {
      product_id: productId, mesin, fyp_snapshot: fyp,
    });
    // Prioritas "beta": selalu di belakang job berbayar (lib/prioritas-antrean).
    await enqueueJob(jobId, "beta");
    return Response.json({ job_id: jobId, mesin, format: FORMAT_IKLAN });
  } catch (e) { return errorResponse(e); }
}
