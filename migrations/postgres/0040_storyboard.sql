-- STORYBOARD — gerbang persetujuan SEBELUM uang keluar.
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Keputusan Brian 7 Sep 2026. Alur lama: skrip disetujui -> job dibuat -> uang
-- DITAHAN -> video dirender -> baru pengguna melihat hasilnya. Persetujuan per
-- scene memang sudah ada (state AWAITING_APPROVAL, layar review di dashboard
-- brand), tapi ia berjalan SESUDAH klip video jadi. Pengguna menyetujui sesuatu
-- yang sudah dibayarkan.
--
-- Storyboard membalik urutannya: gambar per scene dibuat lebih dulu dengan
-- harga yang jauh lebih murah daripada video, pengguna melihat dan menyetujui,
-- BARU uang video ditahan.
--
-- ---------------------------------------------------------------------------
-- KENAPA TABEL BARU, BUKAN job_shots
-- ---------------------------------------------------------------------------
-- job_shots.job_id NOT NULL REFERENCES jobs(id). Storyboard justru harus ada
-- SEBELUM job — itu seluruh maksudnya. Menumpang job_shots berarti membuat job
-- lebih dulu, dan job adalah benda yang menahan uang. Kita akan kembali persis
-- ke masalah yang sedang diperbaiki.
--
-- Kaitannya ke scripts, bukan ke jobs: satu skrip yang disetujui melahirkan
-- satu storyboard, dan storyboard itulah yang melahirkan job.
--
-- ---------------------------------------------------------------------------
-- KENAPA PROMPT DISIMPAN, BUKAN DIHITUNG ULANG SAAT RENDER
-- ---------------------------------------------------------------------------
-- Kalau worker memanggil planShots() lagi saat render, yang dirender BUKAN yang
-- disetujui pengguna — planShots punya cabang acak dan bergantung konfigurasi
-- yang bisa berubah di antara dua saat itu. Gerbang persetujuan yang tidak
-- mengikat hasil adalah teater. Prompt yang dilihat pengguna disimpan, dan
-- worker WAJIB memakai baris ini.

CREATE TABLE storyboards (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- Diisi hanya untuk storyboard milik organisasi (brand). Retail NULL —
  -- sama seperti credit_ledger, supaya kueri retail lama tetap transparan.
  org_id TEXT REFERENCES organizations(id),
  duration_sec INTEGER NOT NULL,
  quality_tier TEXT NOT NULL,
  format TEXT NOT NULL,
  -- SELURUH parameter pembuatan job, apa adanya, sebagai JSON.
  --
  -- Pilihan kreator, avatar, tier, format, dan durasi dibuat di halaman skrip
  -- dan sebelumnya dikirim langsung ke POST /api/jobs. Kalau storyboard tidak
  -- menyimpannya, rencana shot yang DIGAMBAR bisa berbeda dari yang DIRENDER —
  -- pengguna menyetujui satu hal dan menerima hal lain. Route job memakai
  -- baris ini, bukan body permintaan, supaya keduanya mustahil berbeda.
  params TEXT NOT NULL,
  -- PENDING  : baris dibuat, gambar belum ada (worker belum mengambil)
  -- BUILDING : worker sedang menggenerate
  -- READY    : semua scene punya gambar, menunggu keputusan pengguna
  -- APPROVED : pengguna menekan Generate; job_id terisi
  -- FAILED   : generate gambar gagal; pengguna boleh mengulang tanpa bayar
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','BUILDING','READY','APPROVED','FAILED')),
  -- Job yang lahir dari storyboard ini. NULL sampai disetujui.
  job_id TEXT REFERENCES jobs(id),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_storyboards_script ON storyboards(script_id);
CREATE INDEX idx_storyboards_user ON storyboards(user_id);

CREATE TABLE storyboard_scenes (
  id TEXT PRIMARY KEY,
  storyboard_id TEXT NOT NULL REFERENCES storyboards(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  duration_sec DOUBLE PRECISION NOT NULL,
  -- Prompt yang BENAR-BENAR akan dikirim ke mesin video. Ditampilkan apa adanya
  -- di kartu storyboard: pengguna berhak tahu apa yang ia setujui.
  prompt TEXT NOT NULL,
  -- Kalimat yang diucapkan di scene ini (dari segments skrip). Boleh kosong
  -- untuk packshot.
  dialog TEXT NOT NULL DEFAULT '',
  -- Keadaan yang sudah benar di frame pertama — dipakai membangun gambar.
  start_state TEXT,
  -- Kunci objek gambar storyboard. NULL selama masih digenerate.
  image_key TEXT,
  -- Dibawa sebagai data, bukan disimpulkan dari teks prompt — keputusan yang
  -- mengeluarkan uang tidak boleh bergantung pada pilihan kata bahasa Inggris.
  tanpa_orang BOOLEAN NOT NULL DEFAULT FALSE,
  withhold_product BOOLEAN NOT NULL DEFAULT FALSE,
  -- Kuota regenerate per scene. Batasnya di lib/storyboard.ts, bukan di sini:
  -- angka kebijakan berubah lebih sering daripada schema.
  regen_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (storyboard_id, idx)
);
CREATE INDEX idx_storyboard_scenes_sb ON storyboard_scenes(storyboard_id);

-- Job tahu storyboard mana yang melahirkannya. Dipakai worker untuk MEMAKAI
-- prompt yang disetujui alih-alih merencanakan ulang.
ALTER TABLE jobs ADD COLUMN storyboard_id TEXT REFERENCES storyboards(id);
