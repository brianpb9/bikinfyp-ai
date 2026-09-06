-- STATUS "pending" UNTUK ORGANISASI — pendaftaran brand menunggu persetujuan.
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Keputusan Brian 6 Sep 2026: brand mendaftar sendiri di brand.aiugc.id, tapi
-- baru bisa masuk dashboard setelah disetujui admin. Sampai kini organisasi
-- hanya mengenal 'active' dan 'suspended', dan keduanya tidak berarti
-- "mendaftar, belum ditinjau".
--
-- ---------------------------------------------------------------------------
-- KENAPA TIDAK MEMAKAI 'suspended' SAJA
-- ---------------------------------------------------------------------------
-- Karena keduanya menghasilkan kalimat yang berbeda ke orang yang berbeda.
-- 'suspended' berarti "pernah aktif, lalu kami hentikan" — halaman
-- /dashboard/suspended menyuruh menghubungi kami untuk mengaktifkan LAGI.
-- Mengatakan itu kepada brand yang baru mendaftar lima menit lalu membuat
-- kesan mereka sudah melakukan kesalahan. Satu kolom yang menampung dua arti
-- juga membuat laporan "berapa brand yang menunggu ditinjau" mustahil dijawab.
--
-- Bawaan kolom TETAP 'active': organisasi yang dibuat lewat jalur lama (admin,
-- manual) tidak berubah perilakunya sama sekali. Hanya jalur pendaftaran
-- mandiri yang menulis 'pending' secara eksplisit.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('pending', 'active', 'suspended'));
