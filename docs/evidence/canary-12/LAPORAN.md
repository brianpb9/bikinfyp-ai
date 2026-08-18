# Canary 12 Klip — 19 Agustus 2026

Gate 3 audit kedalaman, diotorisasi Brian ("jalankan sekarang"). Enam produk,
dua klip per produk, rantai produksi penuh: generateScripts (genre + snapshot)
→ planShots → gerbang pemicu → assertVisualSpec → BytePlus → QC atas klip nyata.

**Biaya total: Rp44.336** (estimasi awal ±Rp33rb terlampaui ~35% — klip
bersuara/talking_head ternyata Rp8.313, bukan Rp2.771; dilaporkan apa adanya).

## Hasil per klip

| Klip | Sifat yang diuji | Hasil |
|---|---|---|
| somethinc-a | SKU panjang, foto banner marketing | ✅ render — "SOMETHINC" utuh, 2 tangan, teks kecil rusak |
| somethinc-b | SKU panjang, wajah AI | ✅ render |
| glow-a | promo harga coret | ✅ render — setia pada sumber (lihat temuan #8) |
| glow-b | durasi 30 dtk | ✅ render (lulus di percobaan ke-2 lintas putaran) |
| mosseru-a | nama memuat kata pemicu | ✅ render — QC-07 & QC-12 PASS via transkrip |
| mosseru-b | genre Ads tanpa keranjang | ✅ render (putaran 1 ditolak provider: "output audio sensitive") |
| kopitang-a | merek pendek, label penuh tulisan | ⛔ gate menolak naskah 3×— nol rupiah keluar |
| kopitang-b | TVC | ✅ render — "KOPI TANG" sempurna, baris kedua "Gula ARAM" salah eja |
| arva-a | kemasan reflektif chrome | ✅ render — "ARVA" tajam, refleksi bersih |
| arva-b | label sangat kecil | ⛔ gate menolak naskah 3× — nol rupiah keluar |
| sabun-a | produk polos | ✅ render — QC-10 SKIP (benar, bukan fail) |
| sabun-b | polos + 30 dtk | ✅ render — tanpa teks karangan |

10 render + 2 penolakan gate yang deterministik = 12 keluaran yang semuanya
bisa dijelaskan. Penolakan gate TIDAK mengeluarkan uang — fail-closed bekerja.

## Temuan (8), urut dampak

1. **L-22 lahir**: dialog `"kulitku断 mending banget"` — karakter Tionghoa lolos
   SEMUA gerbang sampai render dibayar. Tidak ada aturan aksara. → aturan baru,
   keras di kedua mode, plus tes. *(diperbaiki di 75dceed)*
2. **Dua pemilih merek menyimpang**: T-01 menuntut penutup TVC menyebut "kopi"
   (kata generik) untuk "KOPI TANG" — naskah TVC produk itu mustahil lolos.
   → pengetahuan merek disatukan di lib/merek.ts. *(7037cd8)*
3. **"Terpanjang = merek" masuk lagi**: QC-10 memilih "niacinamide" untuk
   SOMETHINC. → urutan nama dipertahankan. *(7037cd8)*
4. **Nama produk 4–6 kata mengalahkan penulis secara konsisten**: kopitang-a
   dan arva-b gagal L-05/S-09 di TIGA putaran (25–28 kata vs jendela 22).
   2 jatah perbaikan LLM tidak cukup untuk nama panjang. **BELUM diperbaiki** —
   opsi: jatah perbaikan dinamis, atau pemendekan nama otomatis di retail
   (Enterprise sudah punya cleanProductName).
5. **Provider bisa menolak AUDIO keluaran** ("output audio may contain
   sensitive information") — mode kegagalan baru, tertangani sebagai
   gagal-render (produksi: refund). Tidak deterministik: retry lolos.
6. **Teks label ukuran SEDANG bisa salah eja sementara QC-10 lolos di merek**:
   kopitang-b mencetak "Gula ARAM" (harusnya Aren) padahal "KOPI TANG" sempurna.
   QC-10 memang hanya menjaga token merek. **BELUM diperbaiki** — butuh
   pemeriksaan label penuh berbasis visi (kelas QC-F1); gerbang review scene
   (M11) menutupi Enterprise, retail belum.
7. **QC-08 selalu FAIL di harness canary** — metadata AIGC dipasang saat
   compositing, dan canary merender shot mentah. Bukan cacat produk; dicatat
   supaya angka QC tidak dibaca salah.
8. **Sampah masuk, sampah keluar yang SETIA**: foto sumber "Serum Glow Bright"
   ternyata foto AI lama berlabel gibberish ("bdodpgeer") — dan rendernya
   mereproduksi gibberish itu dengan patuh. Intake TIDAK memeriksa apakah teks
   label foto referensi terbaca. **BELUM diperbaiki** — kandidat pemeriksaan
   Gate-1: OCR/vision atas foto referensi sebelum diterima.

## Kriteria auditor

- Critical false pass: **0** — QC-10 tiga-keadaan jujur ("TIDAK TERBUKTI"
  alih-alih pass), tidak ada check yang mengaku memeriksa hal yang tidak
  diperiksanya.
- Prompt arsip: per-klip via canary log (produksi memakai job_prompts/0032).
- QC segar per render: ya, dijalankan atas mp4 nyata.
- Reviewer manual: **1 dari 2** — saya sudah meninjau frame (bukti .jpg di
  folder ini). Reviewer kedua = Brian: berkas mp4 di test_output/canary_12/.
- Refund exactly-once: TIDAK diuji di harness ini (render langsung tanpa
  job/hold); dijaga terpisah oleh indeks unik 0031 + tes konkurensi pg.

## Batas kejujuran

- 2 klip tidak pernah ter-render (kopitang-a, arva-b) — kegagalannya
  deterministik dan tercatat sebagai temuan #4, bukan disembunyikan.
- 3 dari 6 produk memakai foto sintetis (dibuat Gemini); dicatat per-klip.
- Skrip canary menimpa laporan antar putaran — log lengkap ketiga putaran
  diarsip di folder ini sebagai gantinya.
