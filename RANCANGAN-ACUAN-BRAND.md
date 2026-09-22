# Acuan Gaya & Set Brand untuk UGC Kreator — cara kerjanya

> **STATUS: RANCANGAN. Belum satu baris pun dibangun.**
> Dokumen ini menjelaskan cara kerja yang DIUSULKAN, supaya bisa kamu pelajari
> dan koreksi sebelum uang render keluar. Setiap bagian menandai dengan jelas
> mana yang **sudah ada dan terbukti** versus mana yang **baru**.

Ditulis 22 September 2026. Keputusan Brian: **1D** (acuan gaya + set brand,
tanpa wajah) dan **2C** (talent brand ditunda). Nomor 3 belum dijawab — dokumen
ini mengasumsikan **beta admin dulu**, dan asumsi itu mudah diubah.

Pendamping: `PANDUAN-KONTEN-UGC.md` menjelaskan pipeline yang berjalan hari
ini. Bacalah itu dulu kalau belum.

---

## 1. Masalah yang dipecahkan

Hari ini brand mengunggah foto produk, dan itulah **satu-satunya** gambar milik
brand yang membentuk video. Semua hal lain — ruangan, meja, cahaya, properti,
suasana — dikarang model dari kata-kata.

Akibatnya dua brand berbeda dengan kategori sama menerima video yang terasa
mirip. Yang membedakan merek di iklan nyata justru hal-hal yang sekarang
dikarang itu: rak tokonya, warna dindingnya, bahan mejanya, cara cahayanya
jatuh.

"Brand kit" yang sudah ada (logo, warna, tagline) hanya menempel di **2 detik
end card**. Ia tidak menyentuh isi videonya sama sekali.

**Yang ingin dicapai:** brand mengunggah beberapa gambar acuan — foto kampanye
mereka, foto tokonya, foto kemasannya di rak — dan video yang keluar terasa
memang milik brand itu, bukan stok generik.

---

## 2. Satu batasan yang menentukan seluruh rancangan

**Penyedia video menolak foto wajah manusia asli sebagai gambar acuan.**

Ini sudah diuji langsung pada 10 Agustus 2026, di **semua** mode: i2v polos,
r2v `reference_image`, `first_frame`, dan `last_frame`. Jawabannya
*"may contain real person"* — filter privasi/anti-deepfake milik mereka, bukan
bug di sisi kita.

Konsekuensinya, dan ini yang membuat pilihan **1D** tepat:

- Acuan **gaya, set, properti, kemasan** → aman, tidak menyentuh filter.
- Acuan **wajah/talent** → tidak bisa jadi jangkar visual hari ini. Yang
  terjadi sekarang: foto dibaca Gemini jadi deskripsi teks, dan teks itu yang
  dipakai. Hasilnya "terinspirasi foto", bukan orang yang sama.

Karena itu rancangan ini **menolak gambar berwajah di gerbang unggah**, bukan
diam-diam membuangnya belakangan. Brand harus tahu sejak awal kenapa fotonya
ditolak.

---

## 3. Mekanismenya sudah ada — tinggal dipindah

Ini bagian terpenting untuk kamu pahami, karena ia yang membuat rancangan ini
murah dan berisiko rendah.

**Sudah ada dan terbukti** (`lib/iklan/keyframe.ts:167`): pipeline Iklan
Sinematik sudah mengirim **banyak gambar acuan sekaligus** ke Seedream. Kalau
acuannya satu ia kirim `image: <satu>`, kalau lebih ia kirim `image: [<banyak>]`.
Mekanisme ini sudah dipakai berhari-hari untuk menjaga motor, ruangan, dan
orang tetap sama antar shot.

**Yang belum**: jalur storyboard brand (`lib/media/seedream.ts:180`) hanya
mengirim **satu** gambar — foto produk. Dan `lib/postgres/storyboard-worker.ts:113`
memuat tepat satu foto lalu memberikannya ke semua scene.

Jadi pekerjaannya bukan menemukan cara baru. Pekerjaannya memindahkan cara yang
sudah bekerja ke jalur yang belum memakainya.

---

## 4. Di mana acuan brand masuk

Acuan brand masuk di **tahap gambar**, bukan tahap video. Alasannya bukan
selera:

```
naskah ──► KARTU STORYBOARD (Seedream)  ◄── DI SINI acuan brand masuk
             │  gambar diam, disetujui pengguna
             ▼
           frame pertama video
             │
             ▼
           KLIP (i2v)  ── gerak dihitung DARI frame itu
```

Tiga alasan kenapa di tahap gambar:

1. **Model gambar menerima banyak acuan; model video tidak.** Video bekerja
   dari satu frame pertama.
2. **Pengguna menyetujui kartu itu.** Gerbang storyboard sudah ada: kalau acuan
   brand membentuk kartu, yang disetujui brand adalah yang benar-benar
   dirender — bukan tebakan yang berbeda.
