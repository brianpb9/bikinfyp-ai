-- Gaya rekam per job (lib/media/recording-styles.ts) — sumbu "bagaimana
-- direkam", terpisah dari "apa yang dijual": selfie, selfie cermin, di atas
-- meja, unboxing, di mobil, sambil jalan, meja kerja.
--
-- Nullable, dan NULL berarti "standar" = framing bawaan format, PERSIS
-- perilaku sebelum kolom ini ada. Job lama tidak berubah sedikit pun.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS record_style TEXT;
