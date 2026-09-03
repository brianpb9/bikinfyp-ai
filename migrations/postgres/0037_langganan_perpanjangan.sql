-- PERPANJANGAN LANGGANAN — membeli paket yang SAMA menambah masa, bukan
-- melahirkan periode kedua.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- MASALAH YANG DIPERBAIKI
-- ─────────────────────────────────────────────────────────────────────────────
-- Sampai sekarang, membeli paket yang sama saat paket itu masih aktif membuat
-- periode KEDUA berdampingan dengan yang pertama. Kuotanya dijumlah, tapi
-- masing-masing hangus pada tanggalnya sendiri.
--
-- Dijalankan sebagai skenario nyata: pembeli dengan sisa 3 video dan 5 hari
-- lagi, lalu membeli Mulai lagi, mendapat 9 video — TAPI 3 di antaranya hangus
-- dalam 5 hari. Urutan pemakaian "paling cepat hangus dulu" memperkecil
-- kerugiannya, tidak menghilangkannya. Dan orang yang membeli paket yang sama
-- sedang berpikir "perpanjang", bukan "beli periode kedua".
--
-- Sekarang: paket SAMA -> kuota ditambahkan ke periode yang ada dan tanggal
-- berakhirnya didorong. Paket BERBEDA -> tetap menumpuk, karena di situ tidak
-- ada yang hilang dan menumpuk memang yang benar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- KENAPA BUTUH TABEL SENDIRI
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotensinya pindah. Selama ini "satu pembayaran = satu langganan" dijaga
-- indeks unik uniq_langganan_payment. Perpanjangan tidak melahirkan baris
-- langganan baru, jadi indeks itu tidak lagi menjaga apa pun — dan callback
-- Duitku yang datang dua kali akan mendorong tanggalnya dua kali.
--
-- Kunci primer di payment_id memulihkan penjagaan itu: satu pembayaran hanya
-- bisa memperpanjang satu kali, ditegakkan database, bukan pembacaan "kalau
-- belum ada" yang bisa dilewati dua proses.
--
-- Sekalian ia menjadi jejak: tanggal SEBELUM dan SESUDAH dicatat, sehingga
-- pertanyaan "kenapa langganan saya berakhir tanggal itu" punya jawaban yang
-- bisa dibaca, bukan disimpulkan.
CREATE TABLE langganan_perpanjangan (
  payment_id TEXT PRIMARY KEY,
  langganan_id TEXT NOT NULL REFERENCES langganan(id),
  paket_id TEXT NOT NULL,
  kuota_standard INTEGER NOT NULL DEFAULT 0,
  kuota_premium INTEGER NOT NULL DEFAULT 0,
  kuota_ultra INTEGER NOT NULL DEFAULT 0,
  hari INTEGER NOT NULL,
  berakhir_sebelum TEXT NOT NULL,
  berakhir_sesudah TEXT NOT NULL,
  dibuat_pada TEXT NOT NULL
);
CREATE INDEX idx_perpanjangan_langganan ON langganan_perpanjangan(langganan_id);
