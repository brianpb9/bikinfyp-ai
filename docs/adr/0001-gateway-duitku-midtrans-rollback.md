# ADR 0001 — Gateway pembayaran: Duitku aktif, Midtrans dipertahankan sebagai jalur rollback

- **Status:** diterima
- **Tanggal:** 20 Agustus 2026
- **Pengambil keputusan:** Brian (founder)
- **Konteks kode:** `PAYMENT_GATEWAY`, `lib/duitku.ts`, `lib/midtrans.ts`, `lib/config.ts`

## Keputusan

BikinFYP memakai **Duitku** sebagai payment gateway. Kode, kredensial, dan
variabel lingkungan **Midtrans (`MIDTRANS_*`) SENGAJA DIPERTAHANKAN** sebagai
jalur rollback yang bisa dinyalakan dengan satu variabel: `PAYMENT_GATEWAY=midtrans`.

Audit berikutnya **tidak boleh** menandai `MIDTRANS_*` sebagai konfigurasi
tak dikenal, sisa yang terlupa, atau utang yang harus dibersihkan. Ia adalah
keputusan sadar dengan alasan di bawah.

## Kenapa Duitku

Onboarding Midtrans (13 Agu 2026) menuntut perbaikan website; sementara itu
Duitku menawarkan jalur onboarding yang bisa kami tempuh lebih cepat dengan
kanal pembayaran yang sama pentingnya bagi pembeli Indonesia (QRIS, virtual
account bank besar, e-wallet, gerai retail). Keputusan pindah diambil 19 Agu 2026.

## Kenapa Midtrans tetap ada, bukan dihapus

1. **Approval Duitku BELUM keluar.** Sampai ADR ini ditulis, merchant masih
   sandbox (`payments_env=sandbox`, `payments_live=false`). Menghapus jalur
   lama sebelum jalur baru disetujui berarti berdiri di atas satu kaki di
   tempat yang tidak kami kendalikan.
2. **Biaya menahannya nyaris nol.** `lib/midtrans.ts` sudah ada, teruji
   (`tests/security-midtrans.test.ts`), dan tidak dieksekusi selama
   `PAYMENT_GATEWAY=duitku`. Yang tersisa hanya beberapa variabel lingkungan.
3. **Biaya menghapusnya tidak nol.** Menulis ulang integrasi gateway di bawah
   tekanan — misalnya kalau Duitku menolak atau mengubah syarat — adalah cara
   paling mahal untuk menghemat beberapa baris konfigurasi hari ini.

## Konsekuensi yang diterima

- Dua bentuk blok aturan ber-cache di penulis naskah? Tidak — itu urusan lain.
  Yang relevan di sini: dua jalur pembayaran hidup berdampingan di kode, dan
  `lib/payment-checkout.ts` sengaja netral-provider (`createPayment`
  mengembalikan `{ providerRef, redirectUrl }`) supaya tidak ada percabangan
  gateway yang bocor ke alur checkout.
- `MIDTRANS_IS_PRODUCTION` tetap `false` di web dan worker. Ia **bukan**
  penanda status Duitku; jangan dibaca sebagai itu. Sejak 20 Agu, penjaga yang
  dulu membaca variabel ini (monitoring operasional) membaca `paymentsEnv()`.
- Worker **tidak** memiliki kredensial gateway mana pun — worker tidak menyentuh
  pembayaran, dan permukaan bocor yang lebih kecil itu disengaja.

## Kapan ADR ini dicabut

Hapus `MIDTRANS_*` dan `lib/midtrans.ts` setelah **semua** terpenuhi:

1. Merchant Duitku disetujui dan `payments_env=production`;
2. Uji settlement Fase 4 lolos di produksi (order, pending, settlement asli,
   signature valid/invalid, webhook duplikat/telat/tidak berurutan, jumlah
   salah, order kedaluwarsa/batal/tidak dikenal, rekonsiliasi
   order↔payment↔ledger);
3. `PAYMENTS_GO_LIVE=true` diberikan Brian secara eksplisit;
4. Berjalan stabil pada uang sungguhan selama satu siklus penyelesaian penuh.

Sebelum keempatnya selesai, jalur rollback tetap tinggal.
