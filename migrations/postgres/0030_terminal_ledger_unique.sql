-- Satu job hanya boleh punya SATU catatan terminal kredit: capture ATAU release.
--
-- Sebelum ini invariannya cuma dijaga oleh pembacaan "NOT EXISTS" di dalam kode.
-- Itu tidak cukup, dan buktinya terukur. reconcileReadyHolds() versi pertama
-- berjalan tanpa transaksi maupun lock; menjalankan 8 reconciler bersamaan atas
-- 30 job READY menghasilkan 17 job dengan capture ganda, satu di antaranya
-- sampai TUJUH capture. Di READ COMMITTED, dua transaksi bisa sama-sama membaca
-- NOT EXISTS sebagai benar sebelum salah satunya menulis.
--
-- Penjagaan dipindah ke database karena di sanalah ia tidak bisa dilewati: lock
-- yang lupa dipasang di jalur baru akan gagal keras di sini, bukan diam-diam
-- menggandakan catatan uang. Ini juga menutup balapan capture-versus-release —
-- keduanya memperebutkan satu baris unik yang sama, jadi hanya satu yang bisa
-- menang berapa pun urutan kedatangannya.
--
-- Baris topup/bonus tidak tersentuh: predikatnya hanya mengenai tipe terminal.
-- job_id NULL juga tidak tersentuh (NULL tidak pernah bertabrakan di indeks unik).

-- PEMBERSIHAN DUPLIKAT — dan kenapa bentuknya berbelit.
--
-- credit_ledger APPEND-ONLY, ditegakkan trigger (credit_ledger_no_delete /
-- credit_ledger_no_update). Versi pertama migrasi ini memakai DELETE polos dan
-- GAGAL saat benar-benar dijalankan: "credit_ledger is append-only". Itu
-- ketahuan hanya karena migrasinya dicoba di PostgreSQL sungguhan, bukan
-- dibaca ulang.
--
-- Duplikat capture TIDAK memindahkan uang (delta capture = 0; yang memotong
-- saldo adalah hold), jadi ini koreksi pembukuan, bukan koreksi saldo. Tetapi
-- baris yang menurut invarian tidak boleh ada memang tidak boleh ditinggalkan:
-- ia akan membuat setiap laporan yang menghitung 'capture' salah hitung.
--
-- Trigger dimatikan HANYA selama pembersihan, HANYA kalau memang ada duplikat,
-- lalu dinyalakan lagi di transaksi yang sama. Baris tertua per job yang
-- dipertahankan — ia yang pertama memutuskan nasib job itu.
DO $$
DECLARE jumlah_duplikat integer;
BEGIN
  SELECT COUNT(*) INTO jumlah_duplikat FROM (
    SELECT job_id FROM credit_ledger
    WHERE type IN ('capture','release') AND job_id IS NOT NULL
    GROUP BY job_id HAVING COUNT(*) > 1
  ) x;

  IF jumlah_duplikat > 0 THEN
    RAISE NOTICE 'Membersihkan catatan terminal ganda pada % job.', jumlah_duplikat;
    ALTER TABLE credit_ledger DISABLE TRIGGER credit_ledger_no_delete;
    DELETE FROM credit_ledger c
    USING credit_ledger tetap
    WHERE c.type IN ('capture','release')
      AND tetap.type IN ('capture','release')
      AND c.job_id = tetap.job_id
      AND c.job_id IS NOT NULL
      AND (tetap.created_at, tetap.id) < (c.created_at, c.id);
    ALTER TABLE credit_ledger ENABLE TRIGGER credit_ledger_no_delete;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ledger_terminal_per_job
  ON credit_ledger (job_id)
  WHERE type IN ('capture','release');
