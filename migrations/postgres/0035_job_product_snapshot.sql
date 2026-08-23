-- P0 C9 — immutable product metadata/prompt truth per job.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_product_snapshot TEXT;
