-- Onboarding organisasi (2026-08-11). Tanpa penanda ini, satu-satunya cara
-- menebak "sudah onboarding atau belum" adalah memeriksa apakah business_type
-- terisi — dan itu salah untuk brand yang sengaja MELEWATI langkah tersebut:
-- mereka akan ditanya lagi setiap kali membuka dashboard, selamanya.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarded_at TEXT;

-- Backfill WAJIB. Gerbang di app/dashboard/(app)/layout.tsx melempar setiap
-- org ber-onboarded_at NULL ke alur onboarding. Tanpa baris ini, SEMUA brand
-- pilot yang sudah berjalan akan tiba-tiba dihadang formulir perkenalan saat
-- membuka dashboard berikutnya — untuk data yang sebagian sudah mereka isi.
-- Hanya org yang dibuat SETELAH migrasi ini yang seharusnya melihat alur baru.
UPDATE organizations SET onboarded_at = created_at WHERE onboarded_at IS NULL;
