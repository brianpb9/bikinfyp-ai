# STORY OS FOR ADS — v1.0 (kanonik untuk engine BikinFYP + Claude Code)
Turunan dari HDRV Story OS v1.0 (Dracin), diadaptasi untuk AI UGC Ads 10/20/30 detik. Berlaku bersama MASTER-UGC-ADS.md dan STANDARD-10-ugc v2. Untuk Affiliate TIDAK berlaku (Affiliate memakai HOOK→BODY→CTA 15 detik dengan anomali + tindakan pribadi).

## 0. Prinsip
Iklan yang ditonton sampai ujung bukan hook + penjelasan + CTA. Ia adalah loop: TEKANAN → TEKANAN LEBIH DALAM → PELAMPIASAN (di depan saksi) → satu TANYA kecil yang tersisa. Emosi penonton satu-satunya produk; produk hanya menumpang lewat jembatan (bridging) yang jujur.

## 1. Beat wajib — ditulis dalam urutan ini (Button-first)
1. **BUTTON** (ditulis pertama): 3–6 detik terakhir. Satu tanya kecil yang sengaja tidak dijawab (hasil foto tidak diperlihatkan; "keterima nggak?"; "besok dia senyum nggak?"; "kamu yang presentasi besok, kan?"). CTA Ads "Detailnya **ada** di bawah ya" HIDUP DI DALAM button, didahului satu klausa cerita ("Yang ini nggak aku hapus." / "Nanti aku kabarin ya." / "Tadi sikat gigi dulu."). Produk hero, label terbaca, diam 1 detik terakhir.
2. **SPIKE**: pelampiasan. Protagonis mengalahkan tekanannya sendiri DI DEPAN SAKSI. Saksi boleh suara saja off camera (petugas, ibu, pewawancara, grup call, penghulu, anak). Terjadi di 65–80% durasi. Ditandai satu gestur visual kampanye (untuk MW-3: tangan yang mulai naik ke mulut lalu diturunkan) dan satu kalimat ≤8 kata yang *menjawab* pertanyaan hook, bukan mendeskripsikan produk.
3. **HOOK**: konflik/anomali sudah ada di frame pertama, tanpa kata; shot 1 tanpa wajah (data filter 4/4 lolos tanpa wajah). Boleh mencuri momen dari spike sebagai teaser. Produk boleh hadir tanpa dijelaskan (bridging #2).
4. **FRICTION** (ditulis terakhir, jembatan hook→spike): tekanan NAIK minimal DUA kali. Musuh yang sah: kebiasaan/refleks sendiri (tangan naik lagi), waktu yang habis (timer, lift ting, "silakan masuk"), suara yang memanggil ("kok diem aja?", "Bunda!"). Setiap tekanan mengubah posisi/keputusan (geser). Dilarang: penjelasan hook, kalimat "aslinya…" sebagai pembuka, katalog produk.

Proporsi: 10 dtk = HOOK 3 · FRICTION+SPIKE 4 · BUTTON 3 · 20 dtk = 4 · 7 · 5 · 4 · 30 dtk = 4 · 11 · 9 · 6.

## 2. Hukum
- **Kausalitas keras**: tiap beat terjadi KARENA beat sebelumnya ("karena itu / tapi ternyata"), nol "lalu".
- **Satu emosi dominan** per video, tertulis di header (deg-degan→lega, geram→puas, haru). **Satu reversal**.
- **Saksi wajib** di spike (suara cukup). Tanpa saksi = pelampiasan pribadi = lemah.
- **Bridging ≥2 dari 3**: (a) aksi jujur dengan produk di friction (sikat gigi di meja rias/dapur/parkiran; cek gigi di cermin kecil "udah bersih"; tube dimasukkan saku seperti jimat); (b) produk di frame pertama tanpa dijelaskan; (c) pengakuan ringan di button sebelum CTA. Penonton yang menyimpulkan manfaat; kita tidak mengucapkannya.
- **Bahan bakar**: vanity (ingin dilihat/dihormati) default untuk personal care; greed/lust hati-hati. Mekanik ide tetap dari bank 12(+audio_shift); Story OS mengatur *bentuk*, mekanik mengatur *kenapa berhenti*.
- **Dialog**: kalimat orang beneran, ≤8 kata per baris, tempo dialog mengikuti pita genre & durasi (aturan lama 1,5 kata/detik DIBATALKAN 4 Sep 2026 — pita tempo per genre & durasi berlaku (lib/script-engine/pita-tempo.ts). Diukur: 17 kata/15 dtk meninggalkan 8,48 dtk sunyi (56% video diam); 49 kata + arahan aktif menyisakan 0,40 dtk), boleh berhenti di tengah (hitungan, napas). Bahasa 4 lapis.
- **Scene card** per shot: FUNGSI (beat) · KONFLIK · GESER · DORONG · TES 3 DTK. Shot tanpa geser = hapus.

## 3. Gate Story OS Ads (SA1–SA8) — gagal satu = naskah tidak dirender
| Gate | Lulus jika |
|---|---|
| SA1 Button-first | button tertulis dengan tanya yang bisa diucapkan penonton dalam 1 kalimat, CTA di dalamnya |
| SA2 Spike+saksi | ada pelampiasan di 65–80% dan saksi disebut (minimal suara) |
| SA3 Hook tanpa kata | konflik terbaca tanpa dialog; shot 1 tanpa wajah |
| SA4 Friction ×2 | dua tekanan berbeda yang menaikkan taruhan, masing-masing punya geser |
| SA5 Kausalitas | tiap transisi "karena itu / tapi ternyata"; tidak ada beat yang bisa dihapus tanpa merusak berikutnya |
| SA6 Bridging ≥2 | dua dari tiga jembatan produk hadir, tanpa klaim |
| SA7 Satu emosi, satu reversal | tertulis di header; scene yang tidak melayani emosi itu dihapus |
| SA8 Body bukan penjelasan | tidak ada baris dialog body yang menjelaskan hook/efek atau mendeskripsikan produk |
Penegakan: SA1/SA2/SA4/SA6/SA8 dapat dicek mesin dari struktur (beat labels, saksi field, bridging flags, dialog regex); SA3/SA5/SA7 via juri FYP Gate (story_pull, payoff) — label jujur: "kode" vs "juri".

## 4. Template header naskah Ads
```
ADS · <judul> · <durasi> · <mekanik> · L<n>
INSIGHT: <kebenaran manusia tanpa produk>
EMOSI DOMINAN: <satu kata→satu kata>   REVERSAL: <satu>
BUTTON: <tanya> · CTA: "<klausa cerita>. Detailnya ada di bawah."
SPIKE: <momen> · SAKSI: <siapa, off camera>
HOOK: <anomali tanpa kata, shot 1 tanpa wajah>
FRICTION: <tekanan 1> → <tekanan 2>
BRIDGING: <a/b/c yang dipakai>
why_stop: <mekanik> — berhenti di <detik/kejadian>, terbayar di <detik/kalimat>
```

## 5. Contoh lulus (rujukan)
"Foto KTP" 10s · "Wawancara Kerja" 20s · "Video Call Mendadak" 20s · "Sebelum Ijab" 20s (bridging 3/3) · "Kok Diem Aja?" 20s · "Foto Bersama" 30s. Gagal: "Aku ngopi terus" (tanpa tekanan), "lampu/jam" versi awal (hook bagus, body penjelasan).

---
# MEKANIK BARU — audio_shift (tambahan ke idea-mechanics.json, bentuk sama dengan 12 lainnya)
```json
{
  "id": "audio_shift",
  "nama": "Suara dunia berubah",
  "cara": "Yang berubah bukan gambar tapi SUARA: bising → hening, ramai → sepi, dering → tenang. Pelampiasan terasa lewat telinga; gambar boleh tetap sama.",
  "contoh_one_liner": "Kantor bising, dia pakai earphone — semua suara hilang kecuali napasnya.",
  "cocok": ["earphone/headphone", "kipas/AC", "pembersih (bising→senyap)", "aplikasi fokus", "kopi/teh (ramai→tenang sebagai metafora)"],
  "hindari": "produk yang manfaatnya visual; jangan dipakai untuk klaim medis (tinnitus dll)",
  "syarat_produksi": "ditulis di STYLE sebagai audio design eksplisit per shot; tanpa musik kecuali musik adalah 'yang didengar dia' dan dicatat; lip-sync tetap; bising ditulis positif ('a busy office hum') bukan negasi",
  "hook_level_default": "L3",
  "format_cocok": ["micro_cut_shift", "selfie", "general"],
  "why_stop_template": "audio_shift — berhenti di <detik> karena suara <berubah bagaimana>, terbayar saat <momen hening/tenang>"
}
```
