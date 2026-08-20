# STANDAR 10/10 — AI UGC Ads vs AI UGC Affiliate
Untuk Claude Code (Higgsfield/Chrome) dan engine BikinFYP.
Disusun 18 Aug 2026 dari 20+ skrip JJ Glow / Scarlett / MW-3, **9 render nyata**, dan
**6 penolakan filter**. v2 — versi lama disimpan di `STANDARD-10-ugc.v1.bak.md`.

> **Perubahan terbesar dari v1:** 12 baris bukan lagi skor, tapi **gate lulus/gagal**.
> Skor 0–10 hanya boleh diberikan setelah **klip jadi dan diperiksa** — bukan dari naskah.
> Alasannya di §E.

---

## A. Kenapa Ads dan Affiliate adalah dua produk berbeda

| | AI UGC Affiliate | AI UGC Ads |
|---|---|---|
| Siapa bicara | Affiliator/pembeli, akun pribadi | Brand lewat wajah "orang biasa", ditayangkan berbayar |
| Yang dijual | "Aku beli/pakai ini, kamu juga bisa" — pengalaman + akses beli | Satu perasaan/situasi yang bikin brand nempel — bukan penjelasan produk |
| Ide yang menang | social proof + kejadian pribadi: borong, rebutan, dititip, dijaga, kehabisan | anomali/situasi manusia yang tahan ditonton berulang (dipasang berhari-hari) |
| Nada | spontan, agak "ngaku", boleh sedikit rame | tenang, presisi, satu joke, tanpa hard sell |
| CTA | lisan, wajib "keranjang kuning" (Shopee: keranjang oren; Tokopedia: keranjang) | lisan, wajib "Detailnya **ada** di bawah ya" |
| Klaim | standar: nol medis/whitening/instant; harga boleh (ditulis kata) | ketat: hanya yang terlihat atau jelas subjektif; nol angka, nol harga, nol durasi hasil |
| Teks di layar | boleh, default OFF, ≤9 kata, hanya post-production | dilarang |
| Musik | "no music" default; boleh untuk no-face; ditambah saat upload | dilarang |
| Caption | penuh + ≤8 hashtag, boleh promo di caption | 1 kalimat, tanpa hashtag spam, tanpa "keranjang kuning" |
| Repetisi | satu ide sekali pakai per akun | ide harus tahan diulang; hindari lelucon yang mati di tontonan kedua |
| Sinyal beli | boleh: "aku borong", "isi lima", "stok" | hindari kata belanja/stok/harga; jual rasa, bukan transaksi |

**Uji kamar yang salah.** Kalau naskah Ads masih masuk akal ketika CTA-nya diganti
"keranjang kuning", itu Affiliate yang menyamar. Kalau naskah Affiliate tidak menyebut
satu pun tindakan pribadi (beli/pakai/simpan/rebutan), itu Ads yang salah kamar.

---

## B. GATE SKRIP — 12 baris, semua wajib, lulus/gagal

Ini **gate, bukan skor.** Satu baris gagal = naskah tidak dirender. Tidak ada nilai
sebagian, tidak ada "hampir".

1. **Anomali di frame pertama tanpa kata.** Audio dimatikan, detik 0–1 sudah bertanya
   sesuatu (odol berdiri di antara sendok; tangan memutar kunci brankas; kotak sabun
   dalam kotak kaca pajang). Hook yang butuh kalimat untuk dipahami = gagal.
2. **Satu ide, satu kalimat, tidak bisa dipindah ke produk lain.** "Aku ngopi terus, jadi
   aku pakai ini" bisa untuk odol apa pun → gagal. "Odol yang aku sembunyiin dari suami"
   hanya untuk barang yang direbutin satu rumah → lulus.
3. **Situasi manusia menanggung video**, produk menumpang. Ada orang, momen, tegangan.
   Tangan menaruh produk di meja itu b-roll, bukan situasi.
4. **Payoff menjawab pertanyaan hook** — bukan katalog. "Isinya dua sabun batang" = gagal;
   "Kalau ketahuan, dipakai berdua, habisnya dua kali lebih cepet" = lulus.
