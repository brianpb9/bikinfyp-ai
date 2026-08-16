-- Satu job hanya boleh punya SATU catatan terminal kredit: capture ATAU release.
--
-- Sebelum ini invariannya cuma dijaga oleh pembacaan "NOT EXISTS" di dalam kode.
-- Itu tidak cukup, dan buktinya terukur: reconcileReadyHolds() versi pertama
-- berjalan tanpa transaksi maupun lock, dan 8 reconciler paralel atas 30 job
-- READY menghasilkan 17 job ber-capture ganda, satu sampai TUJUH capture. Di
-- READ COMMITTED, dua transaksi bisa sama-sama membaca NOT EXISTS sebagai benar
-- sebelum salah satunya menulis.
--
-- Penjagaan dipindah ke database karena di sanalah ia tidak bisa dilewati.
-- Ini juga menutup balapan capture-versus-release: keduanya memperebutkan satu
-- baris unik yang sama, jadi hanya satu yang bisa menang.
--
-- =====================================================================
-- VERSI SEBELUMNYA MIGRASI INI BISA MEMINDAHKAN UANG PELANGGAN.
-- =====================================================================
--
-- Ia menghapus duplikat terminal APA PUN jenisnya, menyisakan yang tertua.
-- Untuk job yang punya capture (delta 0, lebih tua) LALU release (delta
-- +12.000, lebih baru), yang terhapus adalah RELEASE-nya — dan saldo pelanggan
-- turun Rp12.000. Itu bukan pembersihan pembukuan, itu mengambil uang.
--
-- Aturan yang dipakai sekarang:
--   * Duplikat capture berdelta NOL boleh dibereskan otomatis — menghapusnya
--     tidak menggerakkan saldo satu rupiah pun, dan itu bisa dibuktikan dari
--     deltanya sendiri, bukan dari niat kita.
--   * Grup yang memuat release, atau memuat capture berdelta bukan nol,
--     MENGHENTIKAN migrasi. Kasus seperti itu harus direkonsiliasi manusia
--     terhadap state job dan hak saldo penggunanya.
--   * Apa pun yang dihapus DIARSIPKAN lebih dulu, supaya keputusan ini bisa
--     ditelusuri dan dibatalkan.
--
-- Migrasi yang berhenti dan menjelaskan diri jauh lebih baik daripada migrasi
-- yang "berhasil" sambil diam-diam menyesuaikan saldo orang.

-- Arsip: tujuan tunggalnya menyimpan baris yang dihapus migrasi ini.
CREATE TABLE IF NOT EXISTS credit_ledger_arsip_duplikat (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  org_id        TEXT,
  delta         INTEGER NOT NULL,
  type          TEXT NOT NULL,
  job_id        TEXT,
  payment_id    TEXT,
  created_at    TEXT NOT NULL,
  diarsipkan_at TEXT NOT NULL DEFAULT now()::text,
  alasan        TEXT NOT NULL
);

DO $$
DECLARE
  perlu_manusia integer;
  contoh        text;
  dihapus       integer;
BEGIN
  -- Grup terminal ganda yang TIDAK boleh disentuh otomatis: ada release-nya,
  -- atau ada capture yang ternyata menggerakkan saldo.
  SELECT COUNT(*), COALESCE(string_agg(job_id, ', ' ORDER BY job_id), '')
    INTO perlu_manusia, contoh
  FROM (
    SELECT job_id
    FROM credit_ledger
    WHERE type IN ('capture','release') AND job_id IS NOT NULL
    GROUP BY job_id
    HAVING COUNT(*) > 1
       AND (COUNT(*) FILTER (WHERE type = 'release') > 0
            OR COUNT(*) FILTER (WHERE delta <> 0) > 0)
    LIMIT 20
  ) x;

  IF perlu_manusia > 0 THEN
    RAISE EXCEPTION
      'Migrasi 0030 DIHENTIKAN: % job punya catatan terminal ganda yang menyangkut saldo (ada release, atau capture berdelta bukan nol). Rekonsiliasi manual dulu terhadap state job dan hak saldo penggunanya — JANGAN hapus otomatis. Contoh job_id: %',
      perlu_manusia, contoh;
  END IF;

  -- Sisanya: murni capture berdelta nol yang tergandakan. Arsipkan, lalu buang
  -- yang lebih baru. Trigger append-only dimatikan HANYA di sini.
  SELECT COUNT(*) INTO dihapus FROM (
    SELECT job_id FROM credit_ledger
    WHERE type IN ('capture','release') AND job_id IS NOT NULL
    GROUP BY job_id HAVING COUNT(*) > 1
  ) y;

  IF dihapus > 0 THEN
    RAISE NOTICE 'Membersihkan capture ganda berdelta nol pada % job (diarsipkan dulu).', dihapus;

    -- EXISTS, bukan JOIN. JOIN menghasilkan satu baris per PASANGAN, jadi baris
    -- yang punya dua pendahulu akan diarsipkan dua kali dan menabrak primary
    -- key arsipnya. Ketahuan saat migrasi ini benar-benar dijalankan.
    INSERT INTO credit_ledger_arsip_duplikat (id,user_id,org_id,delta,type,job_id,payment_id,created_at,alasan)
    SELECT c.id, c.user_id, c.org_id, c.delta, c.type, c.job_id, c.payment_id, c.created_at,
           'duplikat capture delta 0 dari reconcileReadyHolds tanpa lock (migrasi 0030)'
    FROM credit_ledger c
    WHERE c.type IN ('capture','release') AND c.job_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM credit_ledger tetap
        WHERE tetap.job_id = c.job_id
          AND tetap.type IN ('capture','release')
          AND (tetap.created_at, tetap.id) < (c.created_at, c.id)
      )
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE credit_ledger DISABLE TRIGGER credit_ledger_no_delete;
    DELETE FROM credit_ledger c
    WHERE c.type IN ('capture','release')
      AND c.job_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM credit_ledger tetap
        WHERE tetap.job_id = c.job_id
          AND tetap.type IN ('capture','release')
          AND (tetap.created_at, tetap.id) < (c.created_at, c.id)
      );
    ALTER TABLE credit_ledger ENABLE TRIGGER credit_ledger_no_delete;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ledger_terminal_per_job
  ON credit_ledger (job_id)
  WHERE type IN ('capture','release');
