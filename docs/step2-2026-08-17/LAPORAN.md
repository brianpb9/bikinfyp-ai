# STEP 2 — jalankan penuh, naskah LLM → frame turunan → klip per segmen

**Tanggal:** 17 Agustus 2026 · **Biaya:** Rp9.637 · **Bukti:** `final.mp4`, `montase.jpg`, `naskah.json`, `prompt-seg0..2.json` di folder ini

---

## Yang diminta vs yang dijalankan

Job `825f4225` **tidak bisa dijalankan apa adanya**: foto produknya AI-slop dan
ditolak gerbang intake kita sendiri (keputusan 3). Menjalankannya berarti
menguji pipeline dengan masukan yang sudah kita putuskan tidak sah.

Jadi bentuk job-nya dipertahankan (15 detik, `talking_head`, register bestie)
dan **fotonya diganti Scarlett Acne Serum** — foto asli yang lolos intake. Ini
substitusi yang disengaja, bukan kelalaian.

## 1. Naskah — ditulis LLM, bukan template

`POST /v1/messages` 200. Log `JATUH KE TEMPLATE` tidak muncul.

| | blok | produk | dialog |
|---|---|---|---|
| 0–4 dtk | HOOK / PROVOCATION | hidden | "Jerawat udah hilang, bekasnya masih bandel?" |
| 4–10 dtk | BODY / DEMO | partial | "Ini serum yang aku pakai tiap malam, teksturnya ringan banget di kulit." |
| 10–15 dtk | CTA / REVEAL | hero | "Cuma tujuh puluh lima ribu, cek di keranjang kuning ya!" |

Arc `product_state` benar: hook tidak pernah hero, CTA selalu hero. Hook tidak
menyebut nama produk. Harga ditulis kata, bukan angka.

## 2. QC-F1 — pass rate

| peran | lolos | dalam ≤2 gulung ulang | ambang Brian |
|---|---|---|---|
| hero | 1/1 (100%) | ya, 0 ulang | ≥70% |
| partial | 1/1 (100%) | ya, 0 ulang | — |

Segmen 0 dilewati: produknya `hidden`, tidak ada yang bisa dinilai.

**Ambang 70% tidak tersentuh, jadi prompt penurunan TIDAK diubah.** Basisnya
kecil (satu frame hero) — angka ini belum layak dibaca sebagai tingkat
keberhasilan yang stabil.

## 3. Video

`final.mp4` 15,296 dtk, AAC, mean −19,0 dB. 3/3 klip r2v dengan audio native.
Label "SCARLETT / ACNE SERUM / OIL CONTROL & ANTI BACTERIAL" terbaca di
close-up. Tidak ada pack shot di detik pertama.

---

## Dua cacat yang ditemukan justru OLEH arsip prompt

### a. Arsipnya sendiri berbohong soal mode referensi — SUDAH DIPERBAIKI

Ketiga segmen tercatat `first_frame (i2v)`. Yang benar-benar dikirim ke
ModelArk adalah `reference_image (r2v)` — dibuktikan dengan memanggil
`buildTaskContent()` langsung.

Sebabnya: `ringkasSpec()` menurunkan sendiri mode-nya dengan aturan LAMA (ada
foto tambahan → r2v). Sejak r2v jadi bawaan (ADR-001 keputusan 1), aturan itu
tidak lagi sama dengan aturan provider.

Arsip yang salah lebih berbahaya daripada tidak ada arsip: ia dipakai untuk
membedah video jelek, dan akan mengarahkan pembedahan ke mode yang tidak pernah
dipakai. Aturannya sekarang **satu salinan** (`modeReferensi()` di provider),
pencatat memanggilnya, dan model ikut tercatat. Dijaga tes yang sudah dibuktikan
gagal pada kode lama.

### b. Segmen `hidden` tetap dikirimi foto produk — SUDAH DIPERBAIKI (lihat bagian bawah)

