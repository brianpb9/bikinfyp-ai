-- Private capture is allowed while independent redaction review is pending.
-- A later verified state remains fail-closed: it requires a non-empty
-- attestation explicitly bound to the exact captured artifact digest.
ALTER TABLE normal_representative_evidence_runs
  ADD COLUMN redaction_attestation_json TEXT,
  ADD COLUMN redaction_attested_artifact_sha256 TEXT
    CHECK (redaction_attested_artifact_sha256 IS NULL OR redaction_attested_artifact_sha256 ~ '^[0-9a-f]{64}$');

DO $$
DECLARE
  old_constraint NAME;
BEGIN
  SELECT conname INTO old_constraint
  FROM pg_constraint
  WHERE conrelid = 'normal_representative_evidence_runs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%CAPTURED_NO_PUBLICATION%'
    AND pg_get_constraintdef(oid) LIKE '%redaction_verified%';
  IF old_constraint IS NULL THEN
    RAISE EXCEPTION '0042 capture/redaction constraint not found';
  END IF;
  EXECUTE format('ALTER TABLE normal_representative_evidence_runs DROP CONSTRAINT %I', old_constraint);
END $$;

ALTER TABLE normal_representative_evidence_runs
  ADD CONSTRAINT normal_evidence_private_capture_complete CHECK (
    state <> 'CAPTURED_NO_PUBLICATION' OR (
      artifact_key IS NOT NULL
      AND retrieval_sha256 IS NOT NULL
      AND qc_json IS NOT NULL
      AND correlation_json IS NOT NULL
    )
  ),
  ADD CONSTRAINT normal_evidence_redaction_verification_attested CHECK (
    NOT redaction_verified OR (
      state = 'CAPTURED_NO_PUBLICATION'
      AND redaction_attestation_json IS NOT NULL
      AND length(trim(redaction_attestation_json)) > 0
      AND redaction_attested_artifact_sha256 IS NOT NULL
      AND redaction_attested_artifact_sha256 = retrieval_sha256
    )
  );
