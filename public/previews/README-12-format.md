# Pratinjau 12 template format

Selama sebuah template `preview`-nya null, kartunya menampilkan gradien warna
+ ikon film. Itu keadaan yang benar, bukan kerusakan.

## Cara memasang pratinjau

1. Taruh berkasnya di folder ini dengan nama sesuai id templatenya:

       t01-tempat-susah.mp4        Pakai di Tempat Susah
       t02-bedah-fitur.mp4         Bedah Fitur
       t03-liputan-event.mp4       Liputan Event
       t04-hook-indrawi.mp4        Hook Indrawi
       t05-before-after.mp4        Before / After Sebelah-Sebelahan
       t06-swatch-shade.mp4        Swatch Semua Varian
       t07-checklist-berjalan.mp4  Checklist Berjalan
       t08-day-1-vs-day-7.mp4      Day 1 vs Day 7
       t09-bahan-aktif.mp4         Klaim + Bahan Aktif
       t10-bukti-di-lengan.mp4     Bukti di Lengan
       t11-hook-misteri.mp4        Hook Misteri
       t12-vox-pop.mp4             Vox Pop Jalanan

2. Di `lib/templates.ts`, ubah baris templatenya:

       preview: null,
   menjadi
       preview: "/previews/t01-tempat-susah.mp4",

Kotak pratinjaunya mengikuti rasio videonya sendiri — landscape dapat kotak
landscape, tidak perlu mengatur apa pun.

## Kenapa harus null, bukan menunjuk berkas yang belum ada

Diuji 2026-08-11: `src` yang 404 menyisakan elemen `<video>` kosong yang
tampil sebagai kotak hitam polos — tidak bisa dibedakan dari klip gelap.
Deteksi dari sisi klien TIDAK andal: pada 404 yang sudah ter-cache, event
"error" media lewat sebelum React sempat memasang pendengarnya (terukur:
pendengar terpasang di 23 elemen, handler jalan nol kali, padahal properti
`video.error` terisi di 12 elemen), dan event media tidak menggelembung
sehingga tidak ada tempat lain menangkapnya. Isi folder ini kita tahu pasti
tanpa perlu menebak di browser.

## Yang TIDAK boleh dipasang di sini

Video sumber dari portfolio yang dibedah. Dokumen bedahnya sendiri menulis
"Jangan di-repost, jangan dipotong jadi konten sendiri"; beberapa berkas
ber-watermark TikTok dan mencantumkan larangan penggunaan komersial, dan tiga
di antaranya menyebut akun kreatornya. Memajangnya sebagai contoh di produk
komersial kita persis hal yang dilarang itu.

Yang benar: render 12 contoh MEMAKAI template ini, lalu simpan hasilnya di
sini. Pratinjaunya jadi milik kita, sekaligus bukti mesinnya jalan.
