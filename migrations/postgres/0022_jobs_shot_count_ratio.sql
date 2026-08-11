-- Kontrol multi-shot & rasio aspek (permintaan Brian 2026-08-11, referensi
-- panel Higgsfield). Keduanya dipilih user di wizard tapi dipakai oleh WORKER,
-- jadi harus ikut baris job — bukan cukup ada di state React.
--
-- NULL = perilaku lama persis: jumlah shot diturunkan dari durasi & format,
-- rasio 9:16. Job lama tidak berubah sama sekali.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shot_count INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ratio TEXT;
