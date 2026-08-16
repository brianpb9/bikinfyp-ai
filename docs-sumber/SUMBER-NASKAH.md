# Sumber naskah BikinFYP — inventaris dan sintesis

Audit sumber dilakukan 16 Agustus 2026 terhadap **semua berkas yang relevan**
di `~/Downloads` dan folder kerja `script en`, bukan hanya empat judul awal.
PDF tetap berada di luar repository; dokumen ini hanya menyimpan inventaris dan
hasil sintesis. Salinan identik/repack dikonsolidasikan berdasarkan isi/hash,
jadi tidak dihitung sebagai buku tambahan.

## Inventaris yang dibaca

### Buku dan panduan panjang (6 sumber unik)

1. `365 IDE HOOK SAKTI LEO FYP.pdf`
2. `MEGA CREATOR SAMUEL CHRIST.pdf`
3. `MODAL HP SUKSES WILLIE SALIM.pdf`
4. `Seefluencer MEGA HOOK Kamus Berisi 250+ Hook Konten Viral - SAMUEL CHRIST.pdf`
5. `personal Branding is the key .pdf`
6. `CamScanner 19-08-2025 13.09.pdf` — teridentifikasi dari isi sebagai
   *Ngonten Semudah Bercerita*

Versi `(1)`, `(2)`, `compressed`, dan berkas CamScanner 18 Agustus yang isinya
sama tidak dibaca sebagai sumber baru. Enam buku scan di atas dibaca penuh
melalui OCR Indonesia/Inggris; hasil OCR hanya menjadi bahan kerja sementara
di luar repository.

### Materi praktik (4 sumber unik)

1. `Script Example 1.pdf`
2. `Script Example 2.pdf`
3. `Strategi Penjualan via Live Streaming TikTok.pdf`
4. `AI_UGC_Factory_Pipeline_Playbook.md`

### Sumber paling dekat dengan produk (13 sumber)

1. `00-INDEX-12-Template.md`
2. Seluruh dokumen `T01` sampai `T12` yang dirujuk indeks tersebut.

Total: **23 sumber unik yang relevan**. Dokumen DRACIN-OS, Poppu/game, akta,
dan materi domain lain sengaja tidak dimasukkan karena tidak relevan dengan
hook, copywriting, konten, UGC, iklan, atau creator.

## Pola yang disarikan — bukan salinan kalimat buku

- Hook bekerja sebagai janji perhatian: gangguan pola, rasa ingin tahu,
  identitas audiens, masalah yang terasa, bukti visual, atau kontras. Satu
  katalog tidak boleh bergantung pada satu bentuk pembuka yang diganti nomina.
- Hook harus cocok dengan payoff. Pertanyaan menuntut jawaban, misteri menuntut
  reveal, klaim menuntut demo, dan harga menuntut pembuktian nilai.
- Body yang kuat bergerak melalui beat khusus format: konteks/masalah → aksi →
  bukti → penilaian/keberatan → payoff. Menukar hook tanpa mengubah body tetap
  menghasilkan katalog yang terasa sama.
- Detail konkret lebih dipercaya daripada pujian. Produk diperlihatkan melalui
  tekstur, mekanisme, urutan pemakaian, perbandingan setara, atau reaksi yang
  dapat dilihat; fakta yang tidak diberikan brand tidak boleh diciptakan.
- Bahasa lisan membutuhkan partikel, jeda, perubahan tempo, dan ruang bernapas,
  tetapi cue harus kontekstual. Pembawaan tenang, intim, komedi, dan demonstrasi
  cepat tidak boleh memakai pola tempo yang identik.
- CTA menutup janji hook dan mengarahkan tindakan tanpa urgensi palsu. Karena
  itu setiap template juga memiliki CTA sendiri, bukan kalimat penutup global.
- Variasi harus dimiliki template. Varian kedua sampai keempat tetap memakai
  mekanisme format yang sama, tetapi punya hook, body, demo, dan CTA eksplisit
  sendiri; tidak mengambil kalimat acak dari kolam lintas-template.

## Implementasi di engine

`lib/script-engine/template-copy.ts` berisi 33 template aktif × 4 `CopyFn`
eksplisit: satu naskah utama dan tiga alternatif per template. Lima template
TVC hanya mendapat penggantian copy; rute, shot, modul, dan durasinya tidak
dibangun ulang.

Untuk varian bersuara, cue Gemini TTS ditulis inline lalu dikompilasi menjadi
caption bersih (`text`) dan dialog bertag (`tts_text`). Whitelist yang dipakai:
`[short pause]`, `[medium pause]`, `[long pause]`, `[giggles]`, `[laughs]`,
`[slow]`, `[fast]`, `[whispers]`, `[excited]`, dan `[serious]`. Dua cue
emphasis terakhir wajib berada di awal baris; `[shouting]` sengaja tidak
diizinkan demi loudness yang aman. Template `silent_caption` tidak menerima tag suara.

## Bukti audit katalog

Audit akhir dijalankan melalui `npm run audit:script-catalog`:

| Ukuran | Hasil |
|---|---:|
| Template dengan copy | 33 / 33 |
| Hook tetap unik | 33 / 33 |
| Seluruh hook unik (utama + alternatif) | 132 / 132 |
| Seluruh kalimat segmen unik | 396 / 396 |
| Kalimat non-hook unik | 264 / 264 |
| Demo unik | 132 / 132 |
| CTA unik | 132 / 132 |
| Kegagalan duplikasi `count=4` | 0 |
| Kegagalan delivery tag | 0 |
| Kegagalan validator | 0 |

Baseline sebelumnya adalah 15 hook unik dan 42 kalimat lintas katalog. Target
minimum 33 hook tetap tanpa daur ulang, 100+ hook tersedia, dan 150+ kalimat
unik telah terlampaui tanpa menyimpan satu pun PDF ke git.