5. **Level hook sesuai kategori.** Kategori jenuh (sabun, skincare, F&B, odol) minimal L2;
   L1 polos hanya untuk produk yang masalahnya benar-benar baru. L4 = dunia nyata
   dilebihkan; L5 = melanggar fisika, efek di foreground, dialog tetap jujur.
6. **Nol klaim yang bisa disalahkan.** Brightening/whitening/memutihkan/instan/menyembuhkan
   hanya di label fisik, tidak pernah diucapkan; tidak ada before/after; tidak ada angka
   spesifikasi di dialog. Ads lebih ketat (lihat tabel A).
7. **Brand fidelity terencana.** Label merek dijamin lewat **packshot penutup dari foto
   asli** (1,8 detik, dirakit di composer, tidak pernah dikirim ke model video) — bukan
   lewat meminta model video mengeja label dengan benar. Tiga putaran prompt dan empat
   render berbayar (14 dan 20 Agu) membuktikan model selalu mengarang huruf: "Bright Slow
   'ver Gel", "jddpgeer", "SOMSONG", "45 oz" untuk botol 30 ml. Karena itu di bagian yang
   DIGENERATE berlaku sebaliknya — kamera menjaga jarak sehingga tidak ada huruf yang
   pernah ter-resolve, dan huruf yang tidak dirender tidak bisa salah (§C.10, kebijakan
   jarak label 20 Agu). PRODUCT-LOCK tetap ditulis dari foto asli (bentuk, tutup, warna,
   tata letak label, netto); ukuran produk dikunci ke ukuran asli (lihat §C.3).
8. **Filter-safe secara struktural.** Tanpa kamar mandi/handuk/kulit basah/shower; tanpa
   senjata; tanpa orang kedua (figur tambahan hanya tangan/punggung tanpa wajah, ditulis
   positif); **tanpa satu pun negasi tentang orang di mana pun, termasuk blok negative** —
   ganti dengan paragraf positif `FRAME CONTENT`; tanpa penekanan tubuh (referensi
   full-body, "skin", "natural skin texture", "ribbed", "high-waist"); framing
   `from the chest up`; tanpa `hides/sneaks/furtive/hurried/glances left and right`.
   **Baris ini menurunkan peluang ditolak, tidak menghilangkannya — lihat §E.**
9. **Bahasa dikunci 4 lapis.** "Every spoken word is Indonesian" di header; "She speaks
   Indonesian (Bahasa Indonesia)" di tiap shot bicara; label dialog; "no English speech"
   sekali. Total dialog ≤1.5 kata/detik (15 detik ≤22 kata), ≤10 kata per shot; kamus
   salah ucap bersih; buffer "**ada** di".
10. **Struktur produksi jujur.** 15 detik = 3 shot ±5 detik; **shot 1 tanpa wajah** (lihat
    §E — ini yang paling menentukan lolos filter); shot 2–3 dari satu MASTER frame; CTA
    satu take, produk hero, diam 1 detik terakhir; talking head >15 detik = wajah tidak
    dijamin, dan itu harus dikatakan, bukan disembunyikan.
11. **Variasi katalog.** Dalam satu talent/akun, gesture shot 2 dan kalimat CTA tidak boleh
    identik lebih dari 2 video berturut-turut. Ganti gesture (buka kotak / tuang dua bar ke
    telapak / tunjuk baris netto / putar kotak di sudutnya / tepuk kantong tas / tumpuk
    jadi menara) dan ganti kalimat CTA dengan frasa wajib tetap.
12. **Bisa dijelaskan kenapa orang berhenti.** Wajib ada satu baris `why_stop` tertulis
    yang menyebut mekanik dan momen payoff. Format:

        why_stop: <mekanik> — penonton berhenti di <detik/kejadian> karena <tegangan>,
                  lalu terbayar di <detik/kalimat>.

    Contoh: `why_stop: forbidden — berhenti di 0:01 karena orang memutar kunci brankas
    untuk barang sepele, terbayar di 0:07 saat dia bilang "nggak aku taruh sembarangan".`
    Kalau baris ini tidak bisa ditulis, idenya belum ada.

