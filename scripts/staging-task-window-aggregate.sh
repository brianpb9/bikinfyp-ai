#!/bin/sh
set -eu

DB_ID=${STAGING_DATABASE_ID:?STAGING_DATABASE_ID is required}
WINDOW_START=${TASK_WINDOW_START:?TASK_WINDOW_START is required}
SQL="SELECT '$WINDOW_START' AS task_window_start,
  (SELECT count(*) FROM jobs WHERE created_at >= '$WINDOW_START') AS jobs_created,
  (SELECT COALESCE(sum(cost_actual_idr),0) FROM jobs WHERE created_at >= '$WINDOW_START') AS jobs_cost_idr,
  (SELECT count(*) FROM provider_tasks pt JOIN jobs j ON j.id=pt.job_id WHERE j.created_at >= '$WINDOW_START') AS provider_tasks_for_window_jobs,
  (SELECT count(*) FROM promo_jobs WHERE created_at >= '$WINDOW_START') AS promo_jobs_created,
  (SELECT COALESCE(sum(cost_actual_idr),0) FROM promo_jobs WHERE created_at >= '$WINDOW_START') AS promo_cost_idr,
  (SELECT count(*) FROM credit_ledger WHERE created_at >= '$WINDOW_START' AND type IN ('hold','capture','release')) AS credit_mutations,
  (SELECT count(*) FROM payments WHERE created_at >= '$WINDOW_START') AS payments_created,
  (SELECT COALESCE(sum(amount_idr),0) FROM payments WHERE created_at >= '$WINDOW_START') AS payments_amount_idr;"

exec render psql "$DB_ID" --command "$SQL" --output text
