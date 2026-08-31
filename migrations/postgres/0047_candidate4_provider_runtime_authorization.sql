CREATE TABLE IF NOT EXISTS normal_evidence_runtime_authorizations (
  job_id TEXT PRIMARY KEY REFERENCES normal_representative_evidence_runs(job_id) ON DELETE RESTRICT,
  evidence_task_id TEXT NOT NULL,
  activation_deploy_sha TEXT NOT NULL CHECK (activation_deploy_sha ~ '^[0-9a-f]{40}$'),
  provider_runtime_sha TEXT NOT NULL CHECK (provider_runtime_sha ~ '^[0-9a-f]{40}$'),
  database_binding_sha256 TEXT NOT NULL CHECK (database_binding_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_task_id TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT normal_evidence_runtime_authorization_candidate4_exact CHECK (
    job_id='2c49a5c8-9465-4400-a214-159336a2c097'
    AND evidence_task_id='FINAL-POST-SWEEP-CANDIDATE-4-20260901'
    AND activation_deploy_sha='13c22bc7a3a340f0ea5f4bb0db9a905691676c77'
    AND database_binding_sha256='f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610'
    AND authorization_task_id='FINAL-POST-SWEEP-CANDIDATE-4-R3-20260901'
    AND authorized_by='ac8b0a3e-8835-4e64-80e6-2e2cae6198b8'
    AND provider_runtime_sha<>activation_deploy_sha
  )
);

CREATE OR REPLACE FUNCTION reject_normal_evidence_runtime_authorization_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'normal evidence runtime authorization is append-only' USING ERRCODE='23514';
END;
$$;

CREATE OR REPLACE FUNCTION validate_normal_evidence_runtime_authorization_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE evidence normal_representative_evidence_runs%ROWTYPE;
BEGIN
  SELECT * INTO evidence FROM normal_representative_evidence_runs WHERE job_id=NEW.job_id FOR UPDATE;
  IF NOT FOUND OR evidence.task_id<>NEW.evidence_task_id
      OR evidence.deploy_sha<>NEW.activation_deploy_sha
      OR evidence.state<>'PREPOST_READY' OR evidence.provider_post_count<>0
      OR evidence.provider_task_id IS NOT NULL OR evidence.payload_sha256 IS NOT NULL
      OR evidence.lease_kind<>'ACTIVE_EVIDENCE_LEASE'
      OR evidence.lease_expires_at IS NULL OR evidence.lease_expires_at<=CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'runtime authorization does not match pristine evidence authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normal_evidence_runtime_authorization_validate_insert
  ON normal_evidence_runtime_authorizations;
CREATE TRIGGER normal_evidence_runtime_authorization_validate_insert
BEFORE INSERT ON normal_evidence_runtime_authorizations
FOR EACH ROW EXECUTE FUNCTION validate_normal_evidence_runtime_authorization_insert();

DROP TRIGGER IF EXISTS normal_evidence_runtime_authorization_append_only
  ON normal_evidence_runtime_authorizations;
CREATE TRIGGER normal_evidence_runtime_authorization_append_only
BEFORE UPDATE OR DELETE ON normal_evidence_runtime_authorizations
FOR EACH ROW EXECUTE FUNCTION reject_normal_evidence_runtime_authorization_mutation();
