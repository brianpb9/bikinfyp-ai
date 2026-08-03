# Draf Listing Play Store — BikinFYP AI

Draf ini disiapkan berdasarkan produk yang benar-benar ada (kredit, format Tangan/Wajah AI/VO+Foto, register bunda/bestie/genz/netral) — tinggal copy-paste ke Play Console, boleh diedit dulu sebelum submit.

## Nama app (maks 30 karakter)
```
BikinFYP AI
```
(29 karakter kalau ditambah tagline pendek: "BikinFYP AI: Video Jualan" — 26 karakter, masih ada sisa. Pilih salah satu.)

## Deskripsi singkat (maks 80 karakter)
```
Bikin video jualan AI dari foto produk — tanpa syuting, langsung siap posting.
```
(79 karakter)

## Deskripsi lengkap (maks 4000 karakter)
```
Capek syuting tiap mau posting produk baru? BikinFYP AI bikinin video jualan gaya UGC dari foto produkmu — tinggal upload foto, pilih gaya, videonya jadi dalam hitungan menit.

CARA KERJANYA
1. Upload foto produk + isi nama & harga
2. Pilih gaya kreator (Hijaber, Lokal, Chindo, Gen-Z, Pria, Ibu-ibu) dan suara (Bunda, Bestie, Gen-Z, Netral)
3. Pilih format: Tangan Saja (tanpa wajah), Wajah AI (presenter AI), atau VO + Foto (foto asli + suara)
4. Skrip otomatis dibuatkan — bisa langsung dipakai atau diedit dulu
5. Video jadi, siap diunggah ke TikTok Shop atau Shopee

FITUR UTAMA
• Skrip otomatis dengan 16 gaya hook berbeda, disesuaikan kategori produkmu
• 4 pilihan suara/gaya bicara: Bunda, Bestie, Gen-Z, Netral
• 3 tier kualitas: Senyap + Teks (paling hemat), High Quality (suara AI), Super HQ
• Durasi 15 atau 30 detik
• Setiap video otomatis diberi label "Dibuat dengan AI" sesuai aturan platform
• Sistem kredit — bayar sesuai pakai, kredit dikembalikan otomatis kalau videonya gagal kualitas

BUAT SIAPA
Penjual online di TikTok Shop, Shopee, dan platform lain yang butuh video jualan rutin tapi nggak sempat/nggak mau syuting sendiri tiap kali ada produk baru.

Video yang dihasilkan adalah konten buatan AI (AI-generated content), sesuai kebijakan platform — label AIGC sudah tertanam otomatis di setiap video.
```

## Kategori
Rekomendasi: **Business** (bukan "Video Players & Editors") — karena target penggunanya penjual online yang mau bikin konten jualan, bukan orang yang nonton/edit video buat konsumsi pribadi. Kamu yang putuskan, ini cuma rekomendasi.

## Kata kunci ASO (buat riset lebih lanjut, bukan field resmi Play Store)
video jualan, video AI, UGC AI, TikTok Shop, Shopee video, bikin video produk, video tanpa syuting, AI video generator, konten jualan online

---

# Draf Data Safety Form (Play Console)

Berdasarkan data yang BENAR-BENAR dikumpulkan sistem (lihat lib/config.ts, app/legal/privacy):

| Jenis data | Dikumpulkan? | Untuk apa | Dibagikan ke pihak ketiga? |
|---|---|---|---|
| Nama | Ya (nama produk, bukan nama pengguna) | Fungsi app | Tidak |
| Email | Ya (login) | Autentikasi | Resend (pengiriman email OTP) |
| Nomor telepon | Ya (login alternatif) | Autentikasi | Tidak |
| Foto | Ya (foto produk) | Fungsi app (generate video) | BytePlus (AI video-gen), Cloudflare R2 (storage) |
| Info pembayaran | Ya (saat top-up aktif) | Transaksi | Midtrans |
| ID perangkat/iklan | Tidak | — | — |

**Apakah data dienkripsi saat transit?** Ya (HTTPS/TLS di semua koneksi).
**Apakah pengguna bisa minta hapus data?** Ya (lihat app/legal/privacy — kontak hdrvstudio@gmail.com).
**Apakah app menargetkan anak-anak?** Tidak — layanan untuk pelaku usaha 18+ (lihat Syarat & Ketentuan).

---

**Catatan:** ini draf teks siap pakai, bukan pengganti pengisian form resmi Play Console — kamu tetap perlu masuk dan isi form-nya sendiri (checkbox-checkbox-nya nggak bisa saya isi lewat sini), tapi jawabannya tinggal disalin dari tabel di atas.
