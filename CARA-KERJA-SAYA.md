# Cara Kerja Saya — end to end

Ditulis 24 September 2026, atas permintaan Brian untuk dianalisa.

Dokumen ini menjelaskan **bagaimana saya bekerja**, bukan bagaimana aplikasinya
bekerja. Untuk yang kedua, baca `PANDUAN-KONTEN-UGC.md` di folder yang sama.

Supaya bisa kamu uji dan bukan cuma dipercaya, hampir setiap klaim di sini
saya tempelkan **contoh nyata dari sesi kita sendiri**, lengkap dengan nomor
commit-nya. Termasuk contoh-contoh saat saya salah.

---

## 1. Satu aturan yang mengatur semuanya

> **Kode yang lulus tes bukan bukti. Prompt yang terlihat benar bukan bukti.
> Yang bukti cuma hasil yang dilihat.**

Semua kebiasaan di bawah turunan dari satu kalimat itu. Kalau kamu cuma mau
mengingat satu hal dari dokumen ini, ingat ini — dan tagih saya kalau saya
melanggarnya.

Praktiknya: saya memisahkan empat status, dan berusaha tidak pernah
mencampurnya dalam satu kalimat.

| Status | Artinya | Contoh dari sesi ini |
|---|---|---|
| **Terlihat** | saya benar-benar membukanya | "5 video di /onboarding, `readyState 0`, 0 punya poster" |
| **Terukur** | ada angkanya dari alat | "553 KB video + 56 KB poster pada muat pertama" |
| **Disimpulkan** | penalaran dari bukti | "kotak kosong itu karena poster, bukan video rusak" |
| **Diusulkan** | belum ada | seluruh `RANCANGAN-ACUAN-BRAND.md` |

Kalau saya tidak bisa menempelkan salah satu label itu, saya tidak boleh
menulis kalimatnya.

---

## 2. Lingkar kerja saya

```
PAHAMI ──► PERIKSA ──► KERJAKAN ──► BUKTIKAN ──► LAPOR
   ▲                                     │
   └──────── kalau bukti menolak ────────┘
```

### 2.1 PAHAMI — sebelum menyentuh apa pun

Saya tidak mulai dari menulis kode. Saya mulai dari mencari tahu apa yang
sebenarnya diminta, dan apakah yang diminta itu memang masalah yang benar.

Contoh dari sesi ini: kamu bertanya *"apa lagi yang perlu di improve dari
tampilan ui ux visual?"* Saya tidak menjawab dari membaca kode. Saya jalankan
aplikasinya, login sebagai pengguna baru, dan telusuri sampai layar bayar —
karena pertanyaan soal tampilan tidak bisa dijawab tanpa melihat tampilannya.

Kalau permintaannya ambigu **dan** ambiguitasnya mengubah apa yang saya
kerjakan, saya bertanya. Kalau tidak, saya ambil asumsi paling masuk akal,
**sebut asumsinya**, dan jalan. Contoh: kamu tidak menjawab nomor 3 soal
"dipasang di mana dulu" — saya asumsikan beta admin, saya tulis asumsinya di
kepala dokumen, dan saya lanjut.

### 2.2 PERIKSA — baca yang ada sebelum menambah yang baru

Hampir semua masalah di repo ini sudah punya jawabannya di tempat lain di repo
yang sama. Contoh paling jelas dari sesi ini: saya hampir membangun mekanisme
multi-acuan gambar dari nol untuk acuan brand — sampai saya cek dan menemukan
`lib/iklan/keyframe.ts:167` **sudah** melakukannya dan sudah dipakai
berhari-hari. Pekerjaannya berubah dari "menemukan" jadi "memindahkan".

Untuk pembacaan yang luas, saya pakai agen paralel. Saat menulis
`PANDUAN-KONTEN-UGC.md`, dua agen membaca `lib/script-engine/` (572 baris) dan
`lib/media/shot-planner.ts` (2.002 baris) **bersamaan**, sementara saya menulis
bagian yang sudah saya kuasai. Saya tidak menulis bagian mereka dari ingatan —
saya menunggu, karena seluruh nilai dokumen itu ada pada kutipannya yang tepat.

### 2.3 KERJAKAN — perubahan terkecil yang menyelesaikan masalah

Tiga kebiasaan:

**Satu sumber kebenaran.** Saat menemukan daftar format yang boleh diskor
tersalin di dua tempat, saya satukan ke `lib/fyp-score` dan buat yang lain
membacanya. Salinan yang basi adalah cara paling umum sebuah sistem berbohong
tanpa error.

**Jalur berbayar tidak disentuh.** Saat memasang format Iklan Sinematik ke
aplikasi, seluruhnya lewat cabang terpisah (`worker-iklan.ts`), rute admin
terpisah, prioritas antrean terpisah. Ada tes yang menjaga formatnya tidak
bocor ke katalog pengguna.

**Alasan ditulis di kode, bukan di kepala saya.** Komentar di repo ini panjang
karena tiap larangan keras punya sejarah berbayar. `LOCKED LOCATION` di prompt
gerak ada karena shot "berangkat di jalan pagi" berakhir di garasi malam.
Orang berikutnya yang menghapusnya harus tahu apa yang ia beli.

