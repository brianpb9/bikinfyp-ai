// Snapshot Skor FYP beku per job + laporan hasil posting (Step 4 loop /ingest).
//
// Kontrak anti-leakage (MODEL_FYP_1.0.md §10 + spec /ingest 2.2):
// - Snapshot dihitung SAAT JOB DIBUAT (pre-render, pre-posting) lalu BEKU —
//   tidak pernah dihitung ulang atau di-overwrite.
// - posted_url set-once: nilai berbeda ditolak, bukan ditimpa diam-diam.
// - outcome (views/orders) boleh di-update kapan pun (angka hasil menyusul).
// Data ini yang nanti diekspor ke /ingest model (scripts/export-fyp-ingest.ts)
// untuk validasi predicted-vs-actual bulanan.

import type BetterSqlite3 from "better-sqlite3";
import { ERR } from "./errors";
import { now } from "./db";
import { scoreScriptPlan, type FypQualityTier, type FypVideoFormat } from "./fyp-score";
import type { SegmentDraft } from "./script-engine/templates";
import type { HookCode } from "./config/hooks";

export interface FypSnapshotRow {
  job_id: string;
  script_id: string;
  model_version: string;
  score: number;
  raw_probability: number;
  features_json: string;
  created_at: string;
  posted_url: string | null;
  posted_at: string | null;
  outcome_json: string | null;
  outcome_updated_at: string | null;
}

/** Hitung + simpan snapshot beku untuk job baru. Idempoten (job_id PK, INSERT OR
 * IGNORE — job duplikat tidak menimpa snapshot pertama). Kegagalan scoring tidak
 * boleh menggagalkan pembuatan job — pemanggil membungkus try/catch. */
export function createFypSnapshot(
  db: BetterSqlite3.Database,
  input: {
    jobId: string;
    scriptId: string;
    hookFamily: string;
    segments: SegmentDraft[];
    qualityTier: FypQualityTier;
    durationSec: number;
    format: FypVideoFormat;
    productName: string;
    priceIdr: number;
  }
): { score: number; modelVersion: string } {
  const plan = scoreScriptPlan({
    hookFamily: input.hookFamily as HookCode,
    segments: input.segments,
    qualityTier: input.qualityTier,
    durationSec: input.durationSec,
    format: input.format,
    productName: input.productName,
    priceIdr: input.priceIdr,
  });
  db.prepare(
    `INSERT OR IGNORE INTO fyp_snapshots (job_id, script_id, model_version, score, raw_probability, features_json, created_at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(
    input.jobId,
    input.scriptId,
    plan.modelVersion,
    plan.score,
    plan.rawProbability,
    JSON.stringify(plan.featureValues),
    now()
  );
  return { score: plan.score, modelVersion: plan.modelVersion };
}

export interface FypReportInput {
  postedUrl: string;
  views?: number | null;
  orders?: number | null;
}

/** Terapkan laporan hasil dari user. posted_url beku setelah terisi; outcome upsert. */
export function applyFypReport(
  db: BetterSqlite3.Database,
  jobId: string,
  report: FypReportInput
): FypSnapshotRow {
  const row = db.prepare("SELECT * FROM fyp_snapshots WHERE job_id = ?").get(jobId) as FypSnapshotRow | undefined;
  if (!row) throw ERR.NOT_FOUND("Skor video ini");

  let url: URL;
  try {
    url = new URL(report.postedUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("non-http");
  } catch {
    throw ERR.BAD_REQUEST("Linknya belum valid — tempel link postingan lengkap ya (diawali https://).", "Invalid posted URL.");
  }
  if (row.posted_url && row.posted_url !== url.toString()) {
    throw ERR.BAD_REQUEST(
      "Link postingan untuk video ini sudah tercatat dan tidak bisa diganti (data pembanding harus beku). Kalau salah tempel, hubungi kami ya.",
      "posted_url is frozen once set."
    );
  }

  const clean = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  const prevOutcome = row.outcome_json ? (JSON.parse(row.outcome_json) as Record<string, number | null>) : {};
  const outcome = {
    views: clean(report.views) ?? prevOutcome.views ?? null,
    orders: clean(report.orders) ?? prevOutcome.orders ?? null,
  };
  const hasOutcome = outcome.views !== null || outcome.orders !== null;

  db.prepare(
    `UPDATE fyp_snapshots
     SET posted_url = COALESCE(posted_url, ?), posted_at = COALESCE(posted_at, ?),
         outcome_json = ?, outcome_updated_at = CASE WHEN ? THEN ? ELSE outcome_updated_at END
     WHERE job_id = ?`
  ).run(url.toString(), now(), hasOutcome ? JSON.stringify(outcome) : row.outcome_json, hasOutcome ? 1 : 0, now(), jobId);
  return db.prepare("SELECT * FROM fyp_snapshots WHERE job_id = ?").get(jobId) as FypSnapshotRow;
}
