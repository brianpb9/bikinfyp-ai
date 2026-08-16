-- Biaya REGENERATE SCENE punya jenis ledger sendiri.
--
-- Sampai sekarang ia menulis type='capture' dengan delta = -harga dan memakai
-- job_id INDUK (app/api/dashboard/campaign/job/[jobId]). Dua-duanya salah, dan
-- salahnya bukan soal rapi-rapian:
--
--   * 'capture' menurut definisi berdelta NOL. Yang memotong saldo adalah
--     'hold'; capture cuma menyatakan hold itu final. Baris capture berdelta
--     negatif adalah PENAGIHAN yang menyamar sebagai penutupan.
--
--   * Memakai job_id induk berarti biaya regenerate MEREBUT slot terminal milik
--     job render itu sendiri. Akibat berantainya nyata: capture final melihat
--     "sudah ada terminal" lalu menyerah; kalau rendernya kemudian gagal,
--     releaseCredits juga melihat terminal dan MENOLAK refund; hold dasarnya
--     tertahan selamanya. Dan sesudah indeks unik terminal dipasang (0031),
--     regenerate KEDUA akan gagal 23505 padahal UI menjanjikan tiga kali.
--
-- Karena itu 'regen' jadi jenis tersendiri: ia tetap memotong saldo (delta
-- negatif, ikut SUM biasa), tapi ia BUKAN catatan terminal, jadi tidak
-- bersaing dengan capture/release milik job induknya.
--
-- URUTAN PENTING: berkas ini WAJIB berjalan sebelum 0031. Indeks unik di 0031
-- memeriksa capture/release, dan prasyaratnya juga menolak capture berdelta
-- bukan nol — tanpa perbaikan di sini, 0031 akan berhenti pada data lama.

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_type_check
  CHECK (type IN ('topup','hold','capture','release','bonus','regen'));

-- Perbaikan data lama.
--
-- Aturannya bisa DIBUKTIKAN, bukan ditebak: capture selalu ditulis dengan
-- delta 0 (lihat captureCredits di lib/credits.ts dan lib/postgres/
-- credit-payment.ts), jadi baris capture berdelta NEGATIF tidak mungkin
-- capture — satu-satunya penulis bentuk itu adalah regenerate scene.
--
-- Yang berubah HANYA labelnya. delta tidak disentuh, jadi saldo setiap
-- pengguna tetap sama persis sebelum dan sesudah migrasi ini. Ini pelabelan
-- ulang, bukan penyesuaian saldo.
DO $$
DECLARE jumlah integer;
BEGIN
  SELECT COUNT(*) INTO jumlah FROM credit_ledger WHERE type='capture' AND delta < 0;
  IF jumlah > 0 THEN
    RAISE NOTICE 'Melabeli ulang % baris capture berdelta negatif menjadi regen (saldo tidak berubah).', jumlah;
    ALTER TABLE credit_ledger DISABLE TRIGGER credit_ledger_no_update;
    UPDATE credit_ledger SET type='regen' WHERE type='capture' AND delta < 0;
    ALTER TABLE credit_ledger ENABLE TRIGGER credit_ledger_no_update;
  END IF;
END $$;

-- Penjaga: capture yang menggerakkan saldo tidak boleh lahir lagi.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_capture_delta_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_capture_delta_check
  CHECK (type <> 'capture' OR delta = 0);
