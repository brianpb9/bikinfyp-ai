-- Gerbang persetujuan per-scene sebelum compositing (F-ENT-01 M11,
-- 2026-08-11). Brand sangat peduli gambar & pesan, jadi mereka harus bisa
-- melihat tiap scene (gambar + kalimat skrip + prompt) lalu menyetujui atau
-- minta generate ulang scene tertentu — baru video digabung.
--
-- HANYA untuk job dashboard brand. requires_approval default FALSE, dan
-- jalur retail TIDAK PERNAH menyalakannya — jadi perilaku retail (langsung
-- generate sampai jadi tanpa jeda) sama persis seperti sebelumnya.
ALTER TABLE jobs ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN approved_at TEXT;

-- Satu baris per shot. storage_key menunjuk ke storage DURABLE (R2 di
-- production), bukan disk lokal worker: brand bisa baru menyetujui berjam-jam
-- kemudian, saat container worker yang menghasilkannya sudah lama mati.
CREATE TABLE job_shots (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  idx INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  thumb_key TEXT,
  duration_sec DOUBLE PRECISION NOT NULL,
  -- Diminta generate ulang oleh brand. Web service TIDAK bisa mengerjakannya
  -- sendiri (tidak ada ffmpeg/kredensial provider di sana) — jadi route web
  -- cuma menyalakan flag ini lalu meng-enqueue ulang job; worker yang benar-
  -- benar generate ulang shot tersebut.
  regen_requested BOOLEAN NOT NULL DEFAULT FALSE,
  regen_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (job_id, idx)
);
CREATE INDEX idx_job_shots_job ON job_shots(job_id, idx);

-- State baru WAJIB didaftarkan ulang di constraint 0003_jobs_state_guard.
-- Tanpa ini worker gagal saat transisi ke AWAITING_APPROVAL ("violates check
-- constraint jobs_state_known_check"), job jadi FAILED, dan kredit brand
-- di-refund padahal rendernya sebenarnya sukses. Ketahuan saat verifikasi
-- lokal M11 — persis alasan constraint ini dibuat.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_state_known_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_state_known_check
  CHECK (state IN ('DRAFT','QUEUED','GENERATING_VISUAL','AWAITING_APPROVAL','GENERATING_VOICE','COMPOSITING','QC_CHECK','LABELING','READY','FAILED','REFUNDED'));
