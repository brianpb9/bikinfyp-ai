ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_token TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_confirmed_token TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_confirmed_by TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_confirmed_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_version INTEGER;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type_state TEXT NOT NULL DEFAULT 'QUARANTINED';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_state_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_state_check
  CHECK (product_type_state IN ('QUARANTINED', 'CONFIRMED'));

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_product_type_confirmed_shape_check;
ALTER TABLE products ADD CONSTRAINT products_product_type_confirmed_shape_check CHECK (
  product_type_state = 'QUARANTINED'
  OR (
    product_type_token IS NOT NULL
    AND product_type_confirmed_token IS NOT NULL
    AND product_type_confirmed_by IS NOT NULL
    AND product_type_confirmed_at IS NOT NULL
    AND product_type_version IS NOT NULL
    AND product_type_version = 1
    AND product_type_token = product_type_confirmed_token
    AND length(product_type_token) > 0
    AND length(product_type_confirmed_token) > 0
    AND product_type_token !~ '(^[[:space:]])|([[:space:]]$)'
    AND product_type_confirmed_token !~ '(^[[:space:]])|([[:space:]]$)'
    AND product_type_confirmed_by !~ '^[[:space:]]*$'
  )
);
