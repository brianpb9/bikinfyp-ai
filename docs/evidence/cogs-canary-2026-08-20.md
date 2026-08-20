# COGS nyata per klip & anggaran canary — 20 Agu 2026

Angka di bawah TERUKUR dari tagihan render hari ini, bukan dari tarif yang
dikutip. Lima render, semuanya tercatat di `test_output/`.

## Biaya terukur

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

## Yang BELUM terukur, dan jangan ditebak

Semua angka di atas berasal dari tier **super_hq bersuara**. Biaya nyata tier
`high_quality` belum diukur ulang hari ini. Itu penting karena harga jualnya
jauh lebih rendah:

| Tier | Harga jual per video | Biaya render terukur |
|---|---:|---|
| super_hq | Rp80.000 (paket 5× Rp400.000) | Rp34.965 (15 dtk) |
| high_quality | Rp12.000 (paket 5× Rp60.000) | **belum diukur ulang** |

Kalau `high_quality` memakai tarif per klip yang sama, satu video 15 detik
berbiaya ~Rp34.965 terhadap harga jual Rp12.000 — rugi, bukan margin tipis.
Alarm margin yang sudah tercatat 19 Agu (Rp8.313 vs Rp12.000) memakai angka
lama dan perlu diukur ulang sebelum dipakai mengambil keputusan harga.

**Tindakan yang belum dilakukan:** satu klip uji pada tier `high_quality` untuk
mengunci COGS-nya. Itu ~Rp12.000 dan menjawab pertanyaan harga yang jauh lebih
mahal daripada biaya ujinya sendiri.
