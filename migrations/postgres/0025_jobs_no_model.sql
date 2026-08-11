-- TVC tanpa model (2026-08-11).
--
-- Dari template "THE DROP" yang Brian kirim: 4 dari 6 modulnya TIDAK ada
-- orangnya sama sekali (tetesan makro, tekstur, mekanisme abstrak, packshot).
-- TVC kita memaksa presenter di setiap beat, jadi iklan produk yang seharusnya
-- murni makro selalu kemasukan orang yang tidak diminta.
--
-- NULL/FALSE = perilaku lama persis.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS no_model BOOLEAN;
