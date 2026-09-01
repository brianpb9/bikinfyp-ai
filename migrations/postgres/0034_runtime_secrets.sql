-- Kredensial partner yang bisa diganti dari dashboard, TANPA restart service.
--
-- Nilainya DISIMPAN TERENKRIPSI (AES-256-GCM, kunci diturunkan dari
-- AUTH_SECRET lewat HKDF — pola yang sama dengan kunci URL media dan hash
-- OTP). Alasannya: tabel ini akan ikut dalam setiap pg_dump, dan dump biasa
-- berpindah lewat jalur yang jauh lebih longgar daripada .env server.
--
-- env TETAP jadi cadangan. Baris yang tidak ada di sini berarti "pakai yang
-- dari .env" — jadi memasang tabel ini tidak pernah mematikan konfigurasi
-- yang sudah berjalan.
CREATE TABLE IF NOT EXISTS runtime_secrets (
  name       TEXT PRIMARY KEY,
  value_enc  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
