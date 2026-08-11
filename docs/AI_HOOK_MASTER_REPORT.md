# Laporan Lengkap Riset AI Hook — 30 Ide, 6 Gelombang

**Periode:** 4–10 Agustus 2026 · **Penilai:** Brian (founder) · **Skala:** 0–5

Dokumen ini adalah rekaman lengkap seluruh eksperimen prompt AI hook: apa yang
dicoba, nilai yang diberikan, dan **pola apa yang terbukti menang atau gagal**.
Prompt penuh tiap ide ada di v1–v6; dokumen ini isinya kesimpulan.

---

## 1. Papan nilai lengkap

### Pemenang (≥4.6)

| # | Ide | Nilai | Gelombang |
|---|---|---:|---|
| **30** | **KRL menembus ruang tamu, dia duduk santai** | **4.8** | v6 |
| **8** | **Waktu berhenti di pasar** | **4.8** | v2 |
| 5 | Produk raksasa di gang + kamera dorong masuk | 4.7 | v1 |
| 6 | Ojol turun tembok, serahkan paket | 4.7 | v2 |
| 2 | Produk jatuh dari langit, ditangkap | 4.6 | v1 |

### Menengah (4.0–4.5)

| # | Ide | Nilai | Catatan |
|---|---|---:|---|
| 1 | Shockwave dari produk | 4.5 | |
| 3 | Rakit-sendiri (putar-balik) | 4.5 | sambungan paling presisi secara teknis |
| 13 | Dunia ngebut time-lapse, dia diam | 4.3 | |
| 15 | Mati lampu, satu jendela menyala | 4.3 | satu-satunya yang ditulis khusus powerbank |
| 4 | Sapuan dua dunia | 4.0 | terasa trik editing |
| 10 | Angkot, semua pegang barang sama | 4.0 | idenya bagus tapi salah produk |

### Gagal (13 ide)

| # | Ide | Alasan gagal |
|---|---|---|
| 7 | Rebutan seribu tangan | "aneh" — anatomi jebol |
| 9 | Tangan keluar dari layar HP | "AI slop" — trope basi |
| 11 | Antrean mengular di gang | kebanyakan orang, AI kelihatan |
| 12 | Semua menoleh di warung | kebanyakan orang, generate gagal |
| 14 | Tidak ada yang sanggup mengangkat | konsepnya sendiri lemah |
| 16–20 | Gelombang 4 (nyaris pecah, gravitasi mati, kotak tak habis, domino, rontok jadi debu) | terlalu standar |
| 21–25 | Gelombang 5 (merayap ke tepi, nyaris jatuh, kupas film, tumpukan goyang, kabel kusut) | terlalu standar — "bukan AI hook" |
| 26 | Meteor | **terlalu cartoon** |
| 27 | Tembok debu menelan kampung | **tidak nyambung ke produk** |
| 28 | Kota terlipat ke langit | gagal |
| 29 | Petir beruntun, ruangan berubah tiap kilat | gagal |

**Rekap:** 30 ide · 2 tertinggi di 4.8 · 13 gagal total · belum ada yang 5.

---

## 2. Pola pemenang

Kelima ide bernilai ≥4.6 punya kesamaan yang tidak dimiliki satu pun ide gagal:

**Yang mustahil selalu BENDA NYATA & AKRAB yang berperilaku mustahil.**

- KRL (4.8) — semua orang Jakarta tahu persis bentuk dan bunyinya
- Pasar (4.8) — pasar sungguhan, cuma waktunya yang beku
- Produk raksasa (4.7) — produknya sendiri, cuma skalanya salah
- Ojol (4.7) — motor dan kurir, cuma arah gravitasinya salah
- Jatuh dari langit (4.6) — produknya sendiri, cuma asalnya mustahil

Bandingkan dengan gelombang 6 yang gagal: **meteor, tembok debu, kota melipat,
petir yang mengubah dunia** — semuanya **fenomena, bukan benda**. Tidak ada
jangkar yang dikenal penonton, jadi otak langsung membacanya sebagai CGI.
Itu arti "terlalu cartoon".

