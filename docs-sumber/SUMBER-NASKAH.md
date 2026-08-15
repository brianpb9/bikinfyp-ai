# Sumber ilmu naskah — hook & body

Empat PDF (total ~180 MB, TIDAK dimasukkan git karena ukurannya) ada di
`~/Downloads/`:

| Berkas | Isi |
|---|---|
| `Seefluencer MEGA HOOK Kamus Berisi 250+ Hook Konten Viral - SAMUEL CHRIST_compressed.pdf` | 250+ hook viral — sumber utama perluasan hook |
| `365 IDE HOOK SAKTI LEO FYP.pdf` | 365 ide hook |
| `MEGA CREATOR SAMUEL CHRIST.pdf` | struktur konten kreator |
| `MODAL HP SUKSES WILLIE SALIM.pdf` | pola konten modal HP |

Plus yang SUDAH di repo ini:
- `00-INDEX-12-Template.md` — 12 formula terpisah hasil bedah portfolio
- `TVC-Skincare-3-Scripts.md` — struktur TVC yang BENAR (Master VO List +
  Shot Table 6 modul)

## Kenapa ini penting

Diukur 16 Agustus 2026: script engine menghasilkan **15 hook unik untuk 33
template** dan **42 kalimat untuk seluruh katalog**. Brian menonton semuanya
dan menyetujui 6 dari 33 — alasan utamanya "skripnya sama semua membosankan,
ini masalah 99%".

Visual dan pemilihan model justru dinilai bagus. Yang rusak naskahnya, dan
naskah adalah teks — bisa diperbaiki tanpa render berbayar sama sekali.

## Target perluasan

Dari 15 hook unik → 40+, dan setiap template punya kalimatnya sendiri, bukan
mengambil dari kolam yang sama.

## Pembawaan VO — bagian dari pekerjaan naskah, bukan terpisah

Temuan Brian 16 Agustus, setelah menonton 33 video: **VO ngomongnya kecepatan.**
Yang kurang: intonasi, jeda, penekanan, dan tawa kecil (chuckle) — supaya
terdengar seperti orang, bukan pembaca teks.

Instruksi gaya global SUDAH ada di `lib/personas.ts` (`voiceStyle`), dan sudah
menyebut "ada jeda natural antar kalimat, tidak buru-buru". Tetap kedengaran
cepat. Kesimpulannya: **arahan di depan teks tidak cukup — model butuh penanda
DI DALAM naskahnya.**

Karena itu ini dikerjakan BERSAMA perluasan naskah, bukan sesudahnya: penanda
pembawaan ditulis menyatu dengan kalimatnya. Kalau dikerjakan terpisah lalu
naskahnya ditulis ulang, penandanya ikut terbuang.

Yang perlu dibangun saat menulis naskah baru:
- **jeda** di tempat yang masuk akal (setelah hook, sebelum harga, sebelum CTA)
- **penekanan** pada kata yang menjual (nama produk, angka harga, klaim inti)
- **tawa kecil / napas** di tempat yang wajar untuk register santai (bestie,
  genz) — TIDAK untuk register formal
- **tempo yang berubah**: hook cepat, demo melambat, CTA tegas

Catatan penting: jangan memakai SSML mentah tanpa mengecek — jalur TTS kita
mengirim `${styleInstruction} ${text}` sebagai teks biasa ke Gemini
(`lib/media/gemini-tts.ts`), bukan sebagai SSML. Ada `tests/ssml.test.ts` di
repo; periksa dulu apa yang sebenarnya didukung sebelum menulis penanda.

Ukuran keberhasilan: dengarkan hasilnya. QC-12 memeriksa APA yang diucapkan,
bukan BAGAIMANA — tidak ada check yang bisa membuktikan ini, hanya telinga.