3. **Ini juga yang membuat label produk tetap benar** di pipeline sinematik.
   Mekanisme yang sama, masalah yang sama.

Kalau brand tidak mengunggah acuan apa pun, alurnya **persis seperti hari ini**.
Tidak ada yang berubah untuk mereka.

---

## 5. Dua jenis acuan, dua kontrak prompt yang berbeda

Inilah inti rancangannya. Gambar acuan saja tidak cukup — model harus
diberi tahu **acuan ini untuk apa**. Salah kontrak, hasilnya rusak dengan cara
yang sudah pernah kita bayar.

### 5.1 Acuan GAYA (mood, palet, cahaya)

Kontrak yang diusulkan:

```text
REFERENCE IMAGE <n> is a STYLE reference for this brand. Copy ONLY its visual treatment:
colour palette, lighting direction and softness, contrast, and overall mood.
Do NOT copy its subject, composition, framing, location, props or any person in it.
Nothing from that photograph appears in the new scene.
```

Kenapa kalimat kedua sekeras itu: pada render uji sinematik, acuan tanpa
larangan eksplisit membuat model **menyalin posenya** — adegan "motor melaju
saat matahari terbit" keluar sebagai pose jongkok dari foto acuan. Kalimat
"IDENTITY ONLY / jangan tiru pose" itu lahir dari kegagalan berbayar.

### 5.2 Acuan SET & PROPERTI (toko, rak, kemasan, seragam)

Kontrak yang diusulkan:

```text
REFERENCE IMAGE <n> shows "<nama yang diberi brand>" — a real place or object belonging to this brand.
Keep it recognisably the same: same shape, same colours, same materials, same signage layout.
Do NOT copy that photograph's camera angle, framing, lighting or the moment it captured —
this is a different moment in the same place.
```

Bedanya dengan acuan gaya: di sini **isinya** yang harus dipertahankan dan
**perlakuannya** yang boleh berubah. Kebalikan persis. Karena itu keduanya
tidak boleh dicampur jadi satu kontrak.

### 5.3 Yang tetap seperti sekarang

Foto produk tetap memegang kontrak yang sudah ada dan sudah terbukti:

```text
REFERENCE AUTHORITY: the attached image shows ONLY the product. Use it as the authority for
the product shape, colour, material and proportions. Do NOT reproduce the reference photo
composition, background or framing — build the NEW scene described below.
```

Urutan pengiriman yang diusulkan: **produk dulu, baru acuan brand.** Produk
adalah satu-satunya yang wajib benar secara hukum dan komersial; ia tidak boleh
kalah oleh acuan gaya.

---

## 6. Batas jumlah dan kenapa ada batasnya

| Yang dikirim | Jumlah | Alasan |
|---|---|---|
| Foto produk | 1 | sudah begitu hari ini |
| Acuan gaya brand | maks 1 | dua gaya = model memilih sendiri, hasilnya tidak bisa diprediksi |
| Acuan set/properti | maks 2 per scene | yang relevan untuk scene itu saja |
| **Total per kartu** | **maks 4** | lebih dari ini, tiap acuan makin diabaikan |

Batas ini bukan batas teknis penyedia — ini batas kewarasan. Pada uji
sinematik, dua gambar acuan tanpa instruksi anti-kolase membuat Seedream
menggambar **kolase tiga panel**. Kalimat anti-kolase kini selalu dikirim
paling awal, dan akan ikut di sini juga:

```text
Create ONE single continuous photograph that fills the whole frame — never a collage,
grid, split screen, triptych or multiple panels.
```

---

## 7. Gerbang unggah — apa yang ditolak dan kenapa

Acuan brand diunggah sekali, dipakai berkali-kali. Karena itu pemeriksaannya di
**saat unggah**, bukan saat render — supaya brand tahu alasannya saat ia masih
bisa memperbaikinya, bukan setelah job gagal.

| Pemeriksaan | Ditolak kalau | Alasan |
|---|---|---|
| Wajah | ada wajah terdeteksi | penyedia video menolak; lihat §2 |
| Ukuran | sisi terpendek < 512 px | acuan buram menular ke hasil |
| Merek lain | (peringatan, bukan tolak) | logo pihak ketiga ikut tergambar |
| Jumlah | > 1 gaya, > 6 set per organisasi | lihat §6 |

Deteksi wajah memakai YuNet, detektor yang **sudah dipakai** di QC-09 dan
`person-safe-refs` — bukan komponen baru.

Pesan penolakannya harus menyebut sebab dan jalan keluar. Bukan *"Foto
ditolak"*, melainkan: *"Foto ini ada wajahnya. Penyedia video kami menolak foto
wajah asli sebagai acuan. Pakai foto tanpa orang — toko, rak, kemasan, atau
detail materialnya."*

---

## 8. Apa yang berubah di kode

