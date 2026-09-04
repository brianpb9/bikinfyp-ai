-- PEMETAAN MODEL PER PAKET — mesin & model dipilih dari /admin, bukan dari kode.
--
-- ---------------------------------------------------------------------------
-- KENAPA
-- ---------------------------------------------------------------------------
-- Permintaan Brian 4 Sep 2026: "pada halaman admin terdapat opsi mapping untuk
-- package standard, premium dan ultra. Disini saya bisa menentukan model apa
-- yang saya gunakan sehingga memungkinkan ekspansi bisnis model apabila rasanya
-- kedepan muncul efisiensi bisnis dengan perubahan model untuk setiap
-- packagenya."
--
-- Sampai kini mesin dan model dipaku di lib/kualitas-video.ts. Mengganti model
-- Premium berarti mengubah kode, membangun ulang image, dan men-deploy — dan
-- deploy hari ini terbukti membunuh proses yang sedang berjalan. Keputusan
-- yang sifatnya komersial (mesin mana yang paling untung bulan ini) tidak
-- seharusnya menuntut rilis.
--
-- ---------------------------------------------------------------------------
-- YANG SENGAJA TIDAK DISIMPAN DI SINI
-- ---------------------------------------------------------------------------
-- HARGA JUAL dan COGS. Keduanya sudah punya tempatnya sendiri
-- (harga_kredit_video, paket_langganan, config.tiers.cogsIdr), dan menyalinnya
-- ke tabel ini akan membuat dua angka yang harus sepakat — bentuk kesalahan
-- yang repo ini sudah bayar berkali-kali. Tabel ini hanya menjawab satu
-- pertanyaan: paket ini dirender pakai mesin & model apa.
--
-- Baris yang TIDAK ADA berarti "pakai bawaan kode" — jadi tabel kosong sama
-- persis dengan perilaku sebelum migrasi ini. Itu disengaja: fitur baru tidak
-- boleh mengubah apa pun sampai seseorang benar-benar memakainya.
CREATE TABLE IF NOT EXISTS pemetaan_model (
  kualitas         TEXT PRIMARY KEY,
  mesin            TEXT NOT NULL,
  model            TEXT NOT NULL,
  diperbarui_pada  TEXT NOT NULL,
  diperbarui_oleh  TEXT NOT NULL,
  CONSTRAINT pemetaan_model_kualitas_dikenal CHECK (kualitas IN ('standard', 'premium', 'ultra')),
  CONSTRAINT pemetaan_model_mesin_dikenal    CHECK (mesin IN ('kie-grok', 'byteplus')),
  -- Model kosong akan membuat provider memanggil penyedia tanpa model dan
  -- gagal DI UJUNG, sesudah gambar dibayar. Ditolak di sini.
  CONSTRAINT pemetaan_model_model_terisi     CHECK (length(trim(model)) > 0)
);
