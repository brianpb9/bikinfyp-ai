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

-- Organisasi (2026-08-11, dashboard enterprise/brand — F-ENT-01): konsep
-- MINIMAL, aditif murni. org_id di tabel lain SELALU nullable — NULL berarti
-- retail (perilaku lama, tidak berubah selamanya). role di org_members
-- HANYA label ("siapa dihubungi"), TIDAK PERNAH dicek untuk otorisasi di MVP
-- ini — RBAC granular sengaja ditunda ke v2.
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at TEXT NOT NULL,
  -- Profil bisnis (M7, F-ENT-01): hasil "analisa bisnis" (paste website -> AI
  -- baca -> auto-isi). Semua nullable — org tanpa profil tetap valid.
  website_url TEXT,
  business_type TEXT,
  category TEXT,
  audience TEXT,
  elevator_pitch TEXT,
  -- Penanda onboarding selesai (termasuk saat sengaja dilewati). Lihat
  -- migrations/postgres/0018_org_onboarded.sql.
  onboarded_at TEXT,
  brand_logo_key TEXT,
  brand_color TEXT,
  brand_tagline TEXT
);

CREATE TABLE IF NOT EXISTS org_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

-- credit_ledger: append-only. delta>0 menambah, delta<0 menahan/memotong.
-- type: topup | hold | capture | release | bonus
-- org_id (2026-08-11): wallet terpisah milik organisasi, dipakai dashboard
-- enterprise. user_id TETAP wajib diisi di baris org (jejak audit "siapa
-- yang belanja"); saldo org = SUM(delta) WHERE org_id=X, saldo retail tetap
-- SUM(delta) WHERE user_id=X AND org_id IS NULL — baris retail lama tidak
-- pernah punya org_id, jadi query lama tetap benar tanpa perubahan.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id TEXT REFERENCES organizations(id),
  delta INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('topup','hold','capture','release','bonus')),
  job_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON credit_ledger(job_id);
CREATE INDEX IF NOT EXISTS idx_ledger_org ON credit_ledger(org_id, created_at DESC);

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
  org_id TEXT REFERENCES organizations(id), -- non-NULL = dibuat lewat dashboard enterprise (bulk-generate)
  source_url TEXT,
  name TEXT NOT NULL,
  price_idr INTEGER NOT NULL,
  category TEXT NOT NULL,
  product_visual_desc TEXT, -- deskripsi visual produk dari user (konsistensi identitas shot)
  brand_brief TEXT, -- M8: arahan kreatif bebas dari brand (beda dari visual_desc di atas)
  claims TEXT, -- JSON array klaim singkat untuk overlay teks (ditulis brand, bukan AI)
  images TEXT NOT NULL DEFAULT '[]', -- JSON array path relatif storage
  -- Add-on Promo & Urgency (opsional semua; lihat lib/promo.ts):
  promo_price_before_idr INTEGER, -- harga normal sebelum diskon (harga coret)
  promo_ends_at TEXT,             -- ISO date/datetime; lewat = promo di-drop saat dipakai
  promo_stock_left INTEGER,       -- stok tersisa (klaim user, urgensi jujur)
  raw_meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_org ON products(org_id);

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
  hook_level TEXT NOT NULL DEFAULT 'normal', -- normal | berani | gila (S3; gila = visual pattern-interrupt)
  approved_by_user_at TEXT, -- NULL = belum melewati gerbang HITL
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scripts_product ON scripts(product_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  org_id TEXT REFERENCES organizations(id), -- non-NULL = dibuat lewat dashboard enterprise (bulk-generate)
  bulk_run_id TEXT, -- tag N job dari satu submit bulk-generate (bukan tabel baru — cukup ini)
  avatar_custom_desc TEXT, -- M8: deskripsi avatar upload sendiri (teks hasil Gemini vision, bukan foto)
  shot_count INTEGER,
  no_model INTEGER,
  ratio TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0, -- M11: jeda approval per-scene (dashboard brand saja)
  approved_at TEXT,
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
CREATE INDEX IF NOT EXISTS idx_jobs_org ON jobs(org_id, state);
CREATE INDEX IF NOT EXISTS idx_jobs_bulk_run ON jobs(org_id, bulk_run_id);

-- M11: satu baris per shot, untuk layar review scene brand.
CREATE TABLE IF NOT EXISTS job_shots (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  idx INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  duration_sec REAL NOT NULL,
  regen_requested INTEGER NOT NULL DEFAULT 0,
  regen_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_job_shots_job ON job_shots(job_id, idx);

CREATE TABLE IF NOT EXISTS outputs (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  video_url TEXT NOT NULL,      -- path relatif storage (disajikan via signed URL)
  caption TEXT NOT NULL,
  hashtags TEXT NOT NULL,       -- JSON array
  suggested_post_time TEXT NOT NULL,
  compliance_checklist TEXT NOT NULL -- JSON array
);

-- Snapshot Skor FYP BEKU per job (MODEL FYP 1.0) — dihitung saat job dibuat,
-- SEBELUM render/posting, dan tidak pernah diubah (anti-leakage: predicted-vs-
-- actual butuh prediksi yang dibekukan pre-posting). posted_url set-once;
-- outcome_json boleh di-update (angka hasil menyusul).
CREATE TABLE IF NOT EXISTS fyp_snapshots (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  script_id TEXT NOT NULL REFERENCES scripts(id),
  model_version TEXT NOT NULL,
  score INTEGER NOT NULL,
  raw_probability REAL NOT NULL,
  features_json TEXT NOT NULL,  -- nilai fitur mentah yang diskor (audit + /ingest)
  created_at TEXT NOT NULL,
  posted_url TEXT,              -- link postingan user; BEKU setelah terisi
  posted_at TEXT,
  outcome_json TEXT,            -- {views, orders, ...} — boleh di-update
  outcome_updated_at TEXT
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

-- Event funnel produk (2026-08-06): melengkapi audit_log (milestone server-side)
-- dengan kejadian CLIENT-SIDE pra-login (landing, /coba, signup) — tanpa ini
-- klaim "aktivasi naik X%" tidak pernah bisa dibuktikan. Nama event whitelist
-- di app/api/events; anon_id = cookie acak, BUKAN identitas.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  anon_id TEXT,
  name TEXT NOT NULL,
  meta TEXT, -- JSON kecil
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name_time ON events(name, created_at);

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

-- Rencana posting (mirror migrations/postgres/0019_post_plans.sql).
CREATE TABLE IF NOT EXISTS post_plans (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','posted','skipped')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_post_plans_org ON post_plans(org_id, scheduled_at);

-- Template milik brand (mirror migrations/postgres/0020_org_templates.sql).
CREATE TABLE IF NOT EXISTS org_templates (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  quality_tier TEXT NOT NULL,
  hook_level TEXT NOT NULL,
  hook_family TEXT,
  variant_count INTEGER NOT NULL,
  creator_category TEXT,
  avatar_gender TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_templates_org ON org_templates(org_id, created_at DESC);

-- Ingatan task provider (mirror migrations/postgres/0021_provider_tasks.sql).
CREATE TABLE IF NOT EXISTS provider_tasks (
  job_id TEXT NOT NULL,
  shot_index INTEGER NOT NULL,
  provider TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, shot_index, provider)
);
