-- RACUN.AI — Skema database (SRS §5)
-- SQLite (better-sqlite3). credit_ledger APPEND-ONLY: saldo = agregat ledger,
-- tidak pernah UPDATE saldo langsung.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT,          -- BUKAN identifier login (legacy/dev-login); nullable
  email TEXT UNIQUE,   -- identifier utama (OTP email via Resend)
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  locale TEXT NOT NULL DEFAULT 'id-ID',
  created_at TEXT NOT NULL
);

-- credit_ledger: append-only. delta>0 menambah, delta<0 menahan/memotong.
-- type: topup | hold | capture | release | bonus
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  delta INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup','hold','capture','release','bonus')),
  job_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON credit_ledger(job_id);

-- Saldo = agregat ledger (view, bukan tabel yang di-update)
CREATE VIEW IF NOT EXISTS v_credit_balance AS
  SELECT user_id, COALESCE(SUM(delta), 0) AS balance
  FROM credit_ledger GROUP BY user_id;

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  gateway TEXT NOT NULL,
  gateway_ref TEXT UNIQUE NOT NULL, -- idempotensi webhook (BR-10.3)
  amount_idr INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_url TEXT,
  name TEXT NOT NULL,
  price_idr INTEGER NOT NULL,
  category TEXT NOT NULL,
  product_visual_desc TEXT, -- deskripsi visual produk dari user (konsistensi identitas shot)
  images TEXT NOT NULL DEFAULT '[]', -- JSON array path relatif storage
  raw_meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  creator_category TEXT NOT NULL, -- hijaber | lokal | chindo | genz | ibu | daerah | pria
  voice_id TEXT NOT NULL,
  register TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personas_user ON personas(user_id);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  job_id TEXT, -- diisi setelah job dibuat (nullable)
  product_id TEXT NOT NULL REFERENCES products(id),
  hook_family TEXT NOT NULL,
  emotion TEXT NOT NULL,
  register TEXT NOT NULL,
  segments TEXT NOT NULL,   -- JSON array segmen
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,   -- JSON array
  validation_result TEXT NOT NULL, -- JSON
  quality_tier TEXT NOT NULL DEFAULT 'silent_caption', -- silent_caption | high_quality | super_hq
  approved_by_user_at TEXT, -- NULL = belum melewati gerbang HITL
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scripts_product ON scripts(product_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  persona_id TEXT REFERENCES personas(id),
  script_id TEXT NOT NULL REFERENCES scripts(id),
  format TEXT NOT NULL DEFAULT 'hands_only',
  quality_tier TEXT NOT NULL DEFAULT 'silent_caption', -- silent_caption | high_quality | super_hq
  duration_s INTEGER NOT NULL DEFAULT 15,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  provider_video TEXT,
  provider_voice TEXT,
  cost_actual_idr INTEGER NOT NULL DEFAULT 0,
  qc_result TEXT, -- JSON
  output_url TEXT,
  qc_retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  state_changed_at TEXT -- kapan state terakhir berubah (untuk timeout per-state)
);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);

CREATE TABLE IF NOT EXISTS outputs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  video_url TEXT NOT NULL,      -- path relatif storage (disajikan via signed URL)
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,       -- JSON array
  suggested_post_time TEXT NOT NULL,
  compliance_checklist TEXT NOT NULL -- JSON array
);

-- Kode OTP login email: yang disimpan HANYA hash (sha256+salt), bukan kode mentah.
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta TEXT, -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
