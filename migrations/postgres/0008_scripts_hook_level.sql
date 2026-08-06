-- Level hook pilihan user (S3): normal | berani | gila.
-- gila juga mengubah prompt visual shot 1 (pattern-interrupt product-safe).
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS hook_level TEXT NOT NULL DEFAULT 'normal';
