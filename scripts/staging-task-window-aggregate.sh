#!/bin/sh
set -eu

DB_ID=${STAGING_DATABASE_ID:?STAGING_DATABASE_ID is required}
WINDOW_START=${TASK_WINDOW_START:?TASK_WINDOW_START is required}
SQL="WITH
jobs_snapshot AS (
  SELECT count(*) AS row_count,
    count(*) FILTER (WHERE state IN ('QUEUED','GENERATING_VISUAL','AWAITING_APPROVAL','GENERATING_VOICE','COMPOSITING','QC_CHECK','LABELING')) AS active_count,
    COALESCE(sum(cost_actual_idr),0) AS cost_total,
    md5(COALESCE(string_agg(to_jsonb(j)::text, E'\\n' ORDER BY id),'')) AS fingerprint
  FROM jobs j
),
promo_snapshot AS (
  SELECT count(*) AS row_count,
    count(*) FILTER (WHERE state IN ('QUEUED','GENERATING_HOOK','STITCHING')) AS active_count,
    COALESCE(sum(cost_actual_idr),0) AS cost_total,
    md5(COALESCE(string_agg(to_jsonb(p)::text, E'\\n' ORDER BY id),'')) AS fingerprint
  FROM promo_jobs p
),
provider_snapshot AS (
  SELECT count(*) AS row_count,
    md5(COALESCE(string_agg(to_jsonb(pt)::text, E'\\n' ORDER BY job_id, shot_index, provider),'')) AS fingerprint
  FROM provider_tasks pt
),
ledger_snapshot AS (
  SELECT count(*) AS row_count,
    COALESCE(sum(delta),0) AS delta_total,
    md5(COALESCE(string_agg(to_jsonb(cl)::text, E'\\n' ORDER BY created_at, id),'')) AS fingerprint
  FROM credit_ledger cl
),
payment_snapshot AS (
  SELECT count(*) AS row_count,
    COALESCE(sum(amount_idr),0) AS amount_total,
    md5(COALESCE(string_agg(to_jsonb(p)::text, E'\\n' ORDER BY created_at, id),'')) AS fingerprint
  FROM payments p
)
SELECT json_build_object(
  'observed_at', clock_timestamp(),
  'window_start', '$WINDOW_START',
  'jobs', json_build_object(
    'rows', j.row_count, 'active_or_queued', j.active_count,
    'cost_total_idr', j.cost_total, 'fingerprint', j.fingerprint,
    'created_in_window', (SELECT count(*) FROM jobs WHERE created_at >= '$WINDOW_START')
  ),
  'promo_jobs', json_build_object(
    'rows', pj.row_count, 'active_or_queued', pj.active_count,
    'cost_total_idr', pj.cost_total, 'fingerprint', pj.fingerprint,
    'created_in_window', (SELECT count(*) FROM promo_jobs WHERE created_at >= '$WINDOW_START')
  ),
  'provider_tasks', json_build_object(
    'rows', pt.row_count, 'fingerprint', pt.fingerprint,
    'created_in_window', (SELECT count(*) FROM provider_tasks WHERE created_at >= '$WINDOW_START')
  ),
  'credit_ledger', json_build_object(
    'rows', cl.row_count, 'delta_total', cl.delta_total, 'fingerprint', cl.fingerprint,
    'all_types_created_in_window', (SELECT count(*) FROM credit_ledger WHERE created_at >= '$WINDOW_START')
  ),
  'payments', json_build_object(
    'rows', pay.row_count, 'amount_total_idr', pay.amount_total, 'fingerprint', pay.fingerprint,
    'created_in_window', (SELECT count(*) FROM payments WHERE created_at >= '$WINDOW_START')
  )
) FROM jobs_snapshot j, promo_snapshot pj, provider_snapshot pt, ledger_snapshot cl, payment_snapshot pay;"

exec render psql "$DB_ID" --command "$SQL" --output text
