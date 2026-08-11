-- Brand kit organisasi (2026-08-11). Dari analisis referensi TVC Brian
-- (Logitech, Charlotte Tilbury): keduanya ditutup layar brand, dan itulah yang
-- membedakan "klip" dari "iklan".
--
-- Semua nullable: brand tanpa brand kit tetap sah, videonya keluar tanpa
-- endcard persis seperti hari ini.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_logo_key TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_tagline TEXT;
