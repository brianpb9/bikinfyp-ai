-- Brief kreatif dari brand (F-ENT-01 M8, 2026-08-11): kolom bebas tempat
-- brand menulis arahan sendiri ("tekankan bahan organik", "jangan sebut
-- diskon", dst) yang disuntikkan ke prompt shot. Nullable murni tambahan —
-- produk retail tidak pernah mengisinya dan tidak terpengaruh.
--
-- BEDA dari product_visual_desc (kolom lama): visual_desc mendeskripsikan
-- WUJUD produk supaya model video menggambarnya benar; brand_brief adalah
-- arahan KREATIF/pesan dari brand. Dua hal berbeda, sengaja tidak digabung.
ALTER TABLE products ADD COLUMN brand_brief TEXT;