### 2.4 BUKTIKAN — ini bagian yang paling sering dilewati orang

Cara saya membuktikan, dari yang paling kuat ke paling lemah:

1. **Render ulang dan lihat.** Poster video: saya screenshot sebelum dan
   sesudah, di layar yang sama.
2. **Ukur.** "1,7 MB" itu bukan perasaan — itu `performance.getEntriesByType`
   di browser.
3. **Buat penjaga, lalu buktikan penjaganya bisa gagal.** Ini yang paling
   sering dilewati. Tes yang tidak pernah bisa merah tidak menjaga apa pun.
   Saya menyisipkan kembali pola lama, memastikan tesnya **merah**, lalu
   mengembalikannya. Saya lakukan itu dua kali di sesi ini — untuk penjaga
   wordmark dan penjaga pesan galat mentah.
4. **Jalankan seluruh tes + build.** Perlu, tapi paling lemah: ia membuktikan
   tidak rusak, bukan membuktikan bagus.

### 2.5 LAPOR — hasilnya, bukan perjalanannya

Saya usahakan laporan memuat: apa hasilnya, buktinya apa, dan **apa yang masih
belum beres**. Bukan daftar langkah yang saya lakukan.

---

## 3. Cara saya menilai mutu

Saya memakai papan nilai yang **mulai dari 0**, bukan dari 10 lalu dikurangi.
Angka hanya naik kalau ada bukti yang bisa dilihat.

Aturan yang saya pegang:

- Satu **patokan bernama**. Untuk UI kemarin: CapCut (alur mobile) dan HeyGen
  (halaman daftar). Tanpa patokan, "bagus" cuma selera.
- **Yang dilaporkan angka kritis TERENDAH**, bukan rata-rata. Rata-rata
  menyembunyikan satu domain yang rusak.
- **Tanpa bukti render = tidak bisa dinilai**, bukan "kemungkinan bagus".
- Kalau ragu antara dua angka, ambil yang lebih rendah.

Contoh nyata: kamu dua kali minta "9/10 semua". Saya kerjakan semuanya yang
bisa dikerjakan, lalu melaporkan **7** untuk tipografi & tata letak — dan
menolak menaikkannya, karena saya belum menyentuh domain itu sama sekali.
Menaikkan angka untuk menyenangkanmu akan membuat seluruh papan nilai itu
tidak berguna, termasuk saat ia benar-benar 9.

---

## 4. Cara saya memperlakukan uang dan produksi

Ini bagian yang paling saya jaga, karena kesalahannya tidak bisa ditarik.

**Uang penyedia.** Sebelum render, saya cek apa yang sudah ada di disk. Setiap
tahap pipeline iklan menyimpan hasilnya dan dilewati kalau sudah jadi. Saat
satu permintaan gagal di tengah dan meninggalkan satu task berbayar
menggantung, saya lacak task-nya dan cocokkan frame-nya, lalu ganti ke
`Promise.allSettled` supaya tidak ada lagi task berbayar yang jadi yatim.

**Uang pengguna.** Saya tidak pernah memindahkan gerbang kredit tanpa
menyebutnya. Beta iklan tidak menahan kredit sama sekali, dan worker keluar
sebelum blok capture — dengan tes yang menjaganya.

**Produksi.** Tindakan yang sulit ditarik saya konfirmasi dulu. Saat perbaikan
UI selesai, saya **tidak** deploy — saya laporkan bahwa satu render beta akan
memblokir job berbayar 15–25 menit, dan menyerahkan keputusannya ke kamu.

**Rahasia.** Saat mengecek produksi, saya hanya memeriksa sebuah kunci
**terisi atau kosong**, tidak pernah menampilkan nilainya.

---

## 5. Cara saya bertanya

Kamu pernah menolak dialog pilihan dan bilang *"kirimkan pertanyaan kembali
akan saya jawab"*. Sejak itu saya selalu bertanya sebagai **teks bernomor
dengan opsi berhuruf**, supaya bisa dijawab "1D, 2C" dalam satu baris.

Saya hanya bertanya kalau tiga syarat ini terpenuhi sekaligus:

1. Jawabannya mengubah apa yang saya kerjakan,
2. Saya tidak bisa menemukannya sendiri dari kode atau data,
3. Salah menebak berarti membuang kerja atau uang.

Contoh yang lolos syarat: "acuan brand yang mana — gaya, set, atau talent?"
Ketiganya punya kelayakan teknis yang sangat berbeda; talent bahkan terhalang
filter penyedia. Menebak berarti membangun hal yang salah.

Contoh yang **tidak** lolos: "boleh saya perbaiki poster videonya?" Itu cacat
jelas dengan perbaikan jelas. Saya kerjakan, lalu lapor.

---

## 6. Saat saya salah — contoh nyata dari sesi ini

Bagian ini sengaja ada. Proses yang tidak pernah menerbitkan kesalahannya
tidak bisa dianalisa.

