# Canary 20 Agu 2026 — LAPORAN PARSIAL (dihentikan di batas bersih)

**Status: 1 dari 10 keluaran dirender. Canary DIHENTIKAN sebelum #2.**
Bukan karena kehabisan anggaran (Rp2.771 dari Rp250.000), melainkan karena
keluaran #1 terbukti tidak sah sebagai sampel — sebabnya cacat konfigurasi yang
saya buat sendiri, dan sembilan keluaran berikutnya akan mewarisinya.

## TEMUAN YANG MENGHENTIKAN CANARY: nama produk karangan di roster

Saat menulis `scripts/canary-satu.ts` saya mengisi roster MW-3 dengan
`name: "Metoo MW-3 Sabun Wajah"`. Nama itu **karangan saya** — tidak diambil
dari produk terdaftar mana pun.

Produk sebenarnya, dibaca dari foto sumber `mw3-packshot-4000px.webp`:

> **METOO MW-3 · ADVANCED SMILE REFINING · ADVANCED WHITENING TOOTHPASTE · 100g**

Itu **pasta gigi**, bukan sabun wajah.

Akibatnya pada keluaran #1, naskahnya menjual barang yang bukan produknya:

| | |
|---|---|
| hook | "Nah, sabun wajah aku yang aku sembunyiin dari kakak." |
| demo | "Sumpah kalau ketahuan, dipakai berdua deh." |
| cta | "Link-nya ada di keranjang ya, coba dong!" |

Naskahnya sendiri baik secara bentuk — situasi manusia nyata, produk hadir
sejak hook, nol klaim hasil — tapi ia bercerita tentang sabun wajah untuk
sebuah tube pasta gigi. Sebagai sampel canary, keluaran ini **tidak bisa
dinilai**: apa pun skornya mengukur konfigurasi yang salah, bukan mesinnya.

**Rp2.771 terbuang.** Itu biaya kesalahan saya, dan saya catat di sini alih-alih
menguburnya dalam skor.

## CELAH YANG DIUNGKAP: tidak ada gerbang yang mencocokkan NAMA produk dengan FOTONYA

Rantai gerbang kita memeriksa banyak hal dan semuanya lolos di sini:

- classifier: `product_photo`, 4000×4000, layak referensi — **benar**
- gerbang label: merek terdaftar "METOO" terbaca di foto — **benar**
- QC-10 / QC-F1: fidelitas MEREK — **benar**, mereknya memang METOO
- S-10, L-23, gerbang prompt akhir — semuanya lolos

Tidak satu pun memeriksa apakah **jenis barangnya** cocok dengan namanya.
"Sabun wajah" versus pasta gigi lolos karena mereknya benar, dan merek adalah
satu-satunya hal yang kita cocokkan.

Untuk penjual yang salah ketik kategori atau menempelkan nama SKU lama, hasilnya
sama: video yang menjual barang lain dengan kemasan yang benar. Ini kelas cacat
yang belum punya gerbang.

## Bukti visual keluaran #1 (tetap dicatat, karena berbayar)

Berkas: `test_output/canary_20agu/mw3-high_quality-affiliate/shot0.mp4`
720×1280, 5,09 dtk, audio AAC 32 kHz (mean −25,6 dB / max −6,8 dB — tidak senyap).

- **frame 0,1 dtk** — produk sudah di tangan sejak frame pertama; S-10 bekerja
  di piksel. Merek "METOO" terbaca; baris sekunder di bawahnya keluar sebagai
  karangan ("MOYBAERI").
- **frame 1,5 dtk** — label ter-resolve JELAS: "ME-TOO", "MW-3", "ADVANCED
  SMILE…", ikon gigi. Merek dan SKU benar.

Catatan yang bertentangan dengan harapan kebijakan jarak label: pada tier
`high_quality` label **ter-resolve terbaca**, bukan jadi tekstur. Kebijakan
jarak dirancang supaya tidak ada huruf yang terbaca sama sekali. Di sini
hurufnya terbaca, dan sebagian besar BENAR. Apakah itu berarti kebijakan jarak
tidak berlaku di tier ini, atau model mini memang lebih setia pada label —
**NOT VERIFIABLE** dari satu keluaran.

## Yang TIDAK bisa diverifikasi sesi ini

- **Transkripsi audio**: **NOT VERIFIABLE**, tapi bukan karena jalur
  transkripsinya rusak — lihat koreksi di bawah.
