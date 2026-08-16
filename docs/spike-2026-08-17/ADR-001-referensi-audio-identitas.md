# ADR-001 — Mode referensi, audio native, dan tempat identitas avatar dikunci

**Tanggal:** 17 Agustus 2026 · **Status:** diterima · **Pemutus:** Brian
**Bukti:** `docs/spike-2026-08-17/` — dua klip 5 detik berbayar (Rp5.542), foto Scarlett Acne Serum

---

## Konteks

Video keluaran BikinFYP "benar tapi datar". Tiga dugaan penyebab diuji dengan render sungguhan, bukan dibahas:

1. mode referensi mana yang menjaga label produk,
2. apakah Seedance benar-benar bisa menghasilkan suara dan mulut yang sinkron,
3. di tahap mana identitas avatar bisa dikunci.

---

## Keputusan 1 — Bawaan retail menjadi r2v (`reference_image`); i2v tinggal cadangan

**Kenapa, dari frame yang bisa dilihat:**

| | i2v (`first_frame`) | r2v (`reference_image`) |
|---|---|---|
| Nama merek | **"SCARLFTT"** — huruf rusak | **"SCARLETT"** — utuh |
| Detik pertama | **foto produk diam** | langsung adegan |
| Waktu render | 233 dtk | **111 dtk** |

Dua hal yang menentukan:

- **i2v merusak nama merek.** Untuk produk yang dibayar merek, itu bukan detail kosmetik.
- **i2v memaksa pack shot.** Frame pertamanya *harfiah* foto produknya. Playbook melarang membuka dengan pack shot, dan larangan itu **mustahil dipenuhi lewat prompt** selama modenya i2v — sifat mode, bukan kekurangan kalimat.

Ini sekaligus menjelaskan kenapa perbaikan "jangan buka dengan pack shot" yang ditulis 16 Agu tidak akan pernah bekerja di jalur retail.

**Konsekuensi:** `preferI2v` disediakan sebagai jalan keluar eksplisit. i2v tetap wajib untuk model 1.0 (tier senyap) yang tidak mendukung r2v. r2v menolak durasi < 4 detik — aman, segmen kita 4–6 detik.

---

## Keputusan 2 — Audio native Seedance jadi bawaan untuk `talking_head` dan `tvc`

Sebelumnya hanya Wajah AI di tier Super HQ yang mempertahankan audio model; sisanya selalu diganti Gemini TTS. Akibatnya prompt harus melarang mulut presenter sinkron ke kata mana pun (`no lip-sync to any specific words`) — **kita membayar model untuk menggerakkan mulut, lalu melarangnya bicara.**

Spike membuktikan asumsi itu tidak perlu: AAC 32 kHz, mean −21 dB, mulut membentuk kata di detik 0,5 / 2,5 / 4,5.

**Gemini TTS tetap** untuk `hands_only` dan `vo_broll` — di sana pembicaranya memang tidak pernah terlihat, jadi narasi luar-kamera adalah bentuk yang benar, bukan kompromi.

---

## Keputusan 5 — Identitas avatar dikunci di tahap GAMBAR, bukan tahap video

Yang sudah diketahui: **Gemini menerima wajah AI sebagai referensi; Seedance 2/2.5 belum.**

Karena itu urutannya:

1. Satu **CAST-REF pack** per avatar (25) dibuat dengan Gemini image: selfie netral, produk-di-tangan, close-up. Disimpan di R2, dikunci per id avatar.
2. Per segmen, frame awal **diturunkan** dari CAST-REF + foto produk (*"Keep exactly the same … Change only this: <start_state>"*).
3. Frame turunan itu (adegan berisi wajah + produk + ruangan) dikirim sebagai `reference_image` ke Seedance r2v.
4. Kalau Seedance menolak frame yang memuat wajah AI → mundur ke frame tanpa wajah + deskripsi teks avatar. **Perilaku ini berada di balik satu flag** supaya bisa dibalik begitu Seedance membuka referensi wajah.

`hands_only` tetap jalur yang **direkomendasikan** untuk merek yang menuntut konsistensi maksimal — dan itu harus tertulis di pemilih template, bukan jadi pengetahuan internal.

---

## Yang TIDAK diputuskan di sini

Spike C (dua referensi: produk + CAST-REF) **belum pernah berhasil dijalankan** — Gemini kehabisan kredit prabayar (HTTP 429) tepat saat CAST-REF dibuat. Kredit sudah diisi ulang; C akan diulang **dalam bentuk keputusan 5c** (frame turunan sebagai referensi), bukan selfie mentah.

Sampai itu dijalankan, klaim "Seedance menerima wajah AI" **belum terbukti** dan tidak boleh ditulis sebagai fakta.

---

## Catatan yang lahir dari spike ini

**Kredit Gemini habis memutus TTS produksi.** Kunci yang sama dipakai `first-frame.ts` dan `gemini-tts.ts`. Saat 429, setiap video bersuara akan gagal di tahap suara — dan tidak ada alarm yang memberi tahu. Layak dipantau tersendiri.

**Foto produk di sistem sebagian besar bukan foto asli.** Dari 8 produk berfoto, 4 memakai gambar AI yang labelnya sendiri gibberish ("Sdadpgeer", "NNSONGO"). Itu yang melahirkan gerbang OCR intake (keputusan 3): menolak di unggahan, sebelum sepeser pun ditahan.
