-- Add-on Promo & Urgency (lib/promo.ts) — semua opsional, urgensi jujur dari
-- data user; promo kedaluwarsa di-drop saat dipakai, tidak pernah memblokir.
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_price_before_idr INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_ends_at TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_stock_left INTEGER;
