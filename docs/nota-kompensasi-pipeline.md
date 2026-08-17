# Nota kompensasi — pembatalan render karena peningkatan pipeline

**Untuk:** org `55180168` (dan siapa pun yang rendernya ikut dibatalkan)
**Status:** draf, MENUNGGU PERSETUJUAN BRIAN sebelum dikirim

Belum dikirim ke siapa pun. Mengirim pesan atas nama BikinFYP ke pelanggan
adalah keputusan Brian, bukan keputusan saya.

---

## Versi in-app (notifikasi pendek)

> **Render kamu kami batalkan — kreditnya sudah kembali**
>
> Kami sedang mengganti mesin video BikinFYP, dan render yang masih berjalan
> memakai mesin lama. Daripada meneruskannya lalu menagihkan hasil yang sudah
> tidak sesuai standar baru, kami hentikan semuanya.
>
> Kreditnya sudah kembali ke saldo kamu, ditambah bonus Rp12.000 sebagai maaf
> dari kami. Begitu mesin barunya dibuka, render ulang video-video itu **gratis**
> — tinggal buat ulang seperti biasa, kreditnya sudah ada di saldo.

## Versi email

**Subjek:** Render kamu kami batalkan — kredit sudah kembali + render ulang gratis

> Halo,
>
> Kami mau memberi tahu sesuatu sebelum kamu menemukannya sendiri di dashboard.
>
> BikinFYP sedang mengganti mesin pembuat videonya. Beberapa render kamu masih
> berjalan dengan mesin lama, dan kami memutuskan untuk **menghentikannya**
> daripada meneruskan lalu menagihkan hasil yang sudah tidak memenuhi standar
> baru kami.
>
> Yang sudah kami lakukan:
>
> - Semua render yang tertahan sudah dibatalkan.
> - **Seluruh kreditnya sudah kembali** ke saldo organisasi kamu.
> - Kami tambahkan **Rp12.000** sebagai permintaan maaf atas waktu yang
>   terbuang.
>
> Begitu mesin baru dibuka, kamu bisa **membuat ulang video-video itu tanpa
> biaya tambahan** — kreditnya sudah ada di saldo, tinggal dipakai.
>
> Kalau ada yang mau ditanyakan, balas email ini saja.
>
> — Tim BikinFYP

---

## Yang JANGAN ditulis di nota itu

- **Jangan menjanjikan tanggal.** Intake masih tertutup sampai migrasi invarian
  uang (0030/0031) terpasang, dan tanggal yang meleset lebih merusak
  kepercayaan daripada tidak menyebut tanggal sama sekali.
- **Jangan bilang "video kamu gagal".** Tidak gagal — kami yang menghentikannya.
  Bedanya penting: satu terdengar seperti produk rusak, satu lagi seperti
  keputusan sadar demi mutu.
- **Jangan sebut jumlah teknis** (2 job, 9 job, Rp24.000 vs Rp12.000 dipisah).
  Yang perlu diketahui pelanggan: kreditnya kembali, ada tambahan, dan render
  ulang gratis.

## Catatan pembukuan (internal, bukan untuk pelanggan)

Kompensasi ditulis sebagai DUA baris `bonus` terpisah, bukan satu:

| jumlah | alasan |
|---:|---|
| Rp24.000 | refund 2 job berbayar yang dibatalkan |
| Rp12.000 | kredit itikad baik |

Sengaja dipisah — pengembalian membatalkan pendapatan yang tidak jadi
diberikan, sementara itikad baik adalah biaya hubungan pelanggan. Menggabungkan
keduanya membuatnya tidak bisa dipisahkan lagi nanti, dan ledger ini tidak bisa
diedit.
