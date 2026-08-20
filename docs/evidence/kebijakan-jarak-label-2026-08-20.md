# Kebijakan jarak label + packshot penutup — bukti render 20 Agu 2026

Catatan ini ada karena keputusannya mahal dan berdasar piksel, bukan pendapat.
Lima render berbayar, semuanya bisa diperiksa ulang di `test_output/`.

## Ringkasan keputusan

| Hal | Sebelum | Sesudah |
|---|---|---|
| Label merek di klip generate | diminta "sharp, steady, perfectly legible" | kamera menjaga jarak; tidak ada huruf yang ter-resolve |
| Jaminan label | tidak ada (tiga putaran prompt gagal) | packshot penutup 1,8 dtk dari foto asli, dirakit di composer |
| Shot pembuka hands_only | penulis bebas menunda kemunculan produk | S-10: `product_state` wajib `partial`, ditolak validator |
| QC-10 | "apakah merek terbaca" | dua makna: huruf salah di klip generate = fail; packshot = bukti asal-usul (sha) |
| Standar 10/10 baris 7 | penegakan "prompt" | penegakan "render" (tingkat baru, wajib menyebut fungsi penegaknya) |

## Bukti piksel

**Putaran 1 — adu A/B** (`test_output/adu_koreografi/`, Rp23.310).
Satu naskah, dua lengan; satu-satunya variabel adalah koreografi penulis.

- Terbukti: koreografi penulis benar-benar sampai ke kamera. Lengan A menyapu
  meja secara lateral persis seperti tulisan penulis; lengan B statis.
- Cacat 1: aksi penulis "sweeps across the mess, THEN pauses on the bottle"
  mengalahkan kunci "botol selalu di frame". Botol baru masuk detik ~2,5 dari 5.
- Cacat 2, di KEDUA lengan: nama merek jadi huruf karangan — "jddpgeer",
  "SOMSONG", "PAL Q3". Karena muncul di lengan kontrol juga, ini cacat lama yang
  tidak pernah terlihat karena tidak ada yang merender sejak 13 Agu.

**Putaran 2 — verifikasi** (`test_output/adu_koreografi/V1-hook`, `V2-cta-hero`, Rp23.310).
Naskah yang sama dipakai ulang supaya satu-satunya variabel adalah perbaikannya.

- V2 (CTA hero, shot yang labelnya paling dekat ke kamera): **nol kata karangan**.
  Kebijakan jarak bekerja — tapi hanya karena framing "tight macro" penulis ikut
  ditumpulkan. Tanpa bagian kedua itu, kalimat penulis membatalkan kebijakannya.
- V1 (hook): **gagal**. Botol tetap baru masuk frame detik ~2. Tambalan di
  perakit prompt kalah melawan aksi penulis. Itulah sebabnya aturannya dipindah
  ke hulu jadi S-10.

## Kemenangan L-21 yang layak dicatat

Frasa jarak versi pertama ditulis sebagai negasi: *"never closer than arm's
length"*. Gerbang prompt akhir menolaknya sebagai **L-21-NEGASI sebelum render**
— negasi tentang orang adalah kelas kalimat yang sudah terbukti memicu penyaring
penyedia. Gerbang itu menghemat satu render (Rp11.655) dalam satu panggilan.

Frasa yang dipakai sekarang positif: *"the camera stays at a normal arm's-length
viewing distance"*. Aturannya tetap sama; yang berubah cuma ia menyebut apa yang
ADA, bukan apa yang tidak ada.

Pelajarannya bukan soal kata: sebuah gerbang yang dipasang untuk melindungi
prompt dari penulis LLM ternyata menangkap kesalahan yang ditulis manusia — dan
itu justru bukti gerbangnya dipasang di tempat yang benar (pada prompt akhir,
bukan pada sumber tertentu).

## Yang TIDAK dibuktikan

- QC-10 tidak lagi bisa membuktikan keterbacaan visual dari klip generate, dan
  memang tidak lagi mengaku begitu. Yang dibuktikannya pada packshot adalah
  ASAL-USUL berkas (sha256 = foto yang tercatat pada job).
- Baris standar 10/10 "label terbaca di >=2 titik" kini dipenuhi oleh packshot,
  bukan oleh klip generate. Itu perubahan nyata pada janji produk, bukan
  perubahan penulisan.

## Salah baca yang harus dihindari

QC-08 dan QC-12 berstatus FAIL pada skrip adu (`scripts/adu-koreografi.ts`)
adalah **artefak harness**, bukan cacat produk: penanda AIGC/watermark dibakar
di `lib/media/compositor.ts` — tahap yang skrip adu itu lewati — dan QC-12 di
sana membandingkan VO satu shot melawan seluruh naskah tiga shot.
