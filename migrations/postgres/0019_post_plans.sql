-- Rencana posting (2026-08-11).
--
-- BUKAN penjadwal yang mem-posting sendiri. Posting otomatis butuh Content
-- Posting API TikTok/Instagram: OAuth per akun, peninjauan aplikasi oleh
-- platform, dan penyimpanan token — tidak satu pun tersedia sekarang. Tabel
-- ini menyimpan RENCANA: video mana, ke kanal mana, kapan, dengan caption apa,
-- dan apakah sudah diposting. Brand tetap mengunggah sendiri.
--
-- Dibuat sebagai lapisan yang benar sejak awal supaya saat izin platform
-- turun, yang ditambahkan hanya pengeksekusi — bukan model datanya.
CREATE TABLE IF NOT EXISTS post_plans (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  -- Kanal disimpan sebagai teks bebas terbatas, bukan enum: menambah kanal
  -- baru tidak boleh memerlukan migrasi.
  channel TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','posted','skipped')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_post_plans_org ON post_plans(org_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_post_plans_job ON post_plans(job_id);
