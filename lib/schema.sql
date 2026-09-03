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
  -- Kategori dalam kosakata internal (bestFor di lib/templates.ts) — kunci
  -- untuk menghitung "Pendekatan konten". Lihat 0028_org_product_category.sql.
  product_category TEXT,
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
  -- 'regen' = biaya regenerate scene. Sengaja BUKAN 'capture': ia memotong
  -- saldo tapi tidak menutup job induknya. Lihat migrations/postgres/0030.
  type TEXT NOT NULL CHECK (type IN ('topup','hold','capture','release','bonus','regen')),
  job_id TEXT,
  payment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON credit_ledger(job_id);
-- Satu job = satu catatan terminal (capture ATAU release), ditegakkan database.
-- Padanan migrations/postgres/0030 — alasan lengkapnya ada di sana. Ringkasnya:
-- penjagaan lewat pembacaan "NOT EXISTS" di kode terbukti bisa dilewati dua
-- proses yang berjalan bersamaan, dan yang bocor lewat celah itu adalah UANG.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ledger_terminal_per_job
  ON credit_ledger(job_id) WHERE type IN ('capture','release');
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
  created_at TEXT NOT NULL,
  -- Pesanan tahu dirinya pesanan apa. Tanpa ini, callback pembayaran harus
  -- MENEBAK apakah yang dibeli paket atau kredit satuan — dan tebakan yang
  -- salah berarti orang membayar paket lalu menerima kredit satuan.
  -- 'campuran' = paket bulanan DAN kredit satuan dalam satu invoice. Callback
  -- tidak perlu menebak: paket ada di paket_id, satuan ada di pesanan_item.
  jenis_pesanan TEXT NOT NULL DEFAULT 'saldo'
    CHECK (jenis_pesanan IN ('saldo','topup_video','langganan','campuran')),
  paket_id TEXT
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
  hook_level TEXT NOT NULL DEFAULT 'normal', -- lima level, lihat HOOK_LEVELS di lib/config/hooks.ts
                                             -- (normal | agak_berani | berani | agak_gila | gila).
                                             -- Sengaja tanpa CHECK: baris lama tiga-level tetap terbaca.
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
  tvc_route TEXT,
  template_id TEXT, -- template UGC affiliate; NULL = beat generik (lihat 0027)
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