Segmen 0 memakai foto produk mentah sebagai referensi, padahal naskahnya
menyuruh produk tidak tampil. Model diberi barang yang diperintahkan
disembunyikan.

Ini bukan cuma di skrip uji: di produksi, `planShots()` memberi
`input.imageRefPath` (foto produk asli) ke **setiap** shot, hook termasuk.
Digabung dengan r2v-bawaan, artinya setiap hook retail sekarang membawa foto
produk sebagai referensi.

Perbaikannya adalah sisa pemasangan STEP 2 (di bawah).

---

## Status jujur

| | keadaan |
|---|---|
| STEP 1 (naskah LLM) | **terpasang di produksi** — `generateOne()` memakai `tulisNaskah()`, jatuh ke template dicatat keras |
| STEP 2 (CAST-REF → frame turunan → QC-F1) | **terbukti jalan, BELUM terpasang di worker** — masih pustaka + skrip |

Yang tersisa untuk memasang STEP 2 di worker:

1. frame awal per segmen diturunkan dari CAST-REF, menggantikan foto produk di `imageRefPath`;
2. segmen `hidden` memakai frame tanpa produk — bukan foto produk;
3. verdict QC-F1 disimpan (migrasi 0033 `qc_f1_json`, ditunda sampai 0030/0031 dipasang);
4. keputusan biaya: satu frame turunan Rp650 + QC Rp12 per segmen.

## Batas yang harus disebut

Identitas orangnya **bergeser antar segmen** di montase — segmen 0 bukan orang
yang sama dengan 1 dan 2, dan pakaiannya berubah. Itu konsekuensi memecah
`talking_head` jadi tiga klip terpisah sementara `SEEDANCE_FACE_REF=false`:
wajah tidak bisa dikunci lewat referensi, hanya lewat deskripsi teks.

Ini menguatkan, bukan membantah, rekomendasi ADR-001: `hands_only` tetap jalur
untuk merek yang menuntut konsistensi maksimal. Untuk `talking_head` multi-klip,
konsistensi wajah belum terpecahkan dan tidak boleh dijanjikan.

---

## Perbaikan yang menyusul laporan ini (17 Agu, setelah montase diperiksa)

### b. Segmen `hidden` sekarang benar-benar menahan produk

`product_state` dari LLM dulu dibuang di `keSegmentDraft()`. Sekarang ia ikut ke
`SegmentDraft` dan dibaca `menahanProdukDiShot()`, jadi shot yang dibuka segmen
`hidden` mendapat frame buatan tanpa produk — dan ia yang diprioritaskan saat
jatah frame per tier cuma satu.

**Tesnya menemukan cacat di perbaikan itu sendiri.** Versi pertama memakai
"ada segmen hidden di shot ini". Pada `talking_head` 15 detik — yang sengaja
TIDAK dipecah karena wajahnya bergeser antar klip — hook, demo, dan CTA berada
di satu klip yang sama, jadi aturan itu akan menahan produk sepanjang video
termasuk CTA yang justru harus hero. Yang benar: baca segmen **paling awal**,
karena `withholdProduct` mengatur frame pertama, bukan seluruh klip.

Jalur template lama tidak berubah: tanpa `product_state`, perilakunya persis
seperti sebelumnya (ada tesnya).

### Yang TIDAK dikerjakan, dan alasannya

Memasang frame turunan CAST-REF untuk **setiap** segmen di worker ditahan,
bukan lupa. Biayanya Rp650 + Rp12 per segmen = Rp1.986 untuk tiga segmen,
sedangkan margin `high_quality` Rp3.198 — 62% margin, jauh di atas batas ~25%
yang sudah tertulis dan dijaga tes di `MAKS_FRAME_PER_TIER`.

Itu keputusan harga, bukan keputusan teknis, jadi bukan milik saya. Pilihannya:
naikkan harga tier, terima margin lebih tipis, atau batasi frame turunan ke
`super_hq` saja (jatahnya sudah 6).
