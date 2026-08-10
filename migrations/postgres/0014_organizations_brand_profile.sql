-- Profil bisnis brand (F-ENT-01 M7, 2026-08-11) — hasil "analisa bisnis"
-- (paste website -> AI baca -> auto-isi). Semua nullable murni tambahan:
-- org tanpa profil (belum pernah jalanin analisa) tetap valid, kolom ini
-- cuma dibaca untuk ditampilkan, tidak pernah jadi syarat akses dashboard.
ALTER TABLE organizations ADD COLUMN website_url TEXT;
ALTER TABLE organizations ADD COLUMN business_type TEXT;
ALTER TABLE organizations ADD COLUMN category TEXT;
ALTER TABLE organizations ADD COLUMN audience TEXT;
ALTER TABLE organizations ADD COLUMN elevator_pitch TEXT;