> **Aturan I — Pilih benda, bukan fenomena.**
> Kereta, motor, truk, becak, gerobak, kulkas, kipas angin: aman.
> Meteor, badai, gempa, petir, ledakan kosmik: terbaca kartun.

---

## 3. Pola kegagalan

Tiga kelompok, tiga sebab berbeda:

**a. Anatomi jebol (7, 9, 11, 12)**
Semua yang meminta model merender banyak manusia atau tubuh dalam posisi tidak
wajar. Ini keterbatasan teknis model, bukan selera.
→ **Maksimal 1 orang, dan orang itu harus diam** (duduk/berdiri).

**b. Terlalu standar (14, 16–25)**
Sepuluh ide ditolak karena bisa direkam sendiri pakai HP. **Kalau penjual bisa
merekamnya sendiri, AI tidak menambah nilai apa pun.** Ini kesalahan analisis
saya di v5: dari fakta "mangkuk tergelincir dapat 25 juta views" saya simpulkan
"buat yang biasa" — padahal video itu direkam manusia sungguhan.
→ **Nilai AI ada tepat di yang tidak mungkin direkam siapa pun.**

**c. Epik tapi produk tidak berperan (26, 27, 28, 29)**
Di keempatnya produk cuma **muncul di akhir sebagai hadiah**, atau diam pasif di
meja. Kritik Brian untuk 27 eksplisit: *"nyambung ke produk"*.
Di Ide 30 (4.8) produk **dipegang dari detik pertama sampai terakhir**.
→ **Aturan J — Produk hadir sejak beat 1 dan tetap di frame, bukan reveal di akhir.**

---

## 4. Aturan kumulatif (A–J)

| | Aturan | Dari kegagalan |
|---|---|---|
| **A** | Mustahil boleh di fisika, **tidak boleh di anatomi** | 7, 9 |
| **B** | Produk harus di konteks yang wajar untuk produk itu | 10 |
| **C** | Maksimal 1 orang, idealnya nol; orangnya diam | 11, 12 |
| **D** | Hook harus **bertumpuk**, bukan satu kejutan | semua v1–v3 |
| **E** | "Triple Hook" = **Visual + Suara + Teks serentak** di 2 detik pertama | — |
| **F** | Pattern interrupt: pecahkan tebakan penonton | referensi 25 jt views |
| **G** | Retention by Action: ada aksi fisik berjalan di bawah narasi | referensi |
| **H** | Open loop: `hook → lead → body → loop → body → loop → CTA` | referensi |
| **I** | **Benda nyata & akrab**, bukan fenomena alam | 26–29 |
| **J** | **Produk hadir sejak beat 1**, bukan reveal di akhir | 27 |

Aturan tetap lainnya: dialog **wajib bahasa Indonesia** verbatim di dalam prompt
(`no English speech` di negative); kalimat terakhir prompt **selalu**
mendeskripsikan FRAME TERAKHIR; teks overlay datang dari compositor kita, bukan
dari model (`no text, no logo, no writing`).

---

## 5. Rambu klaim (tidak bisa ditawar)

Visual boleh mustahil secara fisika. **Tidak boleh mustahil secara fungsi produk.**

- Skincare menghapus bekas jerawat seketika → klaim medis (L-11)
- Powerbank menerangi seisi rumah / mengisi tanpa colokan → klaim palsu (L-10)
- Produk pesaing bermerek hancur → merendahkan merek lain (L-15)
- Klaim stok yang tidak benar → urgensi palsu (L-13)

---

## 6. Arah berikutnya

Ide 30 (4.8) jadi dasar. Yang dikerjakan sekarang: **reproduksi Ide 30 dengan
lanjutan voice-over saat produk ditunjukkan** — lihat
[BRIEF_IDE30_V2.md](./BRIEF_IDE30_V2.md).

Pekerjaan terpisah yang masih menggantung: mesin skrip kita cuma punya 3 segmen
(hook/demo/cta) dan untuk 30 detik hanya **meregangkannya**. Kerangka 6-beat
(hook → curiosity gap → proof → re-hook → payoff → CTA) butuh perubahan nyata di
`lib/script-engine/templates.ts`.
