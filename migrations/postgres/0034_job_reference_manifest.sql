-- P0 A6/C1/C9 — immutable approved-reference identity per job.
-- TEXT stores a versioned ordered JSON manifest: [{rel,sha256,versiBukti}].
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS approved_reference_manifest TEXT;