- Rubrik §B/§D, SA1–SA8, benchmark bernama: tidak dijalankan, karena menilai
  sampel yang konfigurasinya salah akan menghasilkan angka yang menyesatkan.

## KOREKSI: "jalur transkripsi rusak" itu SALAH — kesalahan harness saya lagi

Saya melaporkan `qcSuara` mengembalikan `"berkas video tidak ada"` untuk berkas
yang jelas ada, dan menyimpulkan jalur transkripsinya bermasalah. **Salah.**

Signature-nya `QcSuaraInput { videoPath, segmenSkrip, priceIdr, productName }`.
Saya memanggilnya dengan `{ filePath }` dan menutupinya dengan `as never`,
sehingga TypeScript tidak menolak dan `input.videoPath` bernilai undefined —
maka pesan "berkas video tidak ada" itu benar apa adanya.

Dipanggil dengan bentuk yang benar, jalurnya berjalan sampai ke penyedia dan
gagal di sana:

```json
{"transkrip":null,"lolos":false,"masalah":["transkripsi gagal: HTTP 503"]}
```

Jadi yang perlu ditangani adalah **503 dari Gemini**, bukan kode kita. Menarik
bahwa `GET /models` menjawab 200 pada jam yang sama — yang 503 adalah
`generateContent` untuk transkripsi, jadi ini kemungkinan kuota/model tertentu,
bukan layanan mati total.

**Konsekuensi untuk perintah sesi berikutnya:** item "fix the transcription path
BEFORE rerunning" **tidak perlu dikerjakan** — tidak ada yang rusak untuk
diperbaiki. Yang perlu: cek 503-nya masih ada atau tidak sebelum canary, dan
kalau masih, terima bahwa dimensi Bahasa/CTA akan NOT VERIFIABLE dan katakan
begitu alih-alih menebak dari naskah.

Ini kesalahan kelas yang sama dengan QC-08 dan QC-12 kemarin: `as never` di
skrip uji saya menyembunyikan ketidakcocokan bentuk, lalu pesan galat yang
jujur saya baca sebagai cacat produk. Pola yang sama tiga kali — di skrip
sekali-pakai, berhenti memakai `as never` untuk membungkam pemeriksa tipe.

## Dikerjakan sesudah penghentian (20 Agu, lanjutan)

**Item 3 — transkripsi PULIH.** 503 Gemini hilang. Dipanggil dengan bentuk yang
benar atas keluaran #1:

```
TRANSKRIP: "Nah, sabun wajah aku yang aku sembunyiin dari kakak"  masalah: []
```

Bahasa Indonesia penuh, cocok persis dengan naskah shot 1, tidak terpotong.
Dimensi **Bahasa/CTA bisa diverifikasi** di Fase 2 — bukan NOT VERIFIABLE.
(Untuk keluaran #1 ini, nilainya tetap tidak berarti: naskahnya menjual sabun
wajah untuk pasta gigi.)

**Item 1 — identitas produk kini MUSTAHIL diketik.** `canary-satu.ts` menerima
PRODUCT ID; nama, kategori, dan harga dibaca dari baris `products`. Peta yang
tersisa di skrip hanya `product_id -> foto`; tidak ada kolom nama sama sekali.

Dua jalur fail-closed diverifikasi:

| Keadaan | Hasil |
|---|---|
| `DATABASE_URL` kosong | berhenti: "identitas produk dibaca dari catatan terdaftar, bukan diketik" |
| id tidak ada di `products` | berhenti, exit 1: `produk "p-mw3" TIDAK TERDAFTAR. Daftarkan dulu produknya...` |

Konsekuensi yang disengaja dan harus diketahui sebelum canary diulang: **kelima
foto canary belum jadi produk terdaftar**, jadi tidak satu pun bisa dirender
sampai didaftarkan dengan nama + kategori dari labelnya sendiri. Itu bukan
halangan yang perlu diakali — kalau sebuah foto tidak cukup nyata untuk punya
catatan produk, ia tidak cukup nyata untuk dibayar render.

## Yang dibutuhkan sesi berikutnya

Perbaiki nama produk roster dari sumber tepercaya (produk terdaftar di DB, atau
baca dari fotonya), lalu jalankan ulang #1 dan lanjutkan #2–#8. Anggaran praktis
utuh: Rp247.229 tersisa. Pertimbangkan menambahkan gerbang "jenis barang cocok
dengan nama" — celahnya nyata dan baru saja terbukti memakan uang.
