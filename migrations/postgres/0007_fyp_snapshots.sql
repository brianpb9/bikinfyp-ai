-- Snapshot Skor FYP beku per job (MODEL FYP 1.0, lihat lib/fyp-snapshot.ts).
-- Prediksi dihitung pre-render dan dibekukan (anti-leakage predicted-vs-actual);
-- posted_url set-once, outcome_json boleh di-update.
-- Ditulis oleh pgSaveFypSnapshot/pgApplyFypReport (lib/postgres/smoke-runtime.ts).
CREATE TABLE IF NOT EXISTS fyp_snapshots (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  script_id TEXT NOT NULL REFERENCES scripts(id),
  model_version TEXT NOT NULL,
  score INTEGER NOT NULL,
  raw_probability DOUBLE PRECISION NOT NULL,
  features_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  posted_url TEXT,
  posted_at TEXT,
  outcome_json TEXT,
  outcome_updated_at TEXT
);
