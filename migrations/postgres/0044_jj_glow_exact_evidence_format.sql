-- Permit exactly one reviewed hands-only staging evidence contract without
-- weakening the existing talking-head contract for any ordinary job.
ALTER TABLE normal_representative_evidence_runs
  DROP CONSTRAINT IF EXISTS normal_representative_evidence_runs_format_check;

ALTER TABLE normal_representative_evidence_runs
  ADD CONSTRAINT normal_representative_evidence_runs_exact_format_check CHECK (
    (task_id='NORMAL-REPRESENTATIVE-EVIDENCE-GUARD-20260829' AND format='talking_head')
    OR
    (task_id='P0-JJ-GLOW-FINAL-RECOVERY-CANDIDATE-20260831'
      AND job_id='55284f20-efb8-4b18-8a24-f90fc91af733'
      AND user_id='ac8b0a3e-8835-4e64-80e6-2e2cae6198b8'
      AND product_id='c470390e-ad3d-4cc8-9ba2-4557691fa7a7'
      AND reference_sha256='744707593be97ac61673b03576e441bf1fd6793833830102cf2a2c9bdf8ae4c1'
      AND category='beauty' AND format='hands_only' AND duration_s=15)
  );