**Salah diagnosis pertama (error 500 checkout).** Saya bilang penyebabnya
gangguan sementara di Duitku. Itu salah. Setelah menemukan baris
`runtime_secrets` yang berubah 30 detik sebelum kegagalan, penyebab
sebenarnya adalah merchant production dipakai dengan flag sandbox. Saya
nyatakan koreksinya terang-terangan, bukan diam-diam memperbaikinya.

**Angka yang saya klaim ternyata salah ukur.** Saya laporkan poster memangkas
muat pertama dari 1,7 MB jadi 56 KB. Ternyata saya mengukurnya di browser yang
memang tidak pernah memuat video sama sekali. Angka sebenarnya **553 KB**. Saya
tulis koreksinya di laporan **dan** di pesan commit, bukan hanya membetulkan
angkanya diam-diam.

**Temuan yang saya tarik.** Saya sempat menulis "logo 295 KB untuk render 88px"
sebagai cacat. Setelah diukur, `next/image` menyajikannya 1,5 KB. Saya tarik
temuan itu secara eksplisit.

**Bug hitung biaya saya sendiri.** Penjumlah biaya menghitung token dan kredit
sebagai rupiah — total 948.402 untuk biaya ±119.000. Saya perbaiki dan
laporkan angkanya yang benar, bukan membiarkan angka yang enak dilihat.

Polanya sama di keempatnya: **koreksi diumumkan, bukan disembunyikan di balik
perbaikan.**

---

## 7. Yang tidak saya lakukan

- **Tidak melaporkan selesai dari kode saja** kalau yang dinilai tampilan.
  Saat Chrome mati di kedua browser, saya tidak mengarang pass desain yang
  tidak bisa saya lihat — saya berhenti dan bilang begitu.
- **Tidak menambah cakupan** tanpa diminta.
- **Tidak menghaluskan angka** supaya laporan terdengar enak.
- **Tidak menyembunyikan sebab teknis dari operator** — pesan pengguna netral,
  sebabnya lengkap di log.
- **Tidak memakai data karangan** sebagai contoh yang terlihat nyata.

---

## 8. Batas saya yang perlu kamu tahu

Supaya kamu bisa menutupinya, bukan menabraknya:

| Batas | Akibatnya | Cara menutupinya |
|---|---|---|
| Saya tidak bisa melihat piksel dari screenshot Playwright | pass desain visual tidak bisa saya nilai sendiri | kamu jalankan `npm run dev` dan lihat; saya kerjakan, kamu yang menilai |
| Chrome extension sering putus di sini | penelusuran UI bisa mandek | Playwright jadi cadangan, tapi hanya memberi struktur dan angka |
| Saya tidak tahu konteks sesi lama kecuali tertulis | keputusan lama bisa terulang ditanya | keputusan penting saya simpan ke memori; sisanya tulis di repo |
| Dev server Next menyajikan bundel basi | perubahan bisa terlihat "tidak jalan" | saya restart bersih sebelum mengukur; ini dua kali menipu saya di sesi ini |
| Saya tidak memutuskan pengeluaran uang | render uji berhenti menunggu kamu | sebut anggarannya sekali, saya jaga batasnya |

---

## 9. Kalau kamu mau mengubah cara saya bekerja

Yang paling berpengaruh, berurutan:

1. **Sebut patokannya.** "Sebagus CapCut" mengubah standar lebih banyak
   daripada "bikin bagus".
2. **Sebut anggaran dan batasnya sekali.** Saya akan menjaganya dan berhenti
   di batas itu, bukan bertanya tiap langkah.
3. **Bilang kalau saya boleh bertindak tanpa bertanya.** Kamu sudah
   melakukannya dengan "kerjain" — dan saya berhenti bertanya setelahnya.
4. **Koreksi saya saat saya mengarang.** Keluhanmu soal halusinasi posisi
   mesin motor melahirkan seluruh `lib/iklan/realitas.ts`. Koreksi yang
   spesifik jadi lapisan permanen di kode.
5. **Bilang kalau laporan saya kepanjangan atau terlalu pendek.** Saya
   menyesuaikan, dan itu preferensi yang saya simpan.

---

## 10. Ringkasan satu halaman

| Tahap | Yang saya lakukan | Yang bisa kamu tagih |
|---|---|---|
| Pahami | cari masalah yang benar, sebut asumsi | "asumsimu apa?" |
| Periksa | baca yang sudah ada sebelum menambah | "ini sudah ada di mana?" |
| Kerjakan | perubahan terkecil, satu sumber kebenaran, alasan di kode | "kenapa begini?" |
| Buktikan | render, ukur, penjaga yang terbukti bisa merah | "mana buktinya?" |
| Lapor | hasil + bukti + yang belum beres | "apa yang masih bolong?" |

Dan satu kalimat yang saya pegang saat ragu:

> **Laporan "gagal" yang jujur lebih murah daripada "selesai" yang palsu.**
> Yang pertama memakan waktu. Yang kedua memakan kepercayaan, dan itu tidak
> bisa dibeli lagi dengan kerja tambahan.
