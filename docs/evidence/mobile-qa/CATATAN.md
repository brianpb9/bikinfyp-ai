# Mobile QA 375px — 19 Agu 2026

Diuji dengan Playwright pada viewport 375x812 (iPhone SE/13 mini) atas dev
server lokal, login dev + organisasi seed SQLite. Empat tangkapan layar di
folder ini adalah buktinya.

## Terbukti lewat interaksi nyata (bukan pembacaan kelas CSS)

| Uji | Hasil |
|---|---|
| Laci navigasi terbuka (klik tombol menu) | transform 0, overlay tampil |
| Kunci gulir badan saat laci terbuka | body overflow=hidden |
| Escape menutup laci | transform -256, gulir kembali |
| aria-expanded/aria-controls di tombol menu | terpasang |
| Overflow horizontal (/dashboard, campaign, credits, assets, library) | 0 px di semuanya |
| Stepper ringkas "Langkah N dari 6 · <nama>" + mundur satu langkah | tampil di 375px |
| Wizard langkah 1 (Jenis): 1 kolom | tampil benar |
| Wizard langkah 2 (Produk) tercapai lewat klik nyata | ya |
| Tombol "Ajukan paket ini" MENGIRIM dan menampilkan status | "Pengajuan paket Starter sudah kami terima" |

## Batas pengujian — dikatakan apa adanya

- Langkah 3-6 wizard (Detail/Avatar/Konsep/Review) TIDAK tercapai lewat klik:
  unggah foto butuh runtime PostgreSQL, dan dev lokal memakai SQLite. Grid
  responsifnya (detail 1->2 kolom, urgensi 1->3, avatar 3->6, foto 3->4)
  adalah kelas breakpoint murni dengan pola yang SAMA dengan langkah 1 dan
  statistik beranda yang terbukti — tapi "pola yang sama" bukan bukti pixel.
  Verifikasi penuhnya menunggu klik-tembus di lingkungan Postgres (staging).
- Belum ada focus-trap di laci (Tab masih bisa keluar dari laci ke konten di
  baliknya). Escape + overlay + kunci gulir sudah ada.

## Temuan sampingan yang diperbaiki di commit yang sama

CSP memblokir 'unsafe-eval' yang dibutuhkan react-refresh Next di dev — jadi
HIDRASI MATI TOTAL di dev server: setiap onClick diam, dan tidak ada yang bisa
menguji interaksi secara lokal. Ketahuan justru karena QA ini: klik laci tidak
melakukan apa pun, dan screenshot "laci terbuka" pertama menampilkan halaman
tanpa laci. 'unsafe-eval' kini diizinkan HANYA saat NODE_ENV=development;
production tidak berubah.