-- Arsip prompt penyedia. Padanan migrations/postgres/0032 — alasan lengkapnya
-- di sana. Ringkasnya: tanpa ini, video jelek tidak bisa dibedah karena prompt
-- yang menghasilkannya tidak pernah disimpan di mana pun.
CREATE TABLE IF NOT EXISTS job_prompts (
  job_id          TEXT PRIMARY KEY REFERENCES jobs(id),
  spec_json       TEXT NOT NULL,
  segments_json   TEXT NOT NULL,
  negative_prompt TEXT NOT NULL,
  model_params    TEXT NOT NULL,
  ide_id          TEXT,
  ide_skor        INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_prompts_dibuat ON job_prompts(created_at DESC);

-- catatan: jobs.record_style ditambahkan lewat migrasi ringan di lib/db.ts
-- (padanan migrations/postgres/0029_jobs_record_style.sql).
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


-- ─────────────────────────────────────────────────────────────────────────────
-- KREDIT PER JENIS VIDEO (cermin migrations/postgres/0035)
-- ─────────────────────────────────────────────────────────────────────────────
-- Alasan lengkap tiap pagar ada di berkas migrasi itu. Ringkasnya: yang
-- dihitung adalah JATAH VIDEO per jenis, dengan dua ember yang aturannya
-- berbeda — 'langganan' habis saat masa berlakunya berakhir, 'topup' tidak
-- pernah hangus — dan pemakaian selalu menghabiskan ember langganan lebih
-- dulu supaya jatah yang akan hangus tidak mengendap.

CREATE TABLE IF NOT EXISTS harga_kredit_video (
  jenis TEXT PRIMARY KEY CHECK (jenis IN ('standard','premium','ultra')),
  harga_idr INTEGER NOT NULL CHECK (harga_idr > 0),
  aktif INTEGER NOT NULL DEFAULT 1,
  diubah_oleh TEXT,
  diubah_pada TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paket_langganan (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  keterangan TEXT NOT NULL DEFAULT '',
  harga_idr INTEGER NOT NULL CHECK (harga_idr > 0),
  kuota_standard INTEGER NOT NULL DEFAULT 0 CHECK (kuota_standard >= 0),
  kuota_premium INTEGER NOT NULL DEFAULT 0 CHECK (kuota_premium >= 0),
  kuota_ultra INTEGER NOT NULL DEFAULT 0 CHECK (kuota_ultra >= 0),
  masa_hari INTEGER NOT NULL DEFAULT 30 CHECK (masa_hari > 0),
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif INTEGER NOT NULL DEFAULT 1,
  dibuat_pada TEXT NOT NULL,
  diubah_pada TEXT NOT NULL,
  CHECK (kuota_standard + kuota_premium + kuota_ultra > 0)
);

-- Kuota DISALIN saat membeli, tidak dibaca ulang dari paket_langganan: kalau
-- admin mengubah isi paket bulan depan, yang sudah membeli tidak ikut berubah.
CREATE TABLE IF NOT EXISTS langganan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  paket_id TEXT NOT NULL,
  paket_nama TEXT NOT NULL,
  harga_idr INTEGER NOT NULL,
  kuota_standard INTEGER NOT NULL DEFAULT 0,
  kuota_premium INTEGER NOT NULL DEFAULT 0,
  kuota_ultra INTEGER NOT NULL DEFAULT 0,
  mulai_pada TEXT NOT NULL,
  berakhir_pada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dibatalkan')),
  payment_id TEXT,
  dibuat_pada TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_langganan_user ON langganan(user_id, berakhir_pada DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_langganan_payment ON langganan(payment_id) WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS kredit_video (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  jenis TEXT NOT NULL CHECK (jenis IN ('standard','premium','ultra')),
  ember TEXT NOT NULL CHECK (ember IN ('langganan','topup')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  tipe TEXT NOT NULL CHECK (tipe IN ('beli','bonus','pakai','kembali','koreksi')),
  langganan_id TEXT REFERENCES langganan(id),
  job_id TEXT,
  payment_id TEXT,
  catatan TEXT,
  dibuat_pada TEXT NOT NULL,
  CHECK (ember <> 'langganan' OR langganan_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_kredit_video_user ON kredit_video(user_id, jenis, ember);
CREATE INDEX IF NOT EXISTS idx_kredit_video_langganan ON kredit_video(langganan_id);
CREATE INDEX IF NOT EXISTS idx_kredit_video_job ON kredit_video(job_id);
-- Satu job = satu pemakaian dan satu pengembalian, ditegakkan database — pagar
-- yang sama dengan uniq_ledger_terminal_per_job di dompet rupiah.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kredit_pakai_per_job ON kredit_video(job_id) WHERE tipe = 'pakai';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kredit_kembali_per_job ON kredit_video(job_id) WHERE tipe = 'kembali';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kredit_beli_per_payment ON kredit_video(payment_id, jenis) WHERE tipe = 'beli';

-- Harga satuan DISALIN saat pesanan dibuat: kalau admin menaikkan harga
-- sementara ada invoice yang belum dibayar, yang berlaku tetap harga saat
-- pembeli menekan tombol.
CREATE TABLE IF NOT EXISTS pesanan_item (
  payment_id TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('standard','premium','ultra')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  harga_satuan_idr INTEGER NOT NULL CHECK (harga_satuan_idr > 0),
  PRIMARY KEY (payment_id, jenis)
);

-- Perpanjangan langganan (cermin migrations/postgres/0037). Alasan lengkapnya
-- ada di berkas migrasi itu. Ringkasnya: membeli paket yang SAMA menambah masa
-- dan kuota pada periode yang ada, dan kunci primer di payment_id memastikan
-- satu pembayaran hanya bisa memperpanjang SEKALI — penjagaan yang tadinya
-- dipegang uniq_langganan_payment, yang tidak lagi berlaku saat tidak ada
-- baris langganan baru yang lahir.
CREATE TABLE IF NOT EXISTS langganan_perpanjangan (
  payment_id TEXT PRIMARY KEY,
  langganan_id TEXT NOT NULL REFERENCES langganan(id),
  paket_id TEXT NOT NULL,
  kuota_standard INTEGER NOT NULL DEFAULT 0,
  kuota_premium INTEGER NOT NULL DEFAULT 0,
  kuota_ultra INTEGER NOT NULL DEFAULT 0,
  hari INTEGER NOT NULL,
  berakhir_sebelum TEXT NOT NULL,
  berakhir_sesudah TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perpanjangan_langganan ON langganan_perpanjangan(langganan_id);
