-- RIWAYAT PANGGILAN PROVIDER VIDEO — apa yang dikirim, apa yang dijawab.
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Brian 9 Sep 2026 meminta menu riwayat respons API dan generation id BytePlus
-- di admin. Sampai kini datanya memang tidak ada di mana pun yang bisa dibaca:
--
--   provider_tasks  adalah tabel MEMO, dan barisnya DIHAPUS setelah job selesai
--                   (lib/postgres/task-memo.ts). Isinya 2 baris.
--   job_prompts     menyimpan spec dan model_params, tapi tidak satu pun
--                   jawaban provider.
--   log kontainer   memuatnya, tapi hilang saat kontainer dibuat ulang — dan
--                   deploy blue/green membuat itu terjadi beberapa kali sehari.
--
-- Akibatnya, saat sebuah job gagal, satu-satunya cara mengetahui task id-nya
-- adalah membuka log kontainer SEBELUM deploy berikutnya menghapusnya. Itu
-- bukan jejak audit; itu keberuntungan.
--
-- ---------------------------------------------------------------------------
-- APA YANG SENGAJA TIDAK DISIMPAN
-- ---------------------------------------------------------------------------
-- 1. BADAN PERMINTAAN. Permintaan BytePlus memuat GAMBAR ACUAN sebagai data
--    URI base64 — satu baris bisa ratusan kilobita, dan isinya foto produk
--    pelanggan. Yang disimpan hanya ringkasannya (model, jumlah gambar, durasi).
--
-- 2. KREDENSIAL. Header Authorization tidak pernah masuk ke sini. Kolomnya pun
--    tidak ada, supaya tidak ada tempat untuk menaruhnya karena kelalaian.
--
-- 3. JAWABAN UTUH TANPA BATAS. response_ringkas dipotong di sisi aplikasi;
--    kolomnya TEXT tapi yang menulis wajib memotong. Jawaban gagal kadang
--    memuat pantulan seluruh permintaan, termasuk base64 yang barusan kita
--    hindari menyimpannya.
CREATE TABLE provider_log (
  id TEXT PRIMARY KEY,
  -- job_id TIDAK memakai foreign key.
  --
  -- Log ini justru paling berguna untuk job yang gagal, dan job gagal kadang
  -- dibersihkan. Kalau barisnya ikut terhapus, yang hilang tepat adalah bukti
  -- yang paling dibutuhkan saat menjelaskan kegagalan kepada pelanggan.
  job_id TEXT,
  shot_index INTEGER,
  provider TEXT NOT NULL,
  model TEXT,
  /** generation id / task id dari provider — inti permintaan Brian. */
  task_id TEXT,
  /** submit | poll | selesai | gagal */
  fase TEXT NOT NULL CHECK (fase IN ('submit','poll','selesai','gagal')),
  http_status INTEGER,
  /** Ringkasan permintaan, BUKAN badannya. Lihat catatan di atas. */
  request_ringkas TEXT,
  /** Jawaban provider, sudah dipotong pemanggil. */
  response_ringkas TEXT,
  error TEXT,
  durasi_ms INTEGER,
  /** Dari usage provider bila ada; NULL berarti tidak dilaporkan. */
  token_terpakai INTEGER,
  biaya_idr INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_provider_log_waktu ON provider_log(created_at DESC);
CREATE INDEX idx_provider_log_job ON provider_log(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX idx_provider_log_task ON provider_log(task_id) WHERE task_id IS NOT NULL;
