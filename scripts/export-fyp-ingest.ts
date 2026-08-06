// Ekspor snapshot Skor FYP + hasil lapor user ke format POST /v1/ingest
// MODEL FYP 1.0 (SPEC_METER_API_V1.md §2) — untuk validasi predicted-vs-actual.
//
// Pakai: npx tsx scripts/export-fyp-ingest.ts > ingest-YYYYMMDD.json
// Hanya baris yang SUDAH dilaporkan diposting (posted_url terisi) yang diekspor.
// Tanpa PII: tidak ada user_id/email di output.
import { getDb } from "../lib/db";
import type { FypSnapshotRow } from "../lib/fyp-snapshot";

const rows = getDb()
  .prepare("SELECT * FROM fyp_snapshots WHERE posted_url IS NOT NULL ORDER BY created_at")
  .all() as FypSnapshotRow[];

const payloads = rows.map((r) => {
  const outcome = r.outcome_json ? (JSON.parse(r.outcome_json) as { views?: number | null; orders?: number | null }) : {};
  return {
    content_id: `bikinfyp:${r.job_id}`,
    video_ref: r.posted_url,
    platform: "tiktok",
    publish_date: r.posted_at,
    gate_bypassed: false, // BikinFYP tidak memakai skor sebagai gate — semua video lolos
    predicted: { score: r.score, model_version: r.model_version, score_timestamp: r.created_at },
    outcome: { views: outcome.views ?? null, gmv_actual: null, gmv_est: null },
    // Ekstensi BikinFYP (lihat BRIEF_DARI_BIKINFYP_UNTUK_FYP_MODEL.md §3):
    content_origin: "ai_generated",
    orders_reported: outcome.orders ?? null,
    features: JSON.parse(r.features_json),
  };
});

console.log(JSON.stringify(payloads, null, 1));
console.error(`${payloads.length} baris siap /ingest (dari ${getDb().prepare("SELECT COUNT(*) c FROM fyp_snapshots").get() ? (getDb().prepare("SELECT COUNT(*) c FROM fyp_snapshots").get() as { c: number }).c : 0} snapshot total)`);
