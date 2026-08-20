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

| Tier | Model | Biaya/klip | Video 15 dtk | Harga jual/video | Margin kotor |
|---|---|---:|---:|---:|---:|
| high_quality | `dreamina-seedance-2-0-mini-260615` | Rp2.771 | **Rp8.313** | Rp12.000 | **Rp3.687 (31%)** |
| super_hq | `dreamina-seedance-2-0-260128` | Rp11.655 | **Rp34.965** | Rp80.000 | **Rp45.035 (56%)** |

Harga jual dari paket kredit di `lib/credits.ts` (hq5 Rp60.000/5 video;
super5 Rp400.000/5 video). Margin kotor BELUM memotong TTS, penyimpanan, dan
gagal-render yang harus diulang.

**Koreksi terhadap catatan pagi ini.** Saya menulis bahwa alarm margin 19 Agu
(Rp8.313 vs Rp12.000) "memakai angka lama dan perlu diukur ulang". Pengukuran
hari ini menghasilkan Rp8.313 — angka yang sama persis. Alarmnya benar sejak
awal; yang keliru adalah dugaan saya bahwa ia usang. Alarm margin tetap memakai
angka ini.

**Yang masih menggantung:** kedua angka bergantung pada tarif estimasi (lihat
peringatan cara baca di atas). Keputusan harga jual sebaiknya menunggu satu
pembacaan dasbor tagihan BytePlus untuk mengunci tarif nyata per model —
terutama untuk `high_quality`, yang marginnya paling tipis dan paling mudah
berbalik negatif kalau tarif sebenarnya lebih tinggi dari estimasi BRD.
