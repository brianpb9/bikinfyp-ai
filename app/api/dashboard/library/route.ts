import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { createSignedUrl } from "@/lib/signed-url";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Library org (permintaan Brian 2026-08-11, referensi tab Library Suno):
// SATU tempat berisi semua video yang pernah dibuat organisasi ini, lintas
// kampanye — bukan cuma "kampanye terakhir" di beranda. Sebelumnya hasil hanya
// bisa ditemukan lewat halaman per-run, jadi video lama praktis hilang begitu
// run-nya turun dari daftar 5 terbaru.
//
// Org-scoped, bukan per-user: semua anggota org melihat isi yang sama (sesuai
// batas MVP F-ENT-01 — belum ada RBAC granular).

type Row = {
  job_id: string; state: string; product_name: string; created_at: string;
  format: string; duration_s: number; cost_actual_idr: number;
  bulk_run_id: string | null; video_url: string | null; caption: string | null;
  thumb_key: string | null; fail_meta: string | null;
};

// Alasan kegagalan hanya tersimpan di audit_log (jobs tidak punya kolomnya),
// jadi harus dibaca dari sana. `meta` bertipe TEXT, bukan jsonb, jadi tidak
// bisa dioperasikan dengan operator JSON di SQL — diurai di sini.
function failReason(metaJson: string | null): string | null {
  if (!metaJson) return null;
  try {
    const reason = (JSON.parse(metaJson) as { reason?: unknown }).reason;
    return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null;
  } catch { return null; }
}

/** Alasan teknis -> kalimat yang berguna buat brand.
 *
 * Sebagian alasan internal sudah berbahasa Indonesia dan layak tampil apa
 * adanya ("Kredit organisasi tidak cukup"). Sisanya adalah pesan error
 * provider dalam bahasa Inggris yang tidak berarti apa-apa bagi brand — untuk
 * itu yang penting bukan detail teknisnya, tapi APA YANG HARUS DILAKUKAN. */
function friendlyFailure(reason: string | null): string {
  if (!reason) return "Render gagal. Token sudah dikembalikan ke saldo.";
  const r = reason.toLowerCase();
  if (r.includes("kredit") || r.includes("token")) return reason;
  if (r.includes("antrean") || r.includes("queue")) return "Antrean render sedang bermasalah. Token dikembalikan — coba lagi.";
  if (r.includes("timeout") || r.includes("batas tunggu")) return "Render melebihi batas waktu. Token dikembalikan — coba lagi, biasanya berhasil.";
  if (r.includes("qc") || r.includes("kualitas")) return "Hasilnya tidak lolos pemeriksaan kualitas. Token dikembalikan — coba ganti foto produk yang lebih jelas.";
  if (r.includes("moderation") || r.includes("policy") || r.includes("content")) return "Ditolak moderasi AI. Token dikembalikan — coba turunkan level hook atau ganti foto.";
  return "Render gagal di sisi AI. Token sudah dikembalikan — coba lagi.";
}

const FILTERS = new Set(["all", "ready", "review", "failed"]);

/** Nama berkas unduhan: nama produk + nomor urut, bukan UUID. */
function downloadName(productName: string, idx: number): string {
  const base = productName.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-").slice(0, 50) || "video";
  return `${base}-${idx + 1}.mp4`;
}

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Library requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const url = new URL(req.url);
    const filterRaw = url.searchParams.get("filter") ?? "all";
    const filter = FILTERS.has(filterRaw) ? filterRaw : "all";

    const pool = getPool(config.databaseUrl);
    let rows: Row[];
    try {
      // thumb diambil dari scene PERTAMA (job_shots idx=0) kalau ada. Job yang
      // tidak lewat gerbang review tidak punya baris job_shots sama sekali —
      // itu bukan kesalahan, klien tinggal jatuh ke frame pertama video.
      const result = await pool.query<Row>(
        `SELECT j.id AS job_id, j.state, p.name AS product_name, j.created_at,
                j.format, j.duration_s, j.cost_actual_idr, j.bulk_run_id,
                o.video_url, o.caption,
                (SELECT sh.thumb_key FROM job_shots sh WHERE sh.job_id = j.id ORDER BY sh.idx ASC LIMIT 1) AS thumb_key,
                -- Memakai idx_audit_entity(entity, entity_id), jadi tetap murah
                -- walau audit_log besar. LIMIT 1 terbaru: satu job bisa punya
                -- beberapa transisi, yang relevan hanya yang terakhir.
                (SELECT a.meta FROM audit_log a
                   WHERE a.entity = 'jobs' AND a.entity_id = j.id
                     AND a.action = 'job.transition' AND a.meta LIKE '%"FAILED"%'
                   ORDER BY a.created_at DESC LIMIT 1) AS fail_meta
         FROM jobs j
         JOIN products p ON p.id = j.product_id
         LEFT JOIN outputs o ON o.job_id = j.id
         WHERE j.org_id = $1
         ORDER BY j.created_at DESC
         LIMIT 200`,
        [membership.org_id]
      );
      rows = result.rows;
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }

    const all = rows.map((row, i) => ({
      job_id: row.job_id,
      state: row.state,
      product_name: row.product_name,
      created_at: row.created_at,
      format: row.format,
      duration_s: row.duration_s,
      cost_idr: row.cost_actual_idr,
      run_id: row.bulk_run_id,
      caption: row.caption,
      video_url: row.state === "READY" && row.video_url ? createSignedUrl(row.video_url) : null,
      // URL unduh terpisah dari URL putar: yang ini membawa ?dl= supaya browser
      // MENYIMPAN berkas dengan nama produk, bukan membuka pemutar.
      download_url:
        row.state === "READY" && row.video_url
          ? `${createSignedUrl(row.video_url)}&dl=${encodeURIComponent(downloadName(row.product_name, i))}`
          : null,
      thumb_url: row.thumb_key ? createSignedUrl(row.thumb_key) : null,
      fail_reason:
        row.state === "FAILED" || row.state === "REFUNDED"
          ? friendlyFailure(failReason(row.fail_meta))
          : null,
    }));

    const counts = {
      all: all.length,
      ready: all.filter((v) => v.state === "READY").length,
      review: all.filter((v) => v.state === "AWAITING_APPROVAL").length,
      failed: all.filter((v) => v.state === "FAILED" || v.state === "REFUNDED").length,
    };
    const videos =
      filter === "ready" ? all.filter((v) => v.state === "READY")
      : filter === "review" ? all.filter((v) => v.state === "AWAITING_APPROVAL")
      : filter === "failed" ? all.filter((v) => v.state === "FAILED" || v.state === "REFUNDED")
      : all;

    return Response.json({ filter, counts, videos });
  } catch (err) {
    return errorResponse(err);
  }
}
