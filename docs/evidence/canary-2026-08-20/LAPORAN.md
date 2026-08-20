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

- **Transkripsi audio**: `qcSuara` mengembalikan `{"transkrip":null,"masalah":
  ["berkas video tidak ada"]}` untuk berkas yang jelas ada — jalur transkripsi
  bermasalah dan tidak saya kejar. Dimensi Bahasa/CTA karena itu **NOT
  VERIFIABLE**, bukan ditebak dari naskah.
- Rubrik §B/§D, SA1–SA8, benchmark bernama: tidak dijalankan, karena menilai
  sampel yang konfigurasinya salah akan menghasilkan angka yang menyesatkan.

## Yang dibutuhkan sesi berikutnya

Perbaiki nama produk roster dari sumber tepercaya (produk terdaftar di DB, atau
baca dari fotonya), lalu jalankan ulang #1 dan lanjutkan #2–#8. Anggaran praktis
utuh: Rp247.229 tersisa. Pertimbangkan menambahkan gerbang "jenis barang cocok
dengan nama" — celahnya nyata dan baru saja terbukti memakan uang.
