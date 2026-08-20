# COGS nyata per klip & anggaran canary — 20 Agu 2026

## Peringatan cara baca — dikoreksi 20 Agu sore

Angka rupiah di bawah BUKAN tagihan. Penyedia tidak mengembalikan data
pemakaian pada respons kita, jadi biayanya dihitung dari tabel tarif di
`lib/providers/stubs/byteplus.ts` — dan tarif kedua model dreamina di sana
ditandai sendiri sebagai "ESTIMASI dari COGS BRD §5.3". Log tiap render pun
menuliskannya: `biaya Rp… (estimasi tarif)`.

Yang benar-benar terukur: model mana yang dipakai, berapa detik, berapa klip.
Rupiahnya turunan tarif. Versi pertama catatan ini menulis "TERUKUR dari
tagihan render" — itu klaim yang lebih besar dari kenyataan, dan diperbaiki di
sini. Angka pastinya hanya bisa datang dari dasbor tagihan BytePlus.

## Biaya per klip (super_hq)

| Yang diukur | Nilai | Sumber |
|---|---|---|
| Satu klip 5 dtk, super_hq, bersuara | **Rp11.655** | log BytePlus 5x hari ini, konsisten |
| Video 15 dtk (3 klip) | **Rp34.965** | render video penuh 20 Agu |
| Packshot penutup 1,8 dtk | Rp0 | ffmpeg lokal, tidak menyentuh penyedia |
| VO Gemini per video | dihitung terpisah, kecil | log `vo.wav` |
| Pengeluaran hari ini | **Rp81.635** | 5 klip + 2 klip yang ditolak gerbang = Rp0 |

Model: `dreamina-seedance-2-0-260128`, audio aktif.

## Anggaran canary Rp250.000 — keluaran yang bisa diharapkan

Anggarannya TETAP Rp250.000. Yang turun adalah jumlah keluarannya, dan itu
harus dikatakan di muka supaya rencana canary berikutnya tidak disusun dengan
angka lama.

| Bentuk uji | Biaya per satuan | Muat dalam Rp250.000 |
|---|---:|---:|
| Klip tunggal 5 dtk (super_hq) | Rp11.655 | **21 klip** |
| Video penuh 15 dtk (3 klip) | Rp34.965 | **7 video** |
| Video penuh 30 dtk (5–6 klip) | ~Rp58.275–69.930 | **3–4 video** |

Canary 12 klip yang lalu berarti ~Rp139.860 dengan tarif sekarang — masih muat,
tapi menyisakan ruang untuk hanya tiga klip ulang, bukan selusin.

## COGS per tier — high_quality SUDAH diukur (20 Agu, diotorisasi Brian)

Satu klip uji dijalankan pada tier `high_quality` (`scripts/ukur-cogs-tier.ts`,
task `cgt-20260820193542-qsc7j`). Modelnya BERBEDA dari super_hq, dan itulah
yang menentukan selisihnya:

| Tier | Model | Per 5 dtk | Per detik | Video 15 dtk | Harga jual/video | Margin kotor |
|---|---|---:|---:|---:|---:|---:|
| high_quality | `dreamina-seedance-2-0-mini-260615` | Rp2.771 | Rp554 | **Rp8.313** | Rp12.000 | **Rp3.687 (31%)** |
| super_hq | `dreamina-seedance-2-0-260128` | Rp11.655 | Rp2.331 | **Rp34.965** | Rp80.000 | **Rp45.035 (56%)** |

Margin di atas KOTOR — belum memotong frame buatan (±Rp650), QC vision (±Rp12),
TTS, penyimpanan, dan render gagal yang harus diulang.

**Angka yang dipakai untuk keputusan dan alarm: margin retail ~25%**
(Rp3.000 dari Rp12.000 untuk high_quality 15 detik), sesuai hitungan board
19 Agu yang memasukkan frame dan QC vision. Yang 31% jangan dipakai — ia
mengabaikan dua biaya yang selalu ada.

Harga jual dari paket kredit di `lib/credits.ts` (hq5 Rp60.000/5 video;
super5 Rp400.000/5 video). Margin kotor BELUM memotong TTS, penyimpanan, dan
gagal-render yang harus diulang.

**Satuannya DETIK, bukan klip.** Ini koreksi kedua atas tulisan saya sendiri,
dan penting karena dua catatan kita nyaris saling bertentangan tanpa alasan.

Board 19 Agu menulis "klip bersuara = Rp8.313". Pengukuran hari ini menulis
"klip = Rp2.771". Keduanya benar dan tidak bertabrakan: klip 19 Agu berdurasi
15 detik, klip hari ini 5 detik, dan tarifnya per detik — 3 × Rp2.771 = Rp8.313.

Jadi yang menentukan biaya adalah TOTAL DETIK yang dirender, bukan berapa
potong ia dibelah. Video 15 detik high_quality berbiaya Rp8.313 entah ia satu
klip panjang atau tiga klip pendek.

Saya sempat menulis bahwa angka 19 Agu "sama persis" dengan hari ini sebagai
konfirmasi. Itu benar hasilnya tapi salah alasannya — saya membandingkan dua
satuan berbeda yang kebetulan bertemu. Alarm margin 19 Agu memang tetap sah;
dasarnya konsistensi tarif per detik, bukan kebetulan numerik.

**Yang masih menggantung:** kedua angka bergantung pada tarif estimasi (lihat
peringatan cara baca di atas). Keputusan harga jual sebaiknya menunggu satu
pembacaan dasbor tagihan BytePlus untuk mengunci tarif nyata per model —
terutama untuk `high_quality`, yang marginnya paling tipis dan paling mudah
berbalik negatif kalau tarif sebenarnya lebih tinggi dari estimasi BRD.
