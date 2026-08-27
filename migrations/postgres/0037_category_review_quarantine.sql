ALTER TABLE products ADD COLUMN IF NOT EXISTS category_review_state TEXT NOT NULL DEFAULT 'QUARANTINED';
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_review_reason TEXT DEFAULT 'CATEGORY_UNKNOWN';
ALTER TABLE products ALTER COLUMN category_review_reason SET DEFAULT 'CATEGORY_UNKNOWN';
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_reviewed_by TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_reviewed_role TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_reviewed_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_review_version INTEGER NOT NULL DEFAULT 1;

UPDATE products
SET category_review_state = 'QUARANTINED',
    category_review_reason = 'CATEGORY_UNKNOWN',
    category_reviewed_by = NULL,
    category_reviewed_role = NULL,
    category_reviewed_at = NULL,
    category_review_version = GREATEST(category_review_version, 1)
WHERE category_review_state NOT IN ('CLEAR', 'QUARANTINED')
   OR category_review_version < 1
   OR (category_review_state = 'QUARANTINED' AND (
     category_review_reason NOT IN ('CATEGORY_UNKNOWN', 'CATEGORY_AMBIGUOUS', 'CATEGORY_BUNDLE')
     OR category_review_reason IS NULL
     OR category_reviewed_by IS NOT NULL OR category_reviewed_role IS NOT NULL OR category_reviewed_at IS NOT NULL))
   OR (category_review_state = 'CLEAR' AND (
     category_review_reason IS NOT NULL
     OR NOT (
       (category_review_version = 1
         AND category_reviewed_by IS NULL AND category_reviewed_role IS NULL AND category_reviewed_at IS NULL)
       OR
       (category_review_version >= 2
         AND category_reviewed_by IS NOT NULL AND length(btrim(category_reviewed_by)) > 0
         AND category_reviewed_role IS NOT NULL AND length(btrim(category_reviewed_role)) > 0
         AND category_reviewed_at IS NOT NULL)
     )));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_review_shape_check;
ALTER TABLE products ADD CONSTRAINT products_category_review_shape_check CHECK (
  category_review_version >= 1 AND (
    (category_review_state = 'QUARANTINED'
      AND category_review_reason IS NOT NULL
      AND category_review_reason IN ('CATEGORY_UNKNOWN', 'CATEGORY_AMBIGUOUS', 'CATEGORY_BUNDLE')
      AND category_reviewed_by IS NULL AND category_reviewed_role IS NULL AND category_reviewed_at IS NULL)
    OR
    (category_review_state = 'CLEAR' AND category_review_reason IS NULL AND (
      (category_review_version = 1
        AND category_reviewed_by IS NULL AND category_reviewed_role IS NULL AND category_reviewed_at IS NULL)
      OR
      (category_review_version >= 2
        AND category_reviewed_by IS NOT NULL AND length(btrim(category_reviewed_by)) > 0
        AND category_reviewed_role IS NOT NULL AND length(btrim(category_reviewed_role)) > 0
        AND category_reviewed_at IS NOT NULL)
    ))
  )
);
