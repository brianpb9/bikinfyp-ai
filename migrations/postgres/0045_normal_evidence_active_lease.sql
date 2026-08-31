-- A queued authoritative evidence run is intentionally held while operators
-- freeze metadata/deploy the reviewed worker. The generic QUEUED timeout must
-- distinguish that bounded lifecycle from a genuinely abandoned job.
ALTER TABLE normal_representative_evidence_runs
  ADD COLUMN IF NOT EXISTS lease_kind TEXT,
  ADD COLUMN IF NOT EXISTS lease_last_progress_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

ALTER TABLE normal_representative_evidence_runs
  DROP CONSTRAINT IF EXISTS normal_evidence_active_lease_complete;

ALTER TABLE normal_representative_evidence_runs
  ADD CONSTRAINT normal_evidence_active_lease_complete CHECK (
    (lease_kind IS NULL AND lease_last_progress_at IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_kind='ACTIVE_EVIDENCE_LEASE'
      AND lease_last_progress_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > lease_last_progress_at)
  );

CREATE INDEX IF NOT EXISTS idx_normal_evidence_active_lease
  ON normal_representative_evidence_runs(job_id, lease_expires_at)
  WHERE lease_kind='ACTIVE_EVIDENCE_LEASE';
