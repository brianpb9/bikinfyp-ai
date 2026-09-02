-- KREDIT PER JENIS VIDEO — menggantikan saldo rupiah sebagai alat bayar render.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- APA YANG BERUBAH, DAN KENAPA BUKAN SEKADAR KOLOM BARU
-- ─────────────────────────────────────────────────────────────────────────────
-- Sampai sekarang dompet pengguna berisi RUPIAH: job menahan rupiah, lalu
-- memotongnya. Itu membuat satu angka menjawab tiga pertanyaan sekaligus —
-- berapa uang yang tersisa, berapa video yang bisa dibuat, dan video jenis apa.
-- Ketiganya bergerak sendiri-sendiri, jadi satu angka tidak akan pernah cukup.
--
-- Sekarang yang dihitung adalah JATAH VIDEO per jenis (standard/premium/ultra),
-- dan tiap jatah punya dua ember yang aturannya berbeda:
--
--   langganan — habis saat masa berlakunya berakhir;
--   topup     — tidak pernah hangus.
--
-- Pemakaian selalu menghabiskan ember LANGGANAN lebih dulu. Kalau tidak, jatah
-- yang akan hangus justru mengendap sementara jatah abadi yang terpakai — dan
-- pengguna kehilangan sesuatu yang sudah dibayar tanpa pernah tahu.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- KENAPA SISA LANGGANAN TIDAK DISIMPAN SEBAGAI ANGKA
-- ─────────────────────────────────────────────────────────────────────────────
-- Sisa = kuota yang tercatat saat membeli, dikurangi pemakaian yang tercatat.
-- Menyimpan "sisa" sebagai kolom yang di-UPDATE berarti ada satu angka yang
-- bisa salah tanpa jejak: dua permintaan bersamaan sama-sama membaca 1, dua-
-- duanya menulis 0, dan dua video keluar dari satu jatah. Buku besar tidak
-- bisa berbohong seperti itu — dan penjagaannya ada di indeks unik di bawah,
-- bukan di pembacaan "kalau masih ada" yang bisa dilewati dua proses.

-- ── 1. Harga add-on per jenis, diatur admin ─────────────────────────────────
CREATE TABLE harga_kredit_video (
  jenis TEXT PRIMARY KEY CHECK (jenis IN ('standard','premium','ultra')),
  harga_idr INTEGER NOT NULL CHECK (harga_idr > 0),
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  diubah_oleh TEXT,
  diubah_pada TEXT NOT NULL
);

-- ── 2. Paket langganan, diatur admin ────────────────────────────────────────
CREATE TABLE paket_langganan (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  keterangan TEXT NOT NULL DEFAULT '',
  harga_idr INTEGER NOT NULL CHECK (harga_idr > 0),
  kuota_standard INTEGER NOT NULL DEFAULT 0 CHECK (kuota_standard >= 0),
  kuota_premium INTEGER NOT NULL DEFAULT 0 CHECK (kuota_premium >= 0),
  kuota_ultra INTEGER NOT NULL DEFAULT 0 CHECK (kuota_ultra >= 0),
  masa_hari INTEGER NOT NULL DEFAULT 30 CHECK (masa_hari > 0),
  urutan INTEGER NOT NULL DEFAULT 0,
  aktif BOOLEAN NOT NULL DEFAULT TRUE,
  dibuat_pada TEXT NOT NULL,
  diubah_pada TEXT NOT NULL,
  -- Paket tanpa isi apa pun adalah paket yang menagih uang untuk nol video.
  CONSTRAINT paket_tidak_kosong CHECK (kuota_standard + kuota_premium + kuota_ultra > 0)
);

-- ── 3. Langganan milik pengguna — SNAPSHOT, bukan rujukan ke paket ──────────
-- Kuotanya disalin saat membeli, tidak dibaca ulang dari paket_langganan.
-- Kalau admin mengubah isi paket bulan depan, yang sudah membeli tidak boleh
-- ikut berubah — ke atas maupun ke bawah.
CREATE TABLE langganan (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  paket_id TEXT NOT NULL,
  paket_nama TEXT NOT NULL,
  harga_idr INTEGER NOT NULL,
  kuota_standard INTEGER NOT NULL DEFAULT 0,
  kuota_premium INTEGER NOT NULL DEFAULT 0,
  kuota_ultra INTEGER NOT NULL DEFAULT 0,
  mulai_pada TEXT NOT NULL,
  berakhir_pada TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','dibatalkan')),
  payment_id TEXT,
  dibuat_pada TEXT NOT NULL
);
CREATE INDEX idx_langganan_user ON langganan(user_id, berakhir_pada DESC);
-- Satu pembayaran = satu langganan. Callback gateway bisa datang lebih dari
-- sekali (dan memang pernah), jadi penjagaannya di database, bukan di kode.
CREATE UNIQUE INDEX uniq_langganan_payment ON langganan(payment_id) WHERE payment_id IS NOT NULL;

