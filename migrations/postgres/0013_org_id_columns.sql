-- Nullable org_id overlay (2026-08-11, dashboard enterprise/brand —
-- F-ENT-01): NULL = retail (unchanged forever), non-NULL = enterprise
-- dashboard / bulk-generate. user_id stays NOT NULL everywhere it already
-- was (acting member / audit trail of who spent it) — org_id is additive,
-- never a replacement. Every existing bare "WHERE user_id = ?" query stays
-- correct with zero code changes, since retail rows never get an org_id.
ALTER TABLE credit_ledger ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX idx_ledger_org ON credit_ledger(org_id, created_at DESC, id DESC);

ALTER TABLE products ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX idx_products_org ON products(org_id);

ALTER TABLE jobs ADD COLUMN org_id TEXT REFERENCES organizations(id);
-- Tag N job dari satu submit bulk-generate — bukan tabel baru, cukup ini.
ALTER TABLE jobs ADD COLUMN bulk_run_id TEXT;
CREATE INDEX idx_jobs_org ON jobs(org_id, state);
CREATE INDEX idx_jobs_bulk_run ON jobs(org_id, bulk_run_id);

ALTER TABLE promo_jobs ADD COLUMN org_id TEXT REFERENCES organizations(id);
CREATE INDEX idx_promo_jobs_org ON promo_jobs(org_id);
