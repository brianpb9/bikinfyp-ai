CREATE TABLE IF NOT EXISTS normal_evidence_runtime_successor_authorizations (
  job_id TEXT PRIMARY KEY REFERENCES normal_representative_evidence_runs(job_id) ON DELETE RESTRICT,
  prior_provider_runtime_sha TEXT NOT NULL CHECK (prior_provider_runtime_sha ~ '^[0-9a-f]{40}$'),
  provider_runtime_sha TEXT NOT NULL CHECK (provider_runtime_sha ~ '^[0-9a-f]{40}$'),
  database_binding_sha256 TEXT NOT NULL CHECK (database_binding_sha256 ~ '^[0-9a-f]{64}$'),
  authorization_task_id TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  authorizer_deploy_sha TEXT NOT NULL CHECK (authorizer_deploy_sha ~ '^[0-9a-f]{40}$'),
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT normal_evidence_runtime_successor_candidate4_exact CHECK (
    job_id='2c49a5c8-9465-4400-a214-159336a2c097'
    AND prior_provider_runtime_sha='4d1cf4fc375fbb75ed09de7f5ab36ce3f72b38a1'
    AND database_binding_sha256='f4fcf0f493e99f7ad0e5fb7ed320ea272080ef611b2500cb2f6ed89bd8f97610'
    AND authorization_task_id='SCORE80-NORMAL-PROVIDER-EVIDENCE-20260901'
    AND authorized_by='ac8b0a3e-8835-4e64-80e6-2e2cae6198b8'
    AND provider_runtime_sha<>prior_provider_runtime_sha
    AND authorizer_deploy_sha=provider_runtime_sha
  )
);

CREATE OR REPLACE FUNCTION reject_normal_evidence_runtime_successor_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'normal evidence runtime successor authorization is append-only' USING ERRCODE='23514';
END;
$$;

CREATE OR REPLACE FUNCTION validate_normal_evidence_runtime_successor_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  evidence normal_representative_evidence_runs%ROWTYPE;
  jobrow jobs%ROWTYPE;
  original normal_evidence_runtime_authorizations%ROWTYPE;
  effects INTEGER;
BEGIN
  SELECT * INTO evidence FROM normal_representative_evidence_runs WHERE job_id=NEW.job_id FOR UPDATE;
  SELECT * INTO jobrow FROM jobs WHERE id=NEW.job_id FOR UPDATE;
  SELECT * INTO original FROM normal_evidence_runtime_authorizations WHERE job_id=NEW.job_id;
  SELECT
    (SELECT count(*) FROM provider_tasks WHERE job_id=NEW.job_id)
    +(SELECT count(*) FROM outputs WHERE job_id=NEW.job_id)
    +(SELECT count(*) FROM fyp_snapshots WHERE job_id=NEW.job_id AND posted_url IS NOT NULL)
    +(SELECT count(*) FROM post_plans WHERE job_id=NEW.job_id)
    INTO effects;
  IF evidence.job_id IS NULL OR jobrow.id IS NULL OR original.job_id IS NULL
      OR original.provider_runtime_sha<>NEW.prior_provider_runtime_sha
      OR original.database_binding_sha256<>NEW.database_binding_sha256
      OR evidence.task_id<>'FINAL-POST-SWEEP-CANDIDATE-4-20260901'
      OR evidence.deploy_sha<>'13c22bc7a3a340f0ea5f4bb0db9a905691676c77'
      OR evidence.state<>'PREPOST_READY' OR evidence.provider_post_count<>0
      OR evidence.provider_task_id IS NOT NULL OR evidence.payload_sha256 IS NOT NULL
      OR evidence.artifact_key IS NOT NULL OR evidence.actual_cost_usd IS NOT NULL
      OR evidence.lease_kind<>'ACTIVE_EVIDENCE_LEASE'
      OR evidence.lease_expires_at IS NULL OR evidence.lease_expires_at<=CURRENT_TIMESTAMP
      OR jobrow.state<>'GENERATING_VISUAL' OR jobrow.provider_video IS NOT NULL
      OR jobrow.provider_voice IS NOT NULL OR jobrow.output_url IS NOT NULL
      OR effects<>0 THEN
    RAISE EXCEPTION 'runtime successor does not match zero-effect Candidate 4 authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normal_evidence_runtime_successor_validate_insert
  ON normal_evidence_runtime_successor_authorizations;
CREATE TRIGGER normal_evidence_runtime_successor_validate_insert
BEFORE INSERT ON normal_evidence_runtime_successor_authorizations
FOR EACH ROW EXECUTE FUNCTION validate_normal_evidence_runtime_successor_insert();

DROP TRIGGER IF EXISTS normal_evidence_runtime_successor_append_only
  ON normal_evidence_runtime_successor_authorizations;
CREATE TRIGGER normal_evidence_runtime_successor_append_only
BEFORE UPDATE OR DELETE ON normal_evidence_runtime_successor_authorizations
FOR EACH ROW EXECUTE FUNCTION reject_normal_evidence_runtime_successor_mutation();
