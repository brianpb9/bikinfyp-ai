-- PostgreSQL baseline for the staged SQLite -> PostgreSQL migration.
-- Timestamps remain ISO-8601 TEXT in this checkpoint to preserve current
-- SQLite runtime semantics; application routes are not switched yet.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  phone TEXT,
  email TEXT UNIQUE,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  locale TEXT NOT NULL DEFAULT 'id-ID',
  created_at TEXT NOT NULL
);

CREATE TABLE credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup','hold','capture','release','bonus')),
  job_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
-- PostgreSQL has no SQLite rowid. Future raw-pg reads must use this stable
-- order instead: ORDER BY created_at DESC, id DESC.
CREATE INDEX idx_ledger_user ON credit_ledger(user_id, created_at DESC, id DESC);
CREATE INDEX idx_ledger_job ON credit_ledger(job_id);

CREATE VIEW v_credit_balance AS
  SELECT user_id, COALESCE(SUM(delta), 0) AS balance
  FROM credit_ledger GROUP BY user_id;

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  gateway TEXT NOT NULL,
  gateway_ref TEXT UNIQUE NOT NULL,
  amount_idr INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_url TEXT,
  name TEXT NOT NULL,
  price_idr INTEGER NOT NULL,
  category TEXT NOT NULL,
  product_visual_desc TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  raw_meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_products_user ON products(user_id);

CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  creator_category TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  register TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_personas_user ON personas(user_id);

CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  product_id TEXT NOT NULL REFERENCES products(id),
  hook_family TEXT NOT NULL,
  emotion TEXT NOT NULL,
  register TEXT NOT NULL,
  segments TEXT NOT NULL,
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,
  validation_result TEXT NOT NULL,
  quality_tier TEXT NOT NULL DEFAULT 'silent_caption',
  approved_by_user_at TEXT,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_scripts_product ON scripts(product_id);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  persona_id TEXT REFERENCES personas(id),
  script_id TEXT NOT NULL REFERENCES scripts(id),
  format TEXT NOT NULL DEFAULT 'hands_only',
  quality_tier TEXT NOT NULL DEFAULT 'silent_caption',
  duration_s INTEGER NOT NULL DEFAULT 15,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  provider_video TEXT,
  provider_voice TEXT,
  cost_actual_idr INTEGER NOT NULL DEFAULT 0,
  qc_result TEXT,
  output_url TEXT,
  qc_retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  state_changed_at TEXT
);
CREATE INDEX idx_jobs_user ON jobs(user_id);
CREATE INDEX idx_jobs_state ON jobs(state);

CREATE TABLE outputs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  video_url TEXT NOT NULL,
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,
  suggested_post_time TEXT NOT NULL,
  compliance_checklist TEXT NOT NULL
);

CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_otp_email ON otp_codes(email, created_at);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