-- ── 4. Buku besar kredit video ──────────────────────────────────────────────
-- delta > 0 menambah jatah, delta < 0 memakainya.
--   beli     — dibayar lewat gateway (topup) atau ikut paket (langganan)
--   bonus    — pemberian, mis. paket gratis pendaftar baru
--   pakai    — job dibuat
--   kembali  — job gagal / dibatalkan, jatahnya dikembalikan
--   koreksi  — penyesuaian manual admin, wajib bercatatan
CREATE TABLE kredit_video (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  jenis TEXT NOT NULL CHECK (jenis IN ('standard','premium','ultra')),
  ember TEXT NOT NULL CHECK (ember IN ('langganan','topup')),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  tipe TEXT NOT NULL CHECK (tipe IN ('beli','bonus','pakai','kembali','koreksi')),
  -- Wajib terisi untuk ember 'langganan': tanpa ini, pemakaian tidak bisa
  -- dikaitkan ke periode mana pun, dan sisa periode berjalan jadi tebakan.
  langganan_id TEXT REFERENCES langganan(id),
  job_id TEXT,
  payment_id TEXT,
  catatan TEXT,
  dibuat_pada TEXT NOT NULL,
  CONSTRAINT ember_langganan_wajib_periode CHECK (ember <> 'langganan' OR langganan_id IS NOT NULL)
);
CREATE INDEX idx_kredit_video_user ON kredit_video(user_id, jenis, ember);
CREATE INDEX idx_kredit_video_langganan ON kredit_video(langganan_id);
CREATE INDEX idx_kredit_video_job ON kredit_video(job_id);

-- SATU job = SATU pemakaian dan SATU pengembalian, ditegakkan database.
--
-- Ini pagar yang sama dengan uniq_ledger_terminal_per_job di dompet rupiah,
-- dan alasannya sama persis: penjagaan lewat pembacaan "NOT EXISTS" di kode
-- terbukti bisa dilewati dua proses yang berjalan bersamaan, dan yang bocor
-- lewat celah itu adalah barang yang dibayar orang.
CREATE UNIQUE INDEX uniq_kredit_pakai_per_job ON kredit_video(job_id) WHERE tipe = 'pakai';
CREATE UNIQUE INDEX uniq_kredit_kembali_per_job ON kredit_video(job_id) WHERE tipe = 'kembali';
-- Satu pembayaran topup hanya boleh mengisi sekali per jenis.
CREATE UNIQUE INDEX uniq_kredit_beli_per_payment ON kredit_video(payment_id, jenis) WHERE tipe = 'beli';

-- ── 5. Isi pesanan topup ────────────────────────────────────────────────────
-- Harga satuan DISALIN ke sini saat pesanan dibuat. Kalau admin menaikkan
-- harga sementara ada invoice yang belum dibayar, yang berlaku tetap harga
-- saat pembeli menekan tombol — bukan harga yang berubah di belakangnya.
CREATE TABLE pesanan_item (
  payment_id TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('standard','premium','ultra')),
  qty INTEGER NOT NULL CHECK (qty > 0),
  harga_satuan_idr INTEGER NOT NULL CHECK (harga_satuan_idr > 0),
  PRIMARY KEY (payment_id, jenis)
);

-- ── 6. Pesanan tahu dirinya pesanan apa ─────────────────────────────────────
-- Tanpa kolom ini, callback pembayaran harus MENEBAK apakah yang dibeli paket
-- atau kredit satuan — dan tebakan yang salah berarti orang membayar paket
-- lalu menerima kredit satuan, atau sebaliknya.
ALTER TABLE payments ADD COLUMN jenis_pesanan TEXT NOT NULL DEFAULT 'saldo'
  CHECK (jenis_pesanan IN ('saldo','topup_video','langganan'));
ALTER TABLE payments ADD COLUMN paket_id TEXT;
