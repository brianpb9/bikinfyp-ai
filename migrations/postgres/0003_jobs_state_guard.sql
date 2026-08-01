-- Runtime transition guards remain conditional updates so concurrent workers
-- atomically contend on one row.  This database constraint rejects malformed
-- states even if a future caller bypasses the repository.
ALTER TABLE jobs
  ADD CONSTRAINT jobs_state_known_check
  CHECK (state IN ('DRAFT','QUEUED','GENERATING_VISUAL','GENERATING_VOICE','COMPOSITING','QC_CHECK','LABELING','READY','FAILED','REFUNDED'));
