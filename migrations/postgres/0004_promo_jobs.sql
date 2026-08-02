-- Video Promosi (non-ecommerce) prototype — deliberately separate from the
-- e-commerce `jobs`/`products` pipeline (no product, no price, no
-- keranjang-kuning CTA). Isolated table so the prototype cannot destabilize
-- the production revenue path.
CREATE TABLE promo_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (state IN ('QUEUED','GENERATING_HOOK','STITCHING','READY','FAILED')),
  uploaded_clip_url TEXT NOT NULL,
  generated_shot_url TEXT,
  output_url TEXT,
  error_message TEXT,
  cost_actual_idr INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_promo_jobs_user ON promo_jobs(user_id);
