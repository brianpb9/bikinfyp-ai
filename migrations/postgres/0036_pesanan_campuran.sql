-- PESANAN CAMPURAN — satu invoice boleh memuat paket bulanan DAN kredit satuan.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- KENAPA SEBELUMNYA DILARANG, DAN KENAPA LARANGAN ITU SALAH
-- ─────────────────────────────────────────────────────────────────────────────
-- Alasan awalnya: callback pembayaran harus tahu apa yang dibeli, dan pesanan
-- campuran membuatnya "menebak". Itu keliru — ia tidak perlu menebak sama
-- sekali. Yang dibeli sudah tercatat sebagai DATA: paket ada di payments
-- .paket_id, kredit satuan ada di pesanan_item. Callback tinggal memberikan
-- keduanya kalau keduanya ada.
--
-- Biaya dari larangan itu ditanggung pembeli: yang ingin berlangganan sekaligus
-- menambah beberapa video harus membayar dua kali, ke dua nomor VA berbeda,
-- dan membayar biaya gateway dua kali.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- YANG MENJAGA PEMBERIAN GANDA TETAP MUSTAHIL
-- ─────────────────────────────────────────────────────────────────────────────
-- Tidak ada pagar baru yang dibutuhkan — yang sudah ada sudah cukup, dan itu
-- memang maksudnya dipasang di database sejak awal:
--   uniq_langganan_payment          satu langganan per pembayaran
--   uniq_kredit_beli_per_payment    satu pemberian per (pembayaran, jenis)
-- Jadi callback yang datang berkali-kali untuk pesanan campuran tetap hanya
-- memberi satu kali, untuk kedua bagiannya.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_jenis_pesanan_check;
ALTER TABLE payments ADD CONSTRAINT payments_jenis_pesanan_check
  CHECK (jenis_pesanan IN ('saldo','topup_video','langganan','campuran'));
