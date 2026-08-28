-- Ikat task provider sementara ke body request persis yang membuatnya.
-- NULL dipertahankan untuk task pra-migrasi agar retry tidak membakar biaya
-- ganda; baris legacy tersebut sengaja tidak dapat disertifikasi oleh audit.
ALTER TABLE provider_tasks ADD COLUMN IF NOT EXISTS payload_sha256 TEXT;
ALTER TABLE provider_tasks DROP CONSTRAINT IF EXISTS provider_tasks_payload_sha256_format;
ALTER TABLE provider_tasks ADD CONSTRAINT provider_tasks_payload_sha256_format
  CHECK (payload_sha256 IS NULL OR payload_sha256 ~ '^[0-9a-f]{64}$');
