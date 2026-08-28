-- Exactly one closed production-payment canary may ever be reserved.
-- This table is intentionally separate from public packages/payments: the
-- canary grants no customer credit and cannot leak into public pricing.
CREATE TABLE IF NOT EXISTS payment_production_canary (
  singleton_id TEXT PRIMARY KEY CHECK (singleton_id = 'production-payment-canary-v1'),
  actor_id TEXT NOT NULL REFERENCES users(id),
  amount_idr INTEGER NOT NULL CHECK (amount_idr = 10000),
  entitlement TEXT NOT NULL CHECK (entitlement = 'INTERNAL_SETTLEMENT_PROOF_ONLY_NO_CUSTOMER_CREDITS'),
  payment_method TEXT NOT NULL CHECK (length(trim(payment_method)) > 0),
  channel_minimum_idr INTEGER NOT NULL CHECK (channel_minimum_idr > 0 AND channel_minimum_idr <= amount_idr),
  merchant_readiness_source TEXT NOT NULL CHECK (length(trim(merchant_readiness_source)) > 0),
  channel_minimum_source TEXT NOT NULL CHECK (length(trim(channel_minimum_source)) > 0),
  settlement_class TEXT NOT NULL CHECK (length(trim(settlement_class)) > 0),
  settlement_window TEXT NOT NULL CHECK (length(trim(settlement_window)) > 0),
  settlement_source TEXT NOT NULL CHECK (length(trim(settlement_source)) > 0),
  source_bundle_sha256 TEXT NOT NULL CHECK (source_bundle_sha256 ~ '^[0-9a-f]{64}$'),
  source_effective_at TEXT NOT NULL,
  approver_identity TEXT NOT NULL CHECK (approver_identity = 'Founder/CEO'),
  approval_reference TEXT NOT NULL CHECK (length(trim(approval_reference)) > 0),
  approval_receipt_sha256 TEXT NOT NULL CHECK (approval_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  approval_effective_at TEXT NOT NULL,
  approval_expires_at TEXT NOT NULL,
  approved_loss_cap_idr INTEGER NOT NULL CHECK (approved_loss_cap_idr BETWEEN 0 AND 50000),
  economics_json TEXT NOT NULL CHECK (length(trim(economics_json)) > 0),
  prerequisite_receipt_sha256 TEXT NOT NULL CHECK (prerequisite_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  payments_env TEXT NOT NULL CHECK (payments_env = 'production'),
  provider_ref TEXT,
  state TEXT NOT NULL CHECK (state IN ('RESERVED','ISSUED','HOLD_NO_RETRY','SETTLED')),
  no_retry BOOLEAN NOT NULL DEFAULT TRUE CHECK (no_retry = TRUE),
  hold_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state = 'ISSUED' AND provider_ref IS NOT NULL) OR state <> 'ISSUED'),
  CHECK ((state = 'HOLD_NO_RETRY' AND hold_reason IS NOT NULL) OR state <> 'HOLD_NO_RETRY')
);

REVOKE ALL ON payment_production_canary FROM PUBLIC;