---

## C. GATE KLIP — setelah render, sebelum diserahkan

Naskah lulus gate B **belum** berarti hasilnya layak. Periksa klipnya sendiri, bukan
laporan bahwa klipnya sudah dibuat.

**Tolak dan ulang kalau ada satu saja:**

1. Mulutnya bicara Inggris, bukan Indonesia.
2. Wajah bergeser antara shot 2 dan shot 3.
3. Label produk tidak terbaca, atau tata letaknya beda dari foto asli, di beat CTA.
4. Produk tidak diam sepenuhnya di 1 detik terakhir.
5. Ada teks liar, subtitle, caption, atau watermark di mana pun.
6. Muncul orang kedua.
7. Detik pertama adalah pack shot.
8. Ada musik.
9. Kata terlarang (memutihkan/whitening/instan) terucap.
10. **Produk muncul di ukuran tidak wajar** — foto referensi ikut dibaca sebagai objek
    adegan lalu ditempel jadi bidang depan raksasa. Sudah terjadi di render pertama:
    sepertiga bawah layar terisi kotak berukuran meja. Kunci dengan kalimat positif:
    `Every <produk> in frame is at its true small size, about the width of a hand,
    resting on a surface or held in her hand, and the camera keeps a normal
    conversational distance from it.`
11. Rak/permukaan sekitar memunculkan tulisan acak. Kunci:
    `The surfaces around her carry plain unmarked things.`

---

## D. SKOR 0–10 — hanya setelah klip ada

Mulai dari **0**, bukan dari 10. Poin diperoleh dari bukti yang dilihat, bukan dari usaha
atau dari kelengkapan naskah. Bulatkan ke bawah. Gunakan bilangan bulat.

| Kondisi | Batas atas |
|---|---|
| Belum ada klip | **NOT SCORABLE** — bukan "kemungkinan bagus" |
| Klip rusak / kosong | 1 |
| Klaim terlarang terucap | 2 + HOLD otomatis |
| Bicara Inggris | 3 |
| Label tidak terbaca di CTA | 5 |
| Wajah bergeser antar shot | 5 |
| Lulus gate tapi terasa generik / hook butuh kalimat | 5 |
| Rapi dan profesional tapi jelas di bawah benchmark | 8 |
| 9 | butuh kedekatan nyata dengan benchmark yang disebut namanya |
| 10 | tidak ada kelemahan terlihat dibanding pemimpin kategori |

Wajib sebut **benchmark bernama** sebelum memberi angka — untuk Affiliate: akun afiliasi
teratas di kategori yang sama; untuk Ads: iklan berbayar yang sedang tayang di kategori
yang sama. Skor tanpa benchmark tidak sah.

---

## E. Data filter yang sebenarnya — jangan berjanji lebih dari ini

Dari 9 render nyata malam 18 Agu (JJ Glow, Seedance 2.5):

| | Skrip | Shot 1 ada wajah? | Hasil |
|---|---|---|---|
| ✅ | Habisnya kecepetan | tidak | jadi |
| ✅ | Brankas (v2) | tidak | jadi |
| ✅ | Mystery box | tidak | jadi |
| ✅ | Museum | tidak | jadi |
| ❌ | CCTV minimarket | ya | NSFW |
| ❌ | Brankas (v1) | ya | NSFW |
| ❌ | POV kantong belanja | ya (sekejap) | NSFW |
| ❌ | Kulkas | tidak | NSFW |
| ❌ | Meja beku | tidak | NSFW |
| ❌ | Barang nyamperin | tidak | NSFW |

**Dua kesimpulan, dan keduanya penting:**

1. **Semua yang lolos punya shot 1 tanpa wajah.** Belum ada pengecualian. Jadikan ini
   default, bukan pilihan.
2. **Kebalikannya tidak berlaku.** Tiga skrip yang shot 1-nya juga tanpa wajah tetap
   ditolak. Resep yang sama bisa memberi hasil berbeda — Brankas ditolak di percobaan
   pertama lalu lolos di percobaan kedua **dengan prompt yang hampir sama**.

