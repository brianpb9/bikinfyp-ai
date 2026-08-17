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

## Spike C — dijalankan, dan jawabannya TIDAK

Diuji 17 Agu (setelah kredit Gemini diisi ulang), dalam bentuk keputusan 5c: frame turunan, bukan selfie mentah.

**Paket CAST-REF berhasil** (`castref-pack-alya.jpg`): tiga frame satu orang yang sama, pakaian sama, ruangan sama, kulit bertekstur nyata. Frame kedua dan ketiga diturunkan dari yang pertama — bukan tiga generate mandiri, karena tiga generate mandiri menghasilkan tiga orang yang mirip tapi berbeda. Biaya Rp1.950 per avatar.

**Frame turunan berhasil** (`derived-frames.jpg`): berwajah dan tanpa-wajah, keduanya mempertahankan produk dan identitas.

**Seedance MENOLAK frame berwajah:**

```
HTTP 400: The request failed because the input image 'content[1]'
may contain real person.
Request id: 0217869633553829e96f8c80ac47960a454270e9930f95432d99e
```

Itu error yang **sama persis** dengan foto wajah asli (insiden 12 Agu). Detektornya tidak membedakan wajah buatan dari wajah nyata — ia menolak wajah apa pun. Informasi eksternal Brian terbukti benar.

**Seedance MENERIMA frame tanpa wajah** (`C-no-face.mp4`, `C-no-face-montase.jpg`): selesai 213 dtk, audio AAC mean −20,4 dB, dua tangan benar, label "SCARLETT / ACNE SERUM / 3X" terbaca sepanjang klip.

Satu batas yang jujur harus dicatat: bentuk botolnya bergeser sedikit di tahap turunan (dropper jadi pump). Pergeseran itu terjadi di langkah GEMINI, bukan di Seedance — jadi frame turunan perlu diperiksa sebelum dipakai, bukan dipercaya begitu saja.

**Konsekuensi:** `SEEDANCE_FACE_REF` bawaannya **false**. Jalur hidup adalah frame turunan tanpa wajah + identitas avatar lewat deskripsi teks. Paket CAST-REF tetap dibangun — Gemini menerimanya, ia dibutuhkan di tahap gambar, dan ia siap pakai pada hari Seedance membuka referensi wajah.

`hands_only` tetap jalur yang direkomendasikan untuk merek yang menuntut konsistensi maksimal.

---

## Catatan yang lahir dari spike ini

**Kredit Gemini habis memutus TTS produksi.** Kunci yang sama dipakai `first-frame.ts` dan `gemini-tts.ts`. Saat 429, setiap video bersuara akan gagal di tahap suara — dan tidak ada alarm yang memberi tahu. Layak dipantau tersendiri.

**Foto produk di sistem sebagian besar bukan foto asli.** Dari 8 produk berfoto, 4 memakai gambar AI yang labelnya sendiri gibberish ("Sdadpgeer", "NNSONGO"). Itu yang melahirkan gerbang OCR intake (keputusan 3): menolak di unggahan, sebelum sepeser pun ditahan.
