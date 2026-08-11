-- Rute TVC (2026-08-11). Dua template Brian menempuh jalan berbeda:
--   luxury   ("THE DROP")   — makro, mekanisme, keindahan bahan
--   reallife ("SEHARIAN")   — sehari penuh, ancaman nyata, produk bertahan
-- NULL = luxury (perilaku lama).
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tvc_route TEXT;