**Karena itu:** penolakan NSFW **bukan selalu bug naskah.** Kalau naskah sudah lulus baris
8 dan tetap ditolak, **jangan tulis ulang idenya** — masukkan lagi ke antrean. Rendernya
gratis dan kreditnya dikembalikan. Tulis ulang hanya kalau ada kata pemicu yang benar-benar
teridentifikasi.

**Kosakata pemicu yang sudah terbukti** (kumulatif dari 6 penolakan): towel, bathrobe,
shower, wet skin, undress, kamar mandi, kamar tidur, senjata, `security camera`, `CCTV`,
`surveillance`, `glances left and right`, `hurried`, `hugs to her chest`, `sweeps`,
`rakes the whole row`, blok negasi `DO NOT INCLUDE: no crowd, no second person...`,
referensi full-body, `warm light-tan skin`, `natural skin texture`, `ribbed`, `high-waist`.

---

## F. Aturan uang dan operasi — di sinilah kerugian nyata terjadi

| Aksi | Biaya |
|---|---|
| Seedance 2.5 + **Unlimited ON** | gratis, tanpa batas |
| Seedance 2.5 tanpa Unlimited | **✦98–105 per video** |
| Generate image | ✦2 |
| Model video lain | ✦3–5 |

- **Tombol harus berbunyi `Generate Unlimited`. Ada angka ✦ = jangan ditekan.**
- Unlimited **hanya di web UI**. Lewat MCP selalu berbayar — jangan pernah panggil
  `generate_video` dari MCP.
- **Toggle Unlimited mati setiap halaman dimuat ulang** dan letaknya di bawah lipatan.
- **1080p tidak dicakup Unlimited.** Tetap 720p — label tetap terbaca (terbukti di Museum).
- **Satu job unlimited pada satu waktu.** Antre, jangan spam submit.
- Buka panel lewat **✦ Create → banner Seedance**, bukan URL `/ai/video` langsung (URL
  langsung memunculkan varian Start Frame tanpa References dan tanpa Unlimited).

Detail langkah dan koordinat: `RUNBOOK-HIGGSFIELD-UNLIMITED.md`.

---

## G. Contoh acuan

**Lulus 12/12 dan klipnya jadi:**
- Affiliate — "Disimpan di brankas" (JJ Glow, L4, forbidden). Anomali tanpa kata, payoff
  "nggak aku taruh sembarangan".
- Affiliate — "Museum" (JJ Glow, L4, scale). Frame terbaik sejauh ini; label terbaca jelas
  di 720p.
- Ads — "Odol di meja meeting" (MW-3, L4, contrast). Alasan sengaja tidak dijelaskan.
- Ads — "Odol yang aku sembunyiin dari suami" (MW-3, L4, social_theft).

**Gagal dan sebabnya:**
- "Aku ngopi terus" — L1, generik, hook b-roll. Gagal baris 1, 2, 3, 5.
- "Satu aku simpan di tas" — tidak ada tegangan. Gagal baris 3, 4.
- CCTV v1 — gagal baris 8 (guilty + hurried + kosakata pengawasan).
- Kamera-di-dalam-botol — CGI di talking head, nativeness rendah.

---

## H. Alur wajib

    ide (one-liner + mekanik + why_stop)
      → GATE SKRIP §B (12/12 atau tidak jalan)
      → cek kosakata pemicu §E
      → PRODUCT-LOCK dari foto asli latar polos ≥1000 px
      → cek aturan uang §F, pastikan "Generate Unlimited"
      → render satu per satu, tunggu antrean
      → ditolak? cek pemicu; kalau bersih, ANTRE LAGI tanpa menulis ulang
      → GATE KLIP §C
      → SKOR §D dengan benchmark bernama
      → serahkan

**Definisi selesai:** bukan saat tombol Generate diklik, dan bukan saat naskah lulus gate.
Selesai adalah **klip ada, sudah diperiksa mata sendiri, lulus §C, dan punya skor §D
beserta benchmark-nya.**