| Berkas | Perubahan | Sifat |
|---|---|---|
| `lib/media/seedream.ts` | `fotoProduk: Buffer` → daftar acuan + kontraknya | **ubah** |
| `lib/postgres/storyboard-worker.ts` | muat acuan brand di samping foto produk | **ubah** |
| `lib/media/acuan-brand.ts` | kontrak prompt per jenis acuan | **baru** |
| `app/api/dashboard/brand-refs/` | unggah, daftar, hapus + gerbang §7 | **baru** |
| migrasi | tabel `brand_references` (org_id, jenis, kunci, nama, dibuat) | **baru** |
| `app/dashboard/(app)/assets/` | tab acuan brand | **ubah** |

**Yang TIDAK disentuh:** penulis naskah, perencana shot, gerbang prompt,
penyedia video, QC, perakitan. Acuan brand hanya menambah gambar dan kalimat di
satu tempat. Kalau brand tidak punya acuan, jalurnya identik dengan hari ini —
itu ukuran keberhasilan rancangan ini.

---

## 9. Biaya

Seedream menagih per gambar, **bukan** per gambar acuan. Menambah acuan tidak
menambah biaya per kartu (±Rp700/gambar).

Yang bisa menambah biaya: kartu yang digambar ulang karena acuannya salah
kontrak. Karena itu uji pertama dibatasi.

| Tahap | Perkiraan |
|---|---|
| Uji internal 1 brand, 6 kartu × 3 putaran | ±Rp13 rb |
| Satu video utuh berakuan (premium) | sama seperti sekarang, ±Rp48 rb |

---

## 10. Cara membuktikannya berhasil

Rancangan ini gagal dengan cara yang **terlihat**, jadi pembuktiannya harus
visual — bukan tes hijau.

1. **Uji A/B kartu.** Enam kartu dirender dua kali: tanpa acuan brand, lalu
   dengan acuan. Prompt dan naskah identik. Yang dinilai: apakah yang berubah
   memang gaya/set-nya, dan apakah produknya tetap benar.
2. **Uji anti-salin.** Satu acuan gaya dengan subjek yang mencolok (misalnya
   orang memegang cangkir). Kalau cangkir itu muncul di kartu, kontraknya
   bocor dan kalimat larangannya harus diperkeras.
3. **Uji tanpa acuan.** Brand tanpa acuan harus menghasilkan kartu yang
   **sama persis** seperti sebelum perubahan. Ini menjaga janji "tidak ada
   yang berubah untuk mereka".
4. Kurasi vision menilai hasilnya, bukan saya — mekanisme yang sama dengan
   `lib/iklan/kurasi.ts`.

---

## 11. Risiko yang saya perkirakan

| Risiko | Kemungkinan | Penanganan |
|---|---|---|
| Acuan gaya ikut menyalin subjeknya | **tinggi** | kalimat larangan §5.1; uji anti-salin §10.2 |
| Acuan set menenggelamkan produk | sedang | produk dikirim pertama; kurasi memeriksa produk |
| Brand mengunggah foto berwajah lalu bingung | **tinggi** | gerbang §7 dengan pesan yang menyebut jalan keluar |
| Dua acuan bikin kolase | sedang | kalimat anti-kolase §6, sudah terbukti di sinematik |
| Brand mengira ini menyalin talent-nya | sedang | copy di UI harus menyebut batasan §2 apa adanya |

---

## 12. Yang sengaja TIDAK ada di rancangan ini

Supaya tidak ada yang mengira lebih dari yang dijanjikan:

- **Talent/wajah brand** — ditunda atas keputusanmu (2C). Ia masalah penyedia,
  bukan masalah prompt, jadi menyelesaikannya butuh uji penyedia lain.
- **Logo brand di dalam adegan** — model menggambar huruf dengan ngaco. Logo
  tetap hanya di end card, tempat ia ditempel sebagai berkas asli.
- **Acuan gerak/kamera brand** — model video tidak menerima acuan video.
- **Konsistensi lintas kampanye otomatis** — acuan dipilih per kampanye dulu.

---

## 13. Urutan kerja yang saya usulkan

1. `lib/media/acuan-brand.ts` + kontrak prompt, dengan tes yang mengunci
   kalimat larangannya.
2. `seedream.ts` menerima banyak acuan (meniru `lib/iklan/keyframe.ts`).
3. Gerbang unggah + penyimpanan + API.
4. **Uji A/B §10 sebelum UI dibuka** — ini gerbangnya; kalau gagal, berhenti di
   sini dan kabari kamu, bukan lanjut ke UI.
5. Tab acuan brand di halaman Assets.
6. Buka untuk admin dulu; ke dashboard brand setelah kamu lihat hasilnya.

Langkah 1–4 tidak menyentuh apa pun yang dilihat pengguna. Kalau uji di langkah
4 gagal, tidak ada yang perlu dibatalkan.
