-- Arsip prompt: apa yang BENAR-BENAR dikirim ke penyedia video, per job.
--
-- Sampai sekarang tidak ada. Untuk job retail hanya spec overlay yang
-- tersimpan, dan kolom job_shots.prompt cuma terisi di jalur review Enterprise
-- — kolom itu pun menuntut storage_key NOT NULL, jadi ia terikat klip yang
-- SUDAH jadi dan tidak bisa mengarsipkan rencana sebelum render.
--
-- Akibatnya: kalau sebuah video keluar jelek, tidak ada cara membuktikan
-- prompt apa yang menghasilkannya. Setiap diskusi mutu jadi soal ingatan.
-- Tidak ada langkah perbaikan naskah yang bisa dibuktikan tanpa ini, karena
-- pembandingnya tidak pernah disimpan.
--
-- Ditulis SEBELUM panggilan penyedia, supaya job yang GAGAL pun meninggalkan
-- jejak — justru itu yang paling sering perlu dibedah.
--
-- Kolom ide_* disiapkan sekarang meski Idea Stage belum ada (PATCH 4 STEP 3),
-- supaya menambahkannya nanti tidak menuntut migrasi kedua di jalur yang sama.
CREATE TABLE IF NOT EXISTS job_prompts (
  job_id          TEXT PRIMARY KEY REFERENCES jobs(id),
  -- shots[]: { idx, durationSec, prompt, imageRefPath, referenceMode }
  spec_json       TEXT NOT NULL,
  -- segmen naskah yang menghasilkannya — pasangan untuk membaca prompt
  segments_json   TEXT NOT NULL,
  negative_prompt TEXT NOT NULL,
  -- ratio, generateAudio, qualityTier, format, maxPeople, jumlah referensi
  model_params    TEXT NOT NULL,
  ide_id          TEXT,
  ide_skor        INTEGER,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_prompts_dibuat ON job_prompts(created_at DESC);
