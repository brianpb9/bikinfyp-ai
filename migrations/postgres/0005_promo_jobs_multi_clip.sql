-- Video Promosi stage 3: N user-uploaded clips per job (was hardcoded to 1).
-- promo_jobs only holds prototype test data (no real users yet), so this
-- migrates the column in place rather than carrying dead legacy shape.
ALTER TABLE promo_jobs ADD COLUMN uploaded_clip_urls TEXT;
UPDATE promo_jobs SET uploaded_clip_urls = '["' || uploaded_clip_url || '"]';
ALTER TABLE promo_jobs ALTER COLUMN uploaded_clip_urls SET NOT NULL;
ALTER TABLE promo_jobs DROP COLUMN uploaded_clip_url;
